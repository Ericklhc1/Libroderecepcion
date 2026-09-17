'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { AuditAction, KeyType } from '@prisma/client';
import {
  formDataToObject,
  parseOrThrow,
  runAction,
  zOptionalCuid,
  zOptionalString,
  zRequiredString,
  type ActionState,
} from '@/server/action';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import { requirePermission } from '@/server/auth/guard';
import { confirmCheckIn, confirmCheckOut } from '@/server/services/rooms';
import {
  createKey,
  giveExtraCopy,
  handMainKey,
  reconcilePrincipalKeys,
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
  revalidatePath('/turno');
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
      message:
        `Salida confirmada. La habitación ${result.roomNumber ?? ''} quedó liberada.` +
        (result.pendingKeys > 0
          ? ` Quedan ${result.pendingKeys} llave(s) por recibir.`
          : ''),
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

/**
 * Entrega la llave principal a quien está alojado.
 *
 * Permiso `key.assign` —el del mesón—, no `key.stock`, que es el del stock del
 * Supervisor. Ésa era parte del problema: el único gesto de llaves visible en
 * la ficha exigía `key.stock`, así que un recepcionista no veía ninguno.
 */
export async function handMainKeyAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.assign');
    const input = parseOrThrow(extraCopySchema, formDataToObject(formData));
    const result = await handMainKey(user, input);
    refreshRooms();
    return {
      ok: true as const,
      message: `Llave ${result.code} entregada a la habitación ${result.roomNumber}.`,
    };
  });
}

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

/**
 * Reconciliación explícita del inventario de llaves.
 *
 * Existe por una inconsistencia histórica real: las estadías importadas antes
 * de que existiera la asignación automática quedaron con sus llaves en el
 * inventario, y el tablero no reflejaba la ocupación.
 *
 * No es una segunda lógica ni un parche permanente: llama a la **misma**
 * función que usa la importación (`reconcilePrincipalKeys`), sin acotar el día
 * para que alcance también a las estadías antiguas. Es idempotente: repetirla
 * no escribe nada si todo está donde debe.
 *
 * La ejecuta una persona a propósito, no un proceso automático.
 */
export async function reconcileKeysAction(): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('key.stock');

    const assigned = await prisma.$transaction(
      (tx) =>
        reconcilePrincipalKeys(tx, user, { note: 'reconciliación del inventario' }),
      // El cruce recorre todas las estadías activas: con la base en otra
      // región, el plazo por omisión de cinco segundos no alcanza.
      { timeout: 30_000, maxWait: 10_000 },
    );

    if (assigned > 0) {
      await recordAudit({
        entity: 'RoomKey',
        entityId: 'inventario',
        action: AuditAction.CONFIGURAR,
        user,
        summary: `Inventario de llaves reconciliado: ${assigned} llave(s) principal(es) entregada(s) a su ocupante`,
        after: { assigned },
      });
    }

    refreshRooms();
    return {
      ok: true as const,
      message:
        assigned === 0
          ? 'El inventario ya estaba al día: ninguna llave necesitaba cambio.'
          : `Listo: ${assigned} llave(s) principal(es) quedaron con su ocupante. ` +
            'Las entradas sin confirmar siguen sin llave.',
    };
  });
}

// ------------------------------ Importación -------------------------------

/**
 * A dónde volver después de importar.
 *
 * Los informes se cargan desde el inicio de turno o desde Habitaciones, y hay
 * que volver al sitio del que se vino. El destino llega en el formulario, así
 * que **no se usa tal cual**: se compara contra una lista de destinos válidos.
 * Un parámetro de la petición no decide a dónde se manda al usuario.
 */
const RETURN_TO = { turno: '/turno', habitaciones: '/habitaciones' } as const;
type ReturnKey = keyof typeof RETURN_TO;

function returnKeyOf(formData: FormData): ReturnKey | null {
  const raw = formData.get('volverA');
  return typeof raw === 'string' && raw in RETURN_TO ? (raw as ReturnKey) : null;
}

