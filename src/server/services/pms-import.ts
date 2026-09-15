import 'server-only';
import {
  AuditAction,
  KeyAction,
  KeyStatus,
  PmsImportStatus,
  RoomStayStage,
  RoomStayStatus,
} from '@prisma/client';
import type { Prisma ,
  PmsReportKind} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { readPdfFragments } from '@/server/pms/read-pdf';
import { readStructuredReport } from '@/domain/pms/layout';
import { normalizeReport, REPORT_LABELS, type NormalizedStay } from '@/domain/pms/normalize';
import { detectConflicts, type Conflict } from '@/domain/pms/conflicts';
import { buildRoomSnapshot, type KeyFacts, type StayFacts } from '@/domain/rooms';

/**
 * Importación de los informes del PMS.
 *
 * El proceso es deliberadamente de dos pasos: primero se leen los informes y se
 * arma una propuesta, y sólo después —cuando alguien la revisó— se aplica. Así
 * un informe mal exportado no puede arrasar con el estado del mesón, y las
 * decisiones que ya tomó una persona no se deshacen por volver a importar.
 */

/** Cómo llega cada archivo a la importación. */
export type IncomingFile = { name: string; data: Uint8Array };

export type ReportMeta = {
  fileName: string;
  kind: PmsReportKind | null;
  kindSource: string | null;
  title: string | null;
  reportDate: string | null;
  columns: Array<{ header: string; field: string }>;
  unmapped: string[];
  declaredTotals: Array<{ label: string; numbers: number[] }>;
  rowsRead: number;
  ignoredLines: string[];
  error: string | null;
};

/** Estadía tal como se guarda en el borrador, con fechas serializadas. */
type StayDraft = {
  reservationId: string;
  roomNumber: string | null;
  guestNames: string[];
  channel: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
  pmsStatus: string | null;
  sourceReport: PmsReportKind;
  status: RoomStayStatus;
  issues: string[];
};

export type ImportPreview = {
  batchId: string;
  businessDate: Date;
  reports: ReportMeta[];
  stays: StayDraft[];
  /** Filas que no pueden aplicarse porque no hay habitación donde ponerlas. */
  orphans: Array<{ reservationId: string; guestNames: string[]; roomNumber: string | null; reason: string }>;
  conflicts: Conflict[];
  /** Estadías ya intervenidas a mano que la importación no va a modificar. */
  protectedStays: Array<{ roomNumber: string; reservationId: string; status: RoomStayStatus; reason: string }>;
  counts: { checkIn: number; inHouse: number; checkOut: number };
};

const STATUS_BY_KIND: Record<PmsReportKind, RoomStayStatus> = {
  ENTRADAS: RoomStayStatus.CHECK_IN,
  IN_HOUSE: RoomStayStatus.IN_HOUSE,
  SALIDAS: RoomStayStatus.CHECK_OUT,
};

function toDraft(stay: NormalizedStay): StayDraft {
  return {
    reservationId: stay.reservationId,
    roomNumber: stay.roomNumber,
    guestNames: stay.guestNames,
    channel: stay.channel,
    arrivalDate: stay.arrivalDate ? stay.arrivalDate.toISOString() : null,
    departureDate: stay.departureDate ? stay.departureDate.toISOString() : null,
    pmsStatus: stay.pmsStatus,
    sourceReport: stay.sourceReport as PmsReportKind,
    status: STATUS_BY_KIND[stay.sourceReport as PmsReportKind],
    issues: stay.issues,
  };
}

function midnight(date: Date): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

/**
 * Lee los archivos y deja un borrador listo para revisar. No toca el estado
 * operativo: sólo guarda lo que entendió y lo que le llamó la atención.
 */
