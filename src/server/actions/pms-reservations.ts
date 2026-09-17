'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PmsImportStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { NotFoundError, RuleError } from '@/server/errors';
import { applyImport } from '@/server/services/pms-import';
import { syncReservationCoreFromPms } from '@/server/services/reservation-core';

const batchSchema = z.object({ batchId: z.string().min(1) });
const RETURN_TO = { turno: '/turno', habitaciones: '/habitaciones' } as const;
type ReturnKey = keyof typeof RETURN_TO;

function returnKeyOf(formData: FormData): ReturnKey | null {
  const raw = formData.get('volverA');
  return typeof raw === 'string' && raw in RETURN_TO ? (raw as ReturnKey) : null;
}

function refreshImportedContext(): void {
  revalidatePath('/habitaciones');
  revalidatePath('/llaves');
  revalidatePath('/habitaciones/importar');
  revalidatePath('/huespedes');
  revalidatePath('/turno');
  revalidatePath('/supervision');
  revalidatePath('/caja');
  revalidatePath('/');
}

/**
 * Aplica el lote del PMS y, acto seguido, convierte sus estadías en el núcleo
 * Huésped -> Reserva -> Estadía.
 *
 * `applyImport` sigue siendo la única función que toca la operación física
 * (habitaciones y llaves). Esta acción añade la segunda mitad del proceso:
 * crea las reservas que todavía no existen, crea su huésped principal cuando
 * hay nombre y enlaza las estadías por CÓDIGO DE RESERVA, nunca por nombre.
 *
 * La sincronización es idempotente. Si el lote ya quedó APLICADO porque el
 * despliegue o la petición se cortó después del primer paso, volver a pulsar
 * «Aplicar» no intenta aplicar el lote otra vez: sólo completa el núcleo de
 * reservas. Así un fallo intermedio es recuperable sin duplicar datos.
 */
export async function applyImportWithReservationCoreAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const back = returnKeyOf(formData);
  let completed = false;

  const result = await runAction(async () => {
    const user = await requirePermission('pms.import');
    const input = parseOrThrow(batchSchema, formDataToObject(formData));

    const batch = await prisma.pmsImportBatch.findUnique({
      where: { id: input.batchId },
      select: { id: true, status: true, businessDate: true },
    });
    if (!batch) throw new NotFoundError('Esa importación no existe.');
    if (batch.status === PmsImportStatus.DESCARTADO) {
      throw new RuleError('Esa importación fue descartada y no puede aplicarse.');
    }

    const outcome =
      batch.status === PmsImportStatus.BORRADOR ? await applyImport(user, batch.id) : null;

    const core = await prisma.$transaction(
      (tx) => syncReservationCoreFromPms(tx, { businessDate: batch.businessDate }),
      { timeout: 30_000, maxWait: 10_000 },
    );

    refreshImportedContext();
    completed = true;

    const operation = outcome
      ? `${outcome.created} estadías nuevas, ${outcome.updated} actualizadas`
      : 'estado operativo ya aplicado';
    const reservations =
      `${core.reservationsCreated} reserva(s) creada(s), ` +
      `${core.guestsCreated} huésped(es) creado(s), ` +
      `${core.staysLinked} estadía(s) enlazada(s)`;

    return {
      ok: true as const,
      message: `Listo: ${operation}; ${reservations}.`,
    };
  });

  if (completed && back) redirect(RETURN_TO[back]);
  return result;
}
