'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { runAction, type ActionState } from '@/server/action';
import { requireUser } from '@/server/auth/guard';
import {
  finishCorrelatedOperationalMetric,
  operationalDurationMs,
  operationalStartedAtFromEpoch,
  recordOperationalEvent,
} from '@/server/observability/operational';

type TutorialClientEvent =
  | 'TUTORIAL_STARTED'
  | 'TUTORIAL_STEP_REACHED'
  | 'TUTORIAL_CLOSED_THIS_SESSION';

function safeCorrelationId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 10 && trimmed.length <= 128 ? trimmed : null;
}

export async function recordTutorialClientEventAction(input: {
  eventType: TutorialClientEvent;
  correlationId: string;
  startedAtMs: number;
  stepId?: string | null;
}): Promise<void> {
  const user = await requireUser();
  const correlationId = safeCorrelationId(input.correlationId);
  if (!correlationId) return;

  const allowed: TutorialClientEvent[] = [
    'TUTORIAL_STARTED',
    'TUTORIAL_STEP_REACHED',
    'TUTORIAL_CLOSED_THIS_SESSION',
  ];
  if (!allowed.includes(input.eventType)) return;

  const startedAt = operationalStartedAtFromEpoch(input.startedAtMs);
  const completedAt = input.eventType === 'TUTORIAL_STARTED' ? null : new Date();
  const stepId =
    typeof input.stepId === 'string' && input.stepId.length <= 64 ? input.stepId : null;

  recordOperationalEvent({
    eventType: input.eventType,
    userId: user.id,
    entityType: stepId ? 'TutorialStep' : 'Tutorial',
    entityId: stepId ?? 'guided-tour',
    correlationId,
    startedAt,
    completedAt,
    durationMs: completedAt ? operationalDurationMs(startedAt, completedAt) : null,
    status: input.eventType === 'TUTORIAL_STARTED' ? 'STARTED' : 'SUCCESS',
    source: 'CLIENT_UI',
  });
}

/**
 * Marca el recorrido guiado como hecho.
 *
 * No exige permiso, sólo sesión: es sobre la propia cuenta, y exigir un
 * permiso dejaría a alguien atrapado en su propio tutorial.
 */
export async function finishTutorialAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const outcome = formData.get('tutorialOutcome') === 'COMPLETED' ? 'COMPLETED' : 'DISABLED';
    const correlationId = safeCorrelationId(formData.get('metricCorrelationId'));
    const startedAt = operationalStartedAtFromEpoch(formData.get('metricStartedAt'));

    await prisma.user.update({
      where: { id: user.id },
      data: { tutorialDoneAt: new Date() },
    });

    const completedEventType =
      outcome === 'COMPLETED' ? 'TUTORIAL_COMPLETED' : 'TUTORIAL_DISABLED';

    if (correlationId) {
      finishCorrelatedOperationalMetric({
        startEventType: 'TUTORIAL_STARTED',
        completedEventType,
        correlationId,
        userId: user.id,
        entityType: 'Tutorial',
        entityId: 'guided-tour',
        fallbackStartedAt: startedAt,
      });
    } else {
      const completedAt = new Date();
      recordOperationalEvent({
        eventType: completedEventType,
        userId: user.id,
        entityType: 'Tutorial',
        entityId: 'guided-tour',
        startedAt,
        completedAt,
        durationMs: operationalDurationMs(startedAt, completedAt),
        status: 'SUCCESS',
      });
    }

    revalidatePath('/', 'layout');
    return {
      ok: true as const,
      message:
        outcome === 'COMPLETED'
          ? 'Recorrido finalizado.'
          : 'Ok, no volverás a ver el tutorial. Puedes activarlo cuando quieras desde Mi perfil.',
    };
  });
}

/** Vuelve a ofrecer el recorrido, desde el perfil. */
export async function restartTutorialAction(): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { tutorialDoneAt: null },
    });
    revalidatePath('/', 'layout');
    return { ok: true as const, message: 'El recorrido volverá a aparecer.' };
  });
}