export async function prepareImport(
  user: CurrentUser,
  files: IncomingFile[],
): Promise<ImportPreview> {
  if (!files.length) throw new RuleError('Adjunta al menos un informe en PDF.');

  const reports: ReportMeta[] = [];
  const stays: StayDraft[] = [];
  const reportDates: Date[] = [];

  for (const file of files) {
    try {
      const fragments = await readPdfFragments(file.data);
      const structured = readStructuredReport(fragments);
      const normalized = normalizeReport(structured);

      if (!normalized) {
        reports.push({
          fileName: file.name,
          kind: null,
          kindSource: null,
          title: structured.title,
          reportDate: structured.reportDate,
          columns: structured.columns.map((column) => ({
            header: column.header,
            field: column.field,
          })),
          unmapped: structured.unmapped.map((column) => column.header),
          declaredTotals: structured.summary,
          rowsRead: 0,
          ignoredLines: structured.ignoredLines,
          error:
            'No se pudo identificar el tipo de informe. Revisa que sea el informe de ' +
            'entradas, in house o salidas del PMS.',
        });
        continue;
      }

      if (normalized.reportDate) reportDates.push(normalized.reportDate);
      for (const stay of normalized.stays) stays.push(toDraft(stay));

      reports.push({
        fileName: file.name,
        kind: normalized.kind as PmsReportKind,
        kindSource: normalized.kindSource,
        title: normalized.title,
        reportDate: normalized.reportDate ? normalized.reportDate.toISOString() : null,
        columns: normalized.columns.map((column) => ({
          header: column.header,
          field: column.field,
        })),
        unmapped: normalized.unmapped.map((column) => column.header),
        declaredTotals: normalized.summary,
        rowsRead: normalized.stays.length,
        ignoredLines: normalized.ignoredLines,
        error: null,
      });
    } catch (error) {
      reports.push({
        fileName: file.name,
        kind: null,
        kindSource: null,
        title: null,
        reportDate: null,
        columns: [],
        unmapped: [],
        declaredTotals: [],
        rowsRead: 0,
        ignoredLines: [],
        error:
          error instanceof Error
            ? `No se pudo leer el archivo: ${error.message}`
            : 'No se pudo leer el archivo.',
      });
    }
  }

  const kinds = reports.map((report) => report.kind).filter(Boolean);
  if (new Set(kinds).size !== kinds.length) {
    throw new RuleError(
      'Hay dos archivos del mismo tipo de informe. Adjunta una sola copia de cada uno.',
    );
  }

  const businessDate = midnight(
    reportDates.sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date(),
  );

  const analysis = await analyseDraft(businessDate, stays);

  const batch = await prisma.pmsImportBatch.create({
    data: {
      businessDate,
      status: PmsImportStatus.BORRADOR,
      reports: reports as unknown as Prisma.InputJsonValue,
      payload: stays as unknown as Prisma.InputJsonValue,
      summary: {
        counts: analysis.counts,
        conflicts: analysis.conflicts.length,
        orphans: analysis.orphans.length,
      } as unknown as Prisma.InputJsonValue,
      createdById: user.id,
    },
    select: { id: true },
  });

  return {
    batchId: batch.id,
    businessDate,
    reports,
    stays,
    ...analysis,
  };
}

/**
 * Calcula, sin escribir nada, cómo quedaría el estado si se aplicara el
 * borrador: qué conflictos aparecen y qué decisiones manuales se conservan.
 */
