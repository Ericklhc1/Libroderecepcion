'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PmsImportStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { NotFoundError, RuleError } from '@/server/errors';
import { applyImport, discardImport, prepareImport } from '@/server/services/pms-import';
import { syncReservationCoreFromPms } from '@/server/services/reservation-core';

const batchSchema = z.object({
  batchId: z.string().min(1),
  returnTo: z.enum(['turno']).optional(),
});

function returnToOf(formData: FormData): 'turno' | null {
  return formData.get('returnTo') === 'turno' ? 'turno' : null;
}

function refreshContext(): void {
  revalidatePath('/huespedes');
  revalidatePath('/huespedes/importar');
  revalidatePath('/habitaciones');
  revalidatePath('/llaves');
  revalidatePath('/caja');
  revalidatePath('/supervision');
  revalidatePath('/libro');
  revalidatePath('/turno');
  revalidatePath('/');
}

export async function prepareGuestReservationImportAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  let batchId: string | null = null;
  const returnTo = returnToOf(formData);

  const result = await runAction(async () => {
    const user = await requirePermission('pms.import');
    const files = formData
      .getAll('reports')
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);

    if (!files.length) {
      return { ok: false as const, error: 'Adjunta al menos un informe en PDF, Excel, CSV o TSV.' };
    }

    const incoming = [];
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) {
        return { ok: false as const, error: `El archivo ${file.name} supera los 8 MB permitidos.` };
      }
      incoming.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
    }

    const preview = await prepareImport(user, incoming);
    batchId = preview.batchId;
    revalidatePath('/huespedes/importar');
    return {
      ok: true as const,
      message: `Se leyeron ${preview.stays.length} filas de ${preview.reports.length} informe(s).`,
      id: preview.batchId,
    };
  });

  if (batchId) {
    const query = new URLSearchParams({ revision: batchId });
    if (returnTo) query.set('volverA', returnTo);
    redirect(`/huespedes/importar?${query.toString()}`);
  }
  return result;
}

export async function applyGuestReservationImportAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  let completed = false;
  let destination = '/huespedes';

  const result = await runAction(async () => {
    const user = await requirePermission('pms.import');
    const input = parseOrThrow(batchSchema, formDataToObject(formData));
    destination = input.returnTo === 'turno' ? '/turno' : '/huespedes';

    const batch = await prisma.pmsImportBatch.findUnique({
      where: { id: input.batchId },
      select: { id: true, status: true, businessDate: true },
    });
    if (!batch) throw new NotFoundError('Esa importación no existe.');
    if (batch.status === PmsImportStatus.DESCARTADO) {
      throw new RuleError('Esa importación fue descartada y no puede aplicarse.');
    }

    const outcome = batch.status === PmsImportStatus.BORRADOR ? await applyImport(user, batch.id) : null;
    const core = await prisma.$transaction(
      (tx) => syncReservationCoreFromPms(tx, { businessDate: batch.businessDate }),
      { timeout: 30_000, maxWait: 10_000 },
    );

    refreshContext();
    completed = true;

    const operation = outcome
      ? `${outcome.created} estadías nuevas, ${outcome.updated} actualizadas`
      : 'estado operativo ya aplicado';

    return {
      ok: true as const,
      message:
        `Listo: ${operation}; ${core.reservationsCreated} reserva(s) creada(s), ` +
        `${core.guestsCreated} huésped(es) creado(s) y ${core.staysLinked} estadía(s) enlazada(s).`,
    };
  });

  if (completed) redirect(destination);
  return result;
}

export async function discardGuestReservationImportAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  let completed = false;
  let destination = '/huespedes';
  const result = await runAction(async () => {
    const user = await requirePermission('pms.import');
    const input = parseOrThrow(batchSchema, formDataToObject(formData));
    destination = input.returnTo === 'turno' ? '/turno' : '/huespedes';
    await discardImport(user, input.batchId);
    refreshContext();
    completed = true;
    return { ok: true as const, message: 'Carga descartada. No se cambió ningún dato operativo.' };
  });
  if (completed) redirect(destination);
  return result;
}
