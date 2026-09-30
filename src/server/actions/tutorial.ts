'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { runAction, type ActionState } from '@/server/action';
import { requireUser } from '@/server/auth/guard';
import {
  enabledTutorialModules,
  isTutorialModuleKey,
  type TutorialModuleKey,
} from '@/domain/tutorial-tour';
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

function moduleKeysFromForm(value: FormDataEntryValue | null): TutorialModuleKey[] {
  if (typeof value !== 'string') return [];
  return Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(isTutorialModuleKey),
    ),
  );
}

async function addKnownModules(userId: string, modules: readonly TutorialModuleKey[]) {
  if (modules.length === 0) return;

  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { tutorialKnownModules: true },
  });
  const next = Array.from(new Set([...(row?.tutorialKnownModules ?? []), ...modules]));

  await prisma.user.update({
    where: { id: userId },
    data: { tutorialKnownModules: { set: next } },
  });
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
 * Marca el recorrido general como hecho e inicializa como conocidos todos los
 * módulos que la cuenta puede ver en ese momento. Así el onboarding modular
 * sólo aparecerá si más adelante gana acceso a algo nuevo.
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
    const currentModules = enabledTutorialModules(user.permissions);

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tutorialKnownModules: true },
    });
    const known = Array.from(
      new Set([...(row?.tutorialKnownModules ?? []), ...currentModules]),
    );

    await prisma.user.update({
      where: { id: user.id },
      data: {
        tutorialDoneAt: new Date(),
        tutorialKnownModules: { set: known },
      },
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
          ? 'Recorrido general finalizado.'
          : 'El recorrido general quedó desactivado. Puedes iniciarlo de nuevo desde Ayuda o Mi perfil.',
    };
  });
}

/**
 * Cierra el onboarding de uno o varios módulos. Omitirlo de forma permanente y
 * completarlo producen el mismo efecto de acceso: el módulo ya se considera
 * conocido. «Cerrar esta vez» sigue siendo sólo sessionStorage y no llega acá.
 */
export async function finishModuleTutorialAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const requested = moduleKeysFromForm(formData.get('tutorialModules'));
    const enabled = new Set(enabledTutorialModules(user.permissions));
    const modules = requested.filter((module) => enabled.has(module));
    if (modules.length === 0) {
      return { ok: true as const, message: 'No hay módulos pendientes.' };
    }

    await addKnownModules(user.id, modules);

    const outcome = formData.get('tutorialOutcome') === 'COMPLETED' ? 'COMPLETED' : 'DISABLED';
    const correlationId = safeCorrelationId(formData.get('metricCorrelationId'));
    const startedAt = operationalStartedAtFromEpoch(formData.get('metricStartedAt'));
    const completedEventType =
      outcome === 'COMPLETED' ? 'TUTORIAL_COMPLETED' : 'TUTORIAL_DISABLED';
    const entityId = `modules:${modules.join(',')}`;

    if (correlationId) {
      finishCorrelatedOperationalMetric({
        startEventType: 'TUTORIAL_STARTED',
        completedEventType,
        correlationId,
        userId: user.id,
        entityType: 'TutorialModule',
        entityId,
        fallbackStartedAt: startedAt,
      });
    } else {
      const completedAt = new Date();
      recordOperationalEvent({
        eventType: completedEventType,
        userId: user.id,
        entityType: 'TutorialModule',
        entityId,
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
          ? 'Tutorial del módulo finalizado.'
          : 'No volveremos a mostrar automáticamente este tutorial. Puedes abrirlo desde Ayuda.',
    };
  });
}

/** Vuelve a ofrecer el recorrido general, desde el perfil o Ayuda. */
export async function restartTutorialAction(): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { tutorialDoneAt: null },
    });
    revalidatePath('/', 'layout');
    return { ok: true as const, message: 'El recorrido general volverá a aparecer.' };
  });
}

/** Reabre deliberadamente el tutorial de un módulo disponible para la cuenta. */
export async function restartModuleTutorialAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    const [module] = moduleKeysFromForm(formData.get('tutorialModules'));
    if (!module) {
      return { ok: false as const, message: 'Módulo de tutorial no válido.' };
    }

    const enabled = new Set(enabledTutorialModules(user.permissions));
    if (!enabled.has(module)) {
      return { ok: false as const, message: 'Ese módulo no está habilitado para tu cuenta.' };
    }

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { tutorialKnownModules: true },
    });
    const next = (row?.tutorialKnownModules ?? []).filter((key) => key !== module);

    await prisma.user.update({
      where: { id: user.id },
      data: { tutorialKnownModules: { set: next } },
    });

    revalidatePath('/', 'layout');
    return { ok: true as const, message: 'El tutorial del módulo volverá a aparecer.' };
  });
}