async function analyseDraft(
  businessDate: Date,
  stays: StayDraft[],
): Promise<Omit<ImportPreview, 'batchId' | 'businessDate' | 'reports' | 'stays'>> {
  const rooms = await prisma.room.findMany({
    where: { active: true },
    select: {
      id: true,
      number: true,
      stays: {
        where: { deletedAt: null },
        select: {
          id: true,
          reservationId: true,
          guestNames: true,
          status: true,
          stage: true,
          arrivalDate: true,
          departureDate: true,
          channel: true,
          touchedManually: true,
          businessDate: true,
        },
      },
      keys: { select: { id: true, code: true, type: true, status: true, stayId: true } },
    },
  });

  const byNumber = new Map(rooms.map((room) => [room.number, room]));
  const orphans: ImportPreview['orphans'] = [];
  const protectedStays: ImportPreview['protectedStays'] = [];

  // Estado propuesto: lo que hay hoy, más lo que traen los informes.
  const projected = new Map<string, StayFacts[]>();
  for (const room of rooms) {
    projected.set(
      room.number,
      room.stays
        .filter((stay) => stay.stage !== RoomStayStage.FINALIZADO)
        .map((stay) => ({
          id: stay.id,
          reservationId: stay.reservationId,
          guestNames: stay.guestNames,
          status: stay.status,
          stage: stay.stage,
          arrivalDate: stay.arrivalDate,
          departureDate: stay.departureDate,
          channel: stay.channel,
        })),
    );
  }

  const counts = { checkIn: 0, inHouse: 0, checkOut: 0 };

  for (const draft of stays) {
    if (draft.status === RoomStayStatus.CHECK_IN) counts.checkIn += 1;
    if (draft.status === RoomStayStatus.IN_HOUSE) counts.inHouse += 1;
    if (draft.status === RoomStayStatus.CHECK_OUT) counts.checkOut += 1;

    if (!draft.roomNumber) {
      orphans.push({
        reservationId: draft.reservationId,
        guestNames: draft.guestNames,
        roomNumber: null,
        reason: 'El informe no trae número de habitación.',
      });
      continue;
    }
    const room = byNumber.get(draft.roomNumber);
    if (!room) {
      orphans.push({
        reservationId: draft.reservationId,
        guestNames: draft.guestNames,
        roomNumber: draft.roomNumber,
        reason: 'La habitación no existe en el inventario del hotel.',
      });
      continue;
    }

    const existing = room.stays.find(
      (stay) =>
        stay.reservationId === draft.reservationId &&
        stay.status === draft.status &&
        midnight(stay.businessDate).getTime() === businessDate.getTime(),
    );

    if (existing && (existing.touchedManually || existing.stage !== RoomStayStage.PENDIENTE)) {
      protectedStays.push({
        roomNumber: room.number,
        reservationId: draft.reservationId,
        status: draft.status,
        reason: existing.touchedManually
          ? 'Alguien ya la confirmó o la editó a mano: se conservan esos datos.'
          : `Ya está en etapa ${existing.stage}: la importación no la mueve atrás.`,
      });
      continue;
    }
    if (existing) continue;

    const list = projected.get(room.number) ?? [];
    list.push({
      id: `nuevo:${draft.status}:${draft.reservationId}:${room.number}`,
      reservationId: draft.reservationId,
      guestNames: draft.guestNames,
      status: draft.status,
      stage:
        draft.status === RoomStayStatus.IN_HOUSE
          ? RoomStayStage.CONFIRMADO
          : RoomStayStage.PENDIENTE,
      arrivalDate: draft.arrivalDate ? new Date(draft.arrivalDate) : null,
      departureDate: draft.departureDate ? new Date(draft.departureDate) : null,
      channel: draft.channel,
    });
    projected.set(room.number, list);
  }

  const conflicts = detectConflicts({
    rooms: rooms.map((room) => ({
      number: room.number,
      stays: projected.get(room.number) ?? [],
      keys: room.keys as KeyFacts[],
    })),
    orphanStays: orphans.map((orphan) => ({
      reservationId: orphan.reservationId,
      guestNames: orphan.guestNames,
      roomNumber: orphan.roomNumber,
      sourceReport: 'informe del PMS',
      reason: orphan.reason,
    })),
  });

  return { orphans, conflicts, protectedStays, counts };
}

/** Vuelve a cargar un borrador guardado, con su análisis recalculado. */
export async function getImportPreview(batchId: string): Promise<ImportPreview> {
  const batch = await prisma.pmsImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new NotFoundError('Esa importación no existe.');

  const stays = batch.payload as unknown as StayDraft[];
  const analysis = await analyseDraft(midnight(batch.businessDate), stays);

  return {
    batchId: batch.id,
    businessDate: batch.businessDate,
    reports: batch.reports as unknown as ReportMeta[],
    stays,
    ...analysis,
  };
}

export type ImportResult = {
  created: number;
  updated: number;
  preserved: number;
  skipped: number;
  keysFlagged: number;
};

/**
 * Aplica un borrador revisado.
 *
 * Es idempotente: volver a aplicar el mismo informe no duplica nada, porque la
 * clave de una estadía es la fecha de operación más reserva, habitación y
 * estado. Lo que ya tocó una persona se deja como está.
 */
