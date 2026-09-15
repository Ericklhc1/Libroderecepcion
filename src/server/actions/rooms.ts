'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { KeyType } from '@prisma/client';
import {
  formDataToObject,
  parseOrThrow,
  runAction,
  zOptionalCuid,
  zOptionalString,
  type ActionState,
} from '@/server/action';
import { requirePermission } from '@/server/auth/guard';
import { confirmCheckIn, confirmCheckOut } from '@/server/services/rooms';
import {
  createKey,
  giveExtraCopy,
  reinstateKey,
  returnKey,
  setKeyIncidentStatus,
} from '@/server/services/keys';
import { applyImport, discardImport, prepareImport } from '@/server/services/pms-import';

/**
 * Acciones del módulo de habitaciones y llaves.
 *
 * Igual que en el resto del sistema: validan, exigen el permiso y delegan en un
 * servicio. Las reglas —la cola de entrada, las llaves por estado— viven en el
 * servidor, así que ninguna pantalla puede saltárselas.
 */

function refreshRooms(roomNumber?: string | null) {
  revalidatePath('/habitaciones');
  revalidatePath('/llaves');
  revalidatePath('/');
  revalidatePath('/supervision');
  if (roomNumber) revalidatePath(`/habitaciones/${roomNumber}`);
}

const stayActionSchema = z.object({
  stayId: z.string().min(1),
  note: zOptionalString,
});

export async function confirmCheckOutAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.manage');
    const input = parseOrThrow(stayActionSchema, formDataToObject(formData));
    const result = await confirmCheckOut(user, input);
    refreshRooms(result.roomNumber);
    return {
      ok: true as const,
      message: `Salida confirmada. La habitación ${result.roomNumber ?? ''} quedó liberada y la llave volvió al inventario.`.trim(),
    };
  });
}

const checkInSchema = stayActionSchema.extend({ keyId: zOptionalCuid });

export async function confirmCheckInAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.manage');
    const input = parseOrThrow(checkInSchema, formDataToObject(formData));
    const result = await confirmCheckIn(user, input);
    refreshRooms(result.roomNumber);
    return {
      ok: true as const,
      message: result.keyCode
        ? `Check-in confirmado en la ${result.roomNumber}. Llave ${result.keyCode} entregada.`
        : `Check-in confirmado en la ${result.roomNumber}. No había llave disponible: revisa el inventario.`,
    };
  });
}

// --------------------------------- Llaves ---------------------------------

const keySchema = z.object({ keyId: z.string().min(1), note: zOptionalString });

export async function returnKeyAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.assign');
    const input = parseOrThrow(keySchema, formDataToObject(formData));
    const result = await returnKey(user, input);
    refreshRooms();
    return { ok: true as const, message: `Llave ${result.code} recibida y disponible.` };
  });
}

const extraCopySchema = z.object({
  roomId: z.string().min(1),
  keyId: zOptionalCuid,
  note: zOptionalString,
});

export async function giveExtraCopyAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.stock');
    const input = parseOrThrow(extraCopySchema, formDataToObject(formData));
    const result = await giveExtraCopy(user, input);
    refreshRooms();
    return { ok: true as const, message: `Copia ${result.code} entregada y descontada del stock.` };
  });
}

const keyIncidentSchema = z.object({
  keyId: z.string().min(1),
  status: z.enum(['EXTRAVIADA', 'FUERA_DE_SERVICIO']),
  reason: z
    .string({ required_error: 'Explica el motivo' })
    .trim()
    .min(5, 'Explica el motivo en al menos 5 caracteres')
    .max(300),
});

export async function setKeyIncidentStatusAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.stock');
    const input = parseOrThrow(keyIncidentSchema, formDataToObject(formData));
    const result = await setKeyIncidentStatus(user, input);
    refreshRooms();
    return {
      ok: true as const,
      message: `Llave ${result.code} marcada como ${
        input.status === 'EXTRAVIADA' ? 'extraviada' : 'fuera de servicio'
      }.`,
    };
  });
}

export async function reinstateKeyAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.stock');
    const input = parseOrThrow(keySchema, formDataToObject(formData));
    const result = await reinstateKey(user, input);
    refreshRooms();
    return { ok: true as const, message: `Llave ${result.code} reintegrada al stock.` };
  });
}

const createKeySchema = z.object({
  code: z
    .string({ required_error: 'El código es obligatorio' })
    .trim()
    .min(2, 'El código debe tener al menos 2 caracteres')
    .max(30),
  type: z.nativeEnum(KeyType),
  roomNumber: zOptionalString,
  notes: zOptionalString,
});

export async function createKeyAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.stock');
    const input = parseOrThrow(createKeySchema, formDataToObject(formData));
    const result = await createKey(user, input);
    refreshRooms();
    return { ok: true as const, message: `Llave ${result.code} agregada al inventario.` };
  });
}

// ------------------------------ Importación -------------------------------

export async function prepareImportAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  let batchId: string | null = null;

  const result = await runAction(async () => {
    const user = await requirePermission('pms.import');

    const files = formData
      .getAll('reports')
      .filter((entry): entry is File => entry instanceof File && entry.size > 0);
    if (!files.length) {
      return { ok: false as const, error: 'Adjunta los informes del PMS en PDF.' };
    }

    const incoming = [];
    for (const file of files) {
      if (file.size > 8 * 1024 * 1024) {
        return {
          ok: false as const,
          error: `El archivo ${file.name} supera los 8 MB permitidos.`,
        };
      }
      incoming.push({ name: file.name, data: new Uint8Array(await file.arrayBuffer()) });
    }

    const preview = await prepareImport(user, incoming);
    revalidatePath('/habitaciones/importar');
    // Lleva directo a la revisión: leer y revisar es un solo gesto.
    batchId = preview.batchId;
    return {
      ok: true as const,
      message: `Se leyeron ${preview.stays.length} filas de ${preview.reports.length} informe(s).`,
      id: preview.batchId,
    };
  });

  if (batchId) redirect(`/habitaciones/importar?revision=${batchId}`);
  return result;
}

const batchSchema = z.object({ batchId: z.string().min(1) });

export async function applyImportAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('pms.import');
    const input = parseOrThrow(batchSchema, formDataToObject(formData));
    const result = await applyImport(user, input.batchId);
    refreshRooms();
    revalidatePath('/habitaciones/importar');
    return {
      ok: true as const,
      message:
        `Listo: ${result.created} estadías nuevas, ${result.updated} actualizadas, ` +
        `${result.preserved} conservadas por decisión manual` +
        (result.skipped ? `, ${result.skipped} sin habitación` : '') +
        (result.keysFlagged ? `, ${result.keysFlagged} llave(s) por devolver` : '') +
        '.',
    };
  });
}

export async function discardImportAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('pms.import');
    const input = parseOrThrow(batchSchema, formDataToObject(formData));
    await discardImport(user, input.batchId);
    revalidatePath('/habitaciones/importar');
    return { ok: true as const, message: 'Importación descartada. No se cambió nada.' };
  });
}