export async function prepareImportAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  let batchId: string | null = null;
  const back = returnKeyOf(formData);

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

  if (batchId) {
    const query = back ? `?revision=${batchId}&volverA=${back}` : `?revision=${batchId}`;
    redirect(`/habitaciones/importar${query}`);
  }
  return result;
}

const batchSchema = z.object({ batchId: z.string().min(1) });

export async function applyImportAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  const back = returnKeyOf(formData);
  let applied = false;

  const result = await runAction(async () => {
    const user = await requirePermission('pms.import');
    const input = parseOrThrow(batchSchema, formDataToObject(formData));
    const outcome = await applyImport(user, input.batchId);
    refreshRooms();
    revalidatePath('/habitaciones/importar');
    revalidatePath('/turno');
    applied = true;
    return {
      ok: true as const,
      message:
        `Listo: ${outcome.created} estadías nuevas, ${outcome.updated} actualizadas, ` +
        `${outcome.preserved} conservadas por decisión manual` +
        (outcome.skipped ? `, ${outcome.skipped} sin habitación` : '') +
        (outcome.keysAssigned
          ? `, ${outcome.keysAssigned} llave(s) principal(es) entregada(s) a su ocupante`
          : '') +
        (outcome.keysFlagged ? `, ${outcome.keysFlagged} copia(s) por devolver` : '') +
        '.',
    };
  });

  // Aplicado desde el inicio de turno: se vuelve al turno, que es donde la
  // persona estaba trabajando. El `redirect` va fuera de `runAction` porque
  // lanza por diseño y no debe leerse como un fallo de la acción.
  if (applied && back) redirect(RETURN_TO[back]);
  return result;
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

/**
 * Elimina una estadía para desatascar un conflicto.
 *
 * Reservada al Administrador de sistema (`stay.delete`). El motivo es
 * obligatorio, como en toda eliminación del sistema: una estadía que
 * desaparece sin explicación es peor que el conflicto que resolvía.
 */
export async function deleteStayAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('stay.delete');
    const input = parseOrThrow(
      z.object({
        stayId: z.string().min(1),
        reason: zRequiredString(500, 'El motivo'),
      }),
      formDataToObject(formData),
    );

    const { softDeleteStay } = await import('@/server/services/rooms');
    const result = await softDeleteStay(user, input);

    revalidatePath('/habitaciones');
    revalidatePath(`/habitaciones/${result.stay.room?.number ?? ''}`);
    revalidatePath('/llaves');
    revalidatePath('/supervision');

    return {
      ok: true as const,
      message:
        result.releasedKeys > 0
          ? `Estadía eliminada y ${result.releasedKeys} llave(s) devuelta(s) al inventario.`
          : 'Estadía eliminada.',
    };
  });
}

/**
 * Resetea una habitación atascada por duplicidad.
 *
 * Administrador de sistema y Supervisor (`room.reset`): el atasco ocurre en el
 * mesón y hay que poder resolverlo sin esperar al administrador.
 */
export async function resetRoomAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const user = await requirePermission('room.reset');
    const input = parseOrThrow(
      z.object({
        roomNumber: z.string().trim().min(1),
        reason: zRequiredString(500, 'El motivo'),
      }),
      formDataToObject(formData),
    );

    const { resetRoom } = await import('@/server/services/rooms');
    const result = await resetRoom(user, input);

    revalidatePath('/habitaciones');
    revalidatePath(`/habitaciones/${result.room.number}`);
    revalidatePath('/llaves');
    revalidatePath('/supervision');

    // Se dice lo que pasó de verdad, incluido «no había nada que colapsar».
    if (result.collapsed === 0 && result.releasedKeys === 0 && result.reassignedKeys === 0) {
      return {
        ok: true as const,
        message:
          'No había duplicidad que resolver: la habitación ya estaba coherente y no se tocó nada.',
      };
    }

    return {
      ok: true as const,
      message:
        `Habitación ${result.room.number} reseteada: ${result.collapsed} estadía(s) duplicada(s) ` +
        `eliminada(s), ${result.remaining} conservada(s), ${result.reassignedKeys} llave(s) reasignada(s).`,
    };
  });
}