export async function applyImport(
  user: CurrentUser,
  batchId: string,
): Promise<ImportResult> {
  const result = await prisma.$transaction(
    async (tx) => {
    const batch = await tx.pmsImportBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundError('Esa importación no existe.');
    if (batch.status !== PmsImportStatus.BORRADOR) {
      throw new RuleError('Esa importación ya fue aplicada o descartada.');
    }

    const businessDate = midnight(batch.businessDate);
    const drafts = batch.payload as unknown as StayDraft[];
    const summary: ImportResult = {
      created: 0,
      updated: 0,
      preserved: 0,
      skipped: 0,
      keysFlagged: 0,
    };

    const rooms = await tx.room.findMany({ select: { id: true, number: true } });
    const byNumber = new Map(rooms.map((room) => [room.number, room]));

    /*
      Todo lo que sigue está escrito por lotes. Una consulta por fila es barata
      contra una base local y ruinosa contra una base remota: cincuenta y siete
      filas a 120 ms por consulta agotan cualquier transacción. Se lee el estado
      de una vez, se decide en memoria y se escribe agrupado.
    */
    const existingStays = await tx.roomStay.findMany({
      where: { businessDate },
      select: {
        id: true,
        reservationId: true,
        roomId: true,
        status: true,
        stage: true,
        touchedManually: true,
        guestNames: true,
        channel: true,
        arrivalDate: true,
        departureDate: true,
        pmsStatus: true,
      },
    });

    const keyOf = (reservationId: string, roomId: string | null, status: RoomStayStatus) =>
      `${reservationId}|${roomId ?? ''}|${status}`;
    const existingByKey = new Map(
      existingStays.map((stay) => [keyOf(stay.reservationId, stay.roomId, stay.status), stay]),
    );

    const toCreate: Prisma.RoomStayCreateManyInput[] = [];
    const toUpdate: Array<{ id: string; data: Prisma.RoomStayUpdateInput }> = [];

    const sameDay = (a: Date | null, b: Date | null) =>
      a && b ? a.getTime() === b.getTime() : a === b;

    for (const draft of drafts) {
      const room = draft.roomNumber ? byNumber.get(draft.roomNumber) : null;
      if (!room) {
        summary.skipped += 1;
        continue;
      }

      const descriptive = {
        guestNames: draft.guestNames,
        channel: draft.channel,
        arrivalDate: draft.arrivalDate ? new Date(draft.arrivalDate) : null,
        departureDate: draft.departureDate ? new Date(draft.departureDate) : null,
        pmsStatus: draft.pmsStatus,
        sourceReport: draft.sourceReport,
        batchId: batch.id,
      };

      const existing = existingByKey.get(keyOf(draft.reservationId, room.id, draft.status));

      if (existing) {
        const protectedStay =
          existing.touchedManually || existing.stage !== RoomStayStage.PENDIENTE;
        if (protectedStay) summary.preserved += 1;
        else summary.updated += 1;

        // Sólo se escribe si algo cambió de verdad: un informe idéntico no
        // genera ninguna escritura.
        const unchanged =
          existing.guestNames.join('\u0000') === draft.guestNames.join('\u0000') &&
          existing.channel === descriptive.channel &&
          existing.pmsStatus === descriptive.pmsStatus &&
          sameDay(existing.arrivalDate, descriptive.arrivalDate) &&
          sameDay(existing.departureDate, descriptive.departureDate);
        if (!unchanged) toUpdate.push({ id: existing.id, data: descriptive });
        continue;
      }

      toCreate.push({
        ...descriptive,
        reservationId: draft.reservationId,
        roomId: room.id,
        status: draft.status,
        stage:
          draft.status === RoomStayStatus.IN_HOUSE
            ? RoomStayStage.CONFIRMADO
            : RoomStayStage.PENDIENTE,
        businessDate,
      });
      summary.created += 1;
    }

    if (toCreate.length) {
      await tx.roomStay.createMany({ data: toCreate, skipDuplicates: true });
    }
    for (const update of toUpdate) {
      await tx.roomStay.update({ where: { id: update.id }, data: update.data });
    }

    /*
      Las salidas informadas dejan la llave marcada como pendiente de
      devolución: el huésped todavía la tiene, pero el mesón ya sabe que hay que
      recuperarla. La llave se reasigna a la estadía de salida para que
      confirmar esa salida la devuelva al inventario.
    */
    const departures = await tx.roomStay.findMany({
      where: {
        businessDate,
        status: RoomStayStatus.CHECK_OUT,
        stage: RoomStayStage.PENDIENTE,
        deletedAt: null,
        roomId: { not: null },
      },
      select: { id: true, roomId: true },
    });

    const departureByRoom = new Map(
      departures
        .filter((departure) => departure.roomId)
        .map((departure) => [departure.roomId as string, departure.id]),
    );

    const heldKeys = departureByRoom.size
      ? await tx.roomKey.findMany({
          where: {
            roomId: { in: [...departureByRoom.keys()] },
            status: { in: [KeyStatus.ASIGNADA, KeyStatus.COPIA_ADICIONAL] },
          },
          select: { id: true, status: true, roomId: true },
        })
      : [];

    if (heldKeys.length) {
      // Una actualización por estadía de salida, no una por llave.
      for (const [roomId, stayId] of departureByRoom) {
        const keys = heldKeys.filter((key) => key.roomId === roomId);
        if (!keys.length) continue;
        await tx.roomKey.updateMany({
          where: { id: { in: keys.map((key) => key.id) } },
          data: { status: KeyStatus.PENDIENTE_DEVOLUCION, stayId },
        });
      }

      await tx.keyMovement.createMany({
        data: heldKeys.map((key) => ({
          keyId: key.id,
          action: KeyAction.MARCADA_PENDIENTE_DEVOLUCION,
          fromStatus: key.status,
          toStatus: KeyStatus.PENDIENTE_DEVOLUCION,
          roomId: key.roomId,
          stayId: key.roomId ? (departureByRoom.get(key.roomId) ?? null) : null,
          userId: user.id,
          note: 'Salida informada por el PMS',
        })),
      });
      summary.keysFlagged = heldKeys.length;
    }

    await tx.pmsImportBatch.update({
      where: { id: batch.id },
      data: {
        status: PmsImportStatus.APLICADO,
        appliedAt: new Date(),
        appliedById: user.id,
        summary: { ...(batch.summary as object), applied: summary } as unknown as Prisma.InputJsonValue,
      },
    });

    return summary;
    },
    // La base puede estar lejos del servidor: el plazo por omisión de cinco
    // segundos no alcanza para una importación completa.
    { timeout: 30_000, maxWait: 10_000 },
  );

  await recordAudit({
    entity: 'PmsImportBatch',
    entityId: batchId,
    action: AuditAction.CONFIGURAR,
    user,
    summary:
      `Informes del PMS aplicados: ${result.created} estadías nuevas, ` +
      `${result.updated} actualizadas, ${result.preserved} conservadas por decisión manual, ` +
      `${result.skipped} sin habitación, ${result.keysFlagged} llave(s) por devolver`,
    after: result,
  });

  return result;
}

export async function discardImport(user: CurrentUser, batchId: string): Promise<void> {
  const batch = await prisma.pmsImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new NotFoundError('Esa importación no existe.');
  if (batch.status !== PmsImportStatus.BORRADOR) {
    throw new RuleError('Esa importación ya fue aplicada o descartada.');
  }
  await prisma.pmsImportBatch.update({
    where: { id: batchId },
    data: { status: PmsImportStatus.DESCARTADO, discardedAt: new Date() },
  });
  await recordAudit({
    entity: 'PmsImportBatch',
    entityId: batchId,
    action: AuditAction.CONFIGURAR,
    user,
    summary: 'Importación de informes del PMS descartada sin aplicar',
  });
}

/** Conflictos del estado vigente, con la misma lógica que la revisión. */
export async function getLiveConflicts(): Promise<Conflict[]> {
  const rooms = await prisma.room.findMany({
    where: { active: true },
    select: {
      number: true,
      stays: {
        where: { deletedAt: null },
        select: {
          id: true,
          reservationId: true,
          guestNames: true,
          status: true,
          stage: true,
          arrivalDate: true,
          departureDate: true,
          channel: true,
        },
      },
      keys: { select: { id: true, code: true, type: true, status: true, stayId: true } },
    },
  });

  return detectConflicts({
    rooms: rooms.map((room) => ({
      number: room.number,
      stays: room.stays as StayFacts[],
      keys: room.keys as KeyFacts[],
    })),
    orphanStays: [],
  });
}

export async function listImportBatches(limit = 20) {
  return prisma.pmsImportBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      businessDate: true,
      status: true,
      createdAt: true,
      appliedAt: true,
      summary: true,
      createdBy: { select: { name: true } },
      appliedBy: { select: { name: true } },
    },
  });
}

export { REPORT_LABELS, buildRoomSnapshot };
