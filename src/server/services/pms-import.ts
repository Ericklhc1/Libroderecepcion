import 'server-only';
import {
  AuditAction,
  KeyAction,
  KeyStatus,
  PmsImportStatus,
  RoomStayStage,
  RoomStayStatus,
} from '@prisma/client';
import type { PmsReportKind, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hotelCalendarDate } from '@/domain/time';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { readReportFile } from '@/server/pms/read-report-file';
import { readStructuredReport } from '@/domain/pms/layout';
import { hasBlockingPmsIssues } from '@/domain/pms/issues';
import { normalizeReport, REPORT_LABELS, type NormalizedStay } from '@/domain/pms/normalize';
import { detectConflicts, type Conflict } from '@/domain/pms/conflicts';
import {
  decideStayReconciliation,
  reconcileStayState,
  type IncomingEvidence,
  type ReconciliationEvidence,
} from '@/domain/pms/reconciliation';
import {
  buildRoomSnapshot,
  principalKeyHolder,
  type KeyFacts,
  type StayFacts,
  type StayStatus,
} from '@/domain/rooms';
import { reconcilePrincipalKeys } from './keys';

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
  reportGeneratedAt: string | null;
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
  externalId?: string | null;
  roomNumber: string | null;
  guestNames: string[];
  channel: string | null;
  arrivalDate: string | null;
  departureDate: string | null;
  pmsStatus: string | null;
  sourceReport: PmsReportKind;
  status: RoomStayStatus | null;
  /* Lo que aporta «Habitaciones con actividad». Los tres informes antiguos no
     traen nada de esto y lo dejan en nulo. */
  guestCount: number | null;
  totalAmount: number | null;
  pendingAmount: number | null;
  currency: string | null;
  paymentType: string | null;
  paymentTypeRaw: string | null;
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
  /** Resumen del informe de actividad. Es lo que se confirma antes de aplicar. */
  activity: ActivitySummary;
};

/**
 * Lo que hay que poder leer ANTES de aplicar nada.
 *
 * El informe de actividad reemplaza a tres archivos, así que el preview tiene
 * que responder solo las preguntas que antes se contestaban comparando: cuántas
 * habitaciones se mueven, cuántas tienen salida y entrada el mismo día, qué
 * reservas no conocíamos, y cuánto queda por cobrar en cada moneda.
 *
 * Los totales por moneda van separados a propósito: sumar pesos con dólares da
 * un número sin significado, y el informe declara los suyos por separado, lo
 * que permite contrastar lo leído con lo que dice el documento.
 */
export type ActivitySummary = {
  /** Habitaciones distintas con alguna actividad. */
  roomsWithActivity: number;
  occupied: number;
  arrivals: number;
  departures: number;
  /** Habitaciones con salida Y entrada el mismo día: la cola. */
  turnarounds: Array<{ roomNumber: string; leaving: string; arriving: string }>;
  /** Reservas que el sistema no había visto nunca. */
  newReservations: number;
  knownReservations: number;
  /** Reservas con saldo pendiente distinto de cero. */
  withBalance: number;
  /** Pendiente por moneda. Nunca un total único. */
  pendingByCurrency: Record<'CLP' | 'USD', number>;
  totalByCurrency: Record<'CLP' | 'USD', number>;
  /** Una reserva repartida entre varias habitaciones. No es un error. */
  multiRoom: Array<{ reservationId: string; rooms: string[] }>;
  /** Filas con algún problema: van a la bandeja, no se corrigen solas. */
  rowIssues: Array<{ reservationId: string; roomNumber: string | null; issues: string[] }>;
  /** Lo que el informe declara en su pie, para contrastar con lo leído. */
  declared: Array<{ label: string; numbers: number[] }>;
};

/**
 * Convierte una fila normalizada en borrador.
 *
 * El estado se toma de `operationalStatus`, que es lo que ya decidió el
 * normalizador: para los tres informes antiguos viene del TIPO DE INFORME y
 * para «Habitaciones con actividad» de la columna «Tipo» de CADA FILA.
 *
 * Antes se recalculaba acá con un mapa por tipo de informe. Con el informe de
 * actividad ese mapa no puede existir —un solo documento trae los tres
 * estados— y mantenerlo habría marcado sus cincuenta y tres filas con un único
 * estado.
 */
function toDraft(stay: NormalizedStay): StayDraft {
  return {
    reservationId: stay.reservationId,
    externalId: stay.externalId,
    roomNumber: stay.roomNumber,
    guestNames: stay.guestNames,
    channel: stay.channel,
    arrivalDate: stay.arrivalDate ? stay.arrivalDate.toISOString() : null,
    departureDate: stay.departureDate ? stay.departureDate.toISOString() : null,
    pmsStatus: stay.pmsStatus,
    sourceReport: stay.sourceReport as PmsReportKind,
    status: stay.operationalStatus as RoomStayStatus | null,
    guestCount: stay.guestCount,
    /*
      El importe se separa en cifra y moneda al guardarlo. Van juntos siempre:
      una cifra sin su moneda no significa nada cuando el informe trae pesos y
      dólares, y la columna `currency` es la que impide sumarlos.
    */
    totalAmount: stay.totalAmount?.amount ?? null,
    pendingAmount: stay.pendingAmount?.amount ?? null,
    currency: stay.totalAmount?.currency ?? stay.pendingAmount?.currency ?? null,
    paymentType: stay.payment?.type ?? null,
    paymentTypeRaw: stay.payment?.raw ?? null,
    issues: stay.issues,
  };
}

function midnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Lee los archivos y deja un borrador listo para revisar. No toca el estado
 * operativo: sólo guarda lo que entendió y lo que le llamó la atención.
 */
export async function prepareImport(
  user: CurrentUser,
  files: IncomingFile[],
): Promise<ImportPreview> {
  if (!files.length) throw new RuleError('Adjunta al menos un informe del PMS.');

  const reports: ReportMeta[] = [];
  const stays: StayDraft[] = [];
  const reportDates: Date[] = [];

  for (const file of files) {
    try {
      const extractedReports = await readReportFile(file.name, file.data);
      for (const extracted of extractedReports) {
        const structured = readStructuredReport(extracted.fragments);
        const normalized = normalizeReport(structured);

        if (!normalized) {
          reports.push({
            fileName: extracted.name,
            kind: null,
            kindSource: null,
            title: structured.title,
            reportDate: structured.reportDate,
            reportGeneratedAt: structured.reportGeneratedAt,
            columns: structured.columns.map((column) => ({
              header: column.header,
              field: column.field,
            })),
            unmapped: structured.unmapped.map((column) => column.header),
            declaredTotals: structured.summary,
            rowsRead: 0,
            ignoredLines: structured.ignoredLines,
            error:
              'No se pudo determinar el estado operativo. Incluye una columna de ' +
              'tipo/estado, o identifica el archivo como entradas, in house o salidas.',
          });
          continue;
        }

        if (normalized.reportDate) reportDates.push(normalized.reportDate);
        for (const stay of normalized.stays) stays.push(toDraft(stay));

        reports.push({
          fileName: extracted.name,
          kind: normalized.kind as PmsReportKind,
          kindSource: normalized.kindSource,
          title: normalized.title,
          reportDate: normalized.reportDate ? normalized.reportDate.toISOString() : null,
          reportGeneratedAt: structured.reportGeneratedAt,
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
      }
    } catch (error) {
      reports.push({
        fileName: file.name,
        kind: null,
        kindSource: null,
        title: null,
        reportDate: null,
        reportGeneratedAt: null,
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

  /*
    Se pueden adjuntar varios archivos del mismo tipo o un libro con varias
    hojas. Las filas idénticas se colapsan; las que difieren se conservan para
    que el detector de conflictos las haga visibles en la revisión.
  */
  const unique = new Map<string, StayDraft>();
  for (const stay of stays) {
    const key = JSON.stringify([
      stay.reservationId,
      stay.externalId,
      stay.roomNumber,
      stay.status,
      stay.arrivalDate,
      stay.departureDate,
      stay.guestNames,
      stay.channel,
      stay.totalAmount,
      stay.pendingAmount,
      stay.currency,
      stay.pmsStatus,
      stay.guestCount,
      stay.paymentType,
      stay.paymentTypeRaw,
      stay.issues,
    ]);
    if (!unique.has(key)) unique.set(key, stay);
  }
  stays.splice(0, stays.length, ...unique.values());

  const businessDate = midnight(
    reportDates.sort((a, b) => b.getTime() - a.getTime())[0] ?? hotelCalendarDate(),
  );

  const declaredTotals = reports.flatMap((report) => report.declaredTotals);
  const analysis = await analyseDraft(businessDate, stays, declaredTotals);

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
  /*
    Los totales que el informe declara en su pie. Se arrastran hasta el preview
    para poder contrastarlos con lo leído: si el documento dice 24 salidas y se
    leyeron 23, falta una fila y hay que mirarlo antes de aplicar.
  */
  declaredTotals: Array<{ label: string; numbers: number[] }> = [],
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
          externalId: true,
          guestNames: true,
          status: true,
          stage: true,
          arrivalDate: true,
          departureDate: true,
          channel: true,
          touchedManually: true,
          note: true,
          businessDate: true,
        },
      },
      keys: { select: { id: true, code: true, type: true, status: true, stayId: true } },
    },
  });

  const byNumber = new Map(rooms.map((room) => [room.number, room]));
  const orphans: ImportPreview['orphans'] = [];
  const protectedStays: ImportPreview['protectedStays'] = [];
  const reconciliation: Conflict[] = [];
  const roomsPerReservation = new Map<string, Set<string>>();
  for (const stay of stays) {
    if (!stay.roomNumber) continue;
    const set = roomsPerReservation.get(stay.reservationId) ?? new Set<string>();
    set.add(stay.roomNumber);
    roomsPerReservation.set(stay.reservationId, set);
  }

  const existingEvidence: ReconciliationEvidence[] = rooms.flatMap((room) =>
    room.stays.map((stay) => ({
      id: stay.id,
      reservationId: stay.reservationId,
      externalId: stay.externalId,
      guestNames: stay.guestNames,
      roomId: room.id,
      arrivalDate: stay.arrivalDate,
      departureDate: stay.departureDate,
      businessDate: stay.businessDate,
      status: stay.status as StayStatus,
      stage: stay.stage,
      roomMove: Boolean(stay.note?.includes('ROOM MOVE')),
    })),
  );

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
    /*
      Una fila dudosa es una excepción, no una estadía propuesta. Se mantiene
      en el preview mediante `activity.rowIssues`, pero no participa en el
      estado proyectado ni en sus contadores.
    */
    if (!draft.status || hasBlockingPmsIssues(draft.issues)) continue;

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

    const list = projected.get(room.number) ?? [];
    const incoming: IncomingEvidence = {
      reservationId: draft.reservationId,
      externalId: draft.externalId ?? null,
      guestNames: draft.guestNames,
      roomId: room.id,
      arrivalDate: draft.arrivalDate ? new Date(draft.arrivalDate) : null,
      departureDate: draft.departureDate ? new Date(draft.departureDate) : null,
      businessDate,
      status: draft.status as StayStatus,
    };
    const decision = decideStayReconciliation(existingEvidence, incoming, {
      reservationAppearsInSeveralRooms:
        (roomsPerReservation.get(draft.reservationId)?.size ?? 0) > 1,
    });

    if (decision.kind === 'CONFLICT') {
      reconciliation.push({
        kind: 'CONCILIACION_IRRESOLUBLE',
        roomNumber: room.number,
        detail: `${decision.issue}: ${decision.detail}`,
      });
      continue;
    }

    if (decision.kind === 'MATCH') {
      const existing = room.stays.find((stay) => stay.id === decision.stay.id);
      if (decision.duplicateIds.length) {
        reconciliation.push({
          kind: 'RESERVA_DUPLICADA',
          roomNumber: room.number,
          detail:
            `La reserva ${draft.reservationId} ya tiene ${decision.duplicateIds.length + 1} ` +
            'filas para la misma estancia; se usará la más avanzada.',
        });
      }
      const resolved = reconcileStayState(decision.stay, incoming);
      if (existing && (existing.touchedManually || existing.stage !== RoomStayStage.PENDIENTE)) {
        protectedStays.push({
          roomNumber: room.number,
          reservationId: draft.reservationId,
          status: draft.status,
          reason:
            resolved.status === existing.status
              ? 'La evidencia se concilia sin deshacer la intervención operativa existente.'
              : `La estancia evoluciona a ${resolved.status}; llaves y garantías se conservan.`,
        });
      }

      const projectedStay = list.find((stay) => stay.id === decision.stay.id);
      if (projectedStay) {
        projectedStay.status = resolved.status;
        projectedStay.stage = resolved.stage;
        if (resolved.acceptIncomingDetails) {
          if (!resolved.preserveArrivalDate) projectedStay.arrivalDate = incoming.arrivalDate;
          projectedStay.departureDate = incoming.departureDate;
          projectedStay.guestNames = draft.guestNames;
          projectedStay.channel = draft.channel;
        }
      }

      // La siguiente fila del mismo lote debe ver esta transición. Sin esta
      // actualización, CHECK_IN e IN_HOUSE presentes en dos PDFs de la misma
      // carga parecían dos estancias porque el preview sólo consultaba la DB.
      const evidence = existingEvidence.find((item) => item.id === decision.stay.id);
      if (evidence) {
        evidence.status = resolved.status;
        evidence.stage = resolved.stage;
        if (resolved.acceptIncomingDetails) {
          evidence.externalId = incoming.externalId;
          evidence.guestNames = incoming.guestNames;
          if (!resolved.preserveArrivalDate) evidence.arrivalDate = incoming.arrivalDate;
          evidence.departureDate = incoming.departureDate;
          evidence.businessDate = incoming.businessDate;
        }
      }
      continue;
    }

    const temporaryId =
      `nuevo:${draft.reservationId}:${room.number}:` +
      `${draft.arrivalDate ?? businessDate.toISOString()}:${existingEvidence.length}`;
    list.push({
      id: temporaryId,
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
    existingEvidence.push({
      id: temporaryId,
      reservationId: draft.reservationId,
      externalId: draft.externalId ?? null,
      guestNames: draft.guestNames,
      roomId: room.id,
      arrivalDate: incoming.arrivalDate,
      departureDate: incoming.departureDate,
      businessDate,
      status: draft.status as StayStatus,
      stage:
        draft.status === RoomStayStatus.IN_HOUSE
          ? RoomStayStage.CONFIRMADO
          : RoomStayStage.PENDIENTE,
      roomMove: false,
    });
  }

  /*
    La previsión simula la entrega de la llave principal con la misma regla
    que aplica la importación. Sin esto, la pantalla de revisión avisaba de
    treinta «habitación in house sin llave» que el propio botón «Aplicar»
    resolvía acto seguido: un aviso que no había que atender.
  */
  const projectedKeys = (room: (typeof rooms)[number]): KeyFacts[] => {
    const holder = principalKeyHolder(projected.get(room.number) ?? []);
    if (!holder) return room.keys as KeyFacts[];

    return (room.keys as KeyFacts[]).map((key) => {
      if (key.type !== 'PRINCIPAL') return key;
      // No se simula lo que la importación tampoco haría: una llave en manos
      // de otra estadía, extraviada o fuera de servicio se queda como está.
      const suya = key.stayId === null || key.stayId === holder.stayId;
      if (!suya || key.status === 'EXTRAVIADA' || key.status === 'FUERA_DE_SERVICIO') {
        return key;
      }
      return { ...key, status: holder.status, stayId: holder.stayId };
    });
  };

  const conflicts = detectConflicts({
    rooms: rooms.map((room) => ({
      number: room.number,
      stays: projected.get(room.number) ?? [],
      keys: projectedKeys(room),
    })),
    reconciliation,
    orphanStays: orphans.map((orphan) => ({
      reservationId: orphan.reservationId,
      guestNames: orphan.guestNames,
      roomNumber: orphan.roomNumber,
      sourceReport: 'informe del PMS',
      reason: orphan.reason,
    })),
  });

  const knownCodes = new Set(
    (
      await prisma.reservationReference.findMany({
        where: { code: { in: [...new Set(stays.map((s) => s.reservationId))] } },
        select: { code: true },
      })
    ).map((reference) => reference.code),
  );

  return {
    orphans,
    conflicts,
    protectedStays,
    counts,
    activity: summarizeActivity(stays, knownCodes, declaredTotals),
  };
}

/**
 * Resumen del informe de actividad, para decidir antes de aplicar.
 *
 * No consulta nada: recibe los borradores y qué reservas ya se conocen. Así el
 * cálculo se puede probar sin base y la pantalla muestra exactamente lo mismo
 * que se va a aplicar.
 */
export function summarizeActivity(
  stays: StayDraft[],
  knownCodes: Set<string>,
  declared: Array<{ label: string; numbers: number[] }> = [],
): ActivitySummary {
  const rooms = new Set<string>();
  const byRoom = new Map<string, StayDraft[]>();
  const byReservation = new Map<string, Set<string>>();

  let occupied = 0;
  let arrivals = 0;
  let departures = 0;
  let withBalance = 0;

  const pendingByCurrency: Record<'CLP' | 'USD', number> = { CLP: 0, USD: 0 };
  const totalByCurrency: Record<'CLP' | 'USD', number> = { CLP: 0, USD: 0 };
  const rowIssues: ActivitySummary['rowIssues'] = [];

  for (const stay of stays) {
    if (stay.roomNumber) {
      rooms.add(stay.roomNumber);
      const list = byRoom.get(stay.roomNumber) ?? [];
      list.push(stay);
      byRoom.set(stay.roomNumber, list);
    }

    const forReservation = byReservation.get(stay.reservationId) ?? new Set<string>();
    if (stay.roomNumber) forReservation.add(stay.roomNumber);
    byReservation.set(stay.reservationId, forReservation);

    if (stay.status === RoomStayStatus.IN_HOUSE) occupied += 1;
    else if (stay.status === RoomStayStatus.CHECK_IN) arrivals += 1;
    else if (stay.status === RoomStayStatus.CHECK_OUT) departures += 1;

    /*
      Los importes se acumulan POR MONEDA. El informe trae pesos y dólares a la
      vez y declara sus totales por separado, así que juntarlos daría una cifra
      que no se puede contrastar con nada.
    */
    const currency = stay.currency === 'USD' ? 'USD' : stay.currency === 'CLP' ? 'CLP' : null;
    if (currency) {
      if (stay.totalAmount !== null) totalByCurrency[currency] += stay.totalAmount;
      if (stay.pendingAmount !== null) pendingByCurrency[currency] += stay.pendingAmount;
    }
    if (stay.pendingAmount !== null && stay.pendingAmount > 0) withBalance += 1;

    if (stay.issues.length > 0) {
      rowIssues.push({
        reservationId: stay.reservationId,
        roomNumber: stay.roomNumber,
        issues: stay.issues,
      });
    }
  }

  // El dólar se redondea al final: acumular centavos en coma flotante arrastra
  // milésimas y el total no cuadraría con el que declara el informe.
  totalByCurrency.USD = Math.round(totalByCurrency.USD * 100) / 100;
  pendingByCurrency.USD = Math.round(pendingByCurrency.USD * 100) / 100;

  /*
    La cola: salida Y entrada en la misma habitación el mismo día. NO es una
    inconsistencia —en el informe real son tres habitaciones— y se muestra
    aparte porque es lo que el mesón tiene que mirar primero: hay que cerrar la
    salida antes de poder entregar la habitación.
  */
  const turnarounds: ActivitySummary['turnarounds'] = [];
  for (const [roomNumber, list] of byRoom) {
    const leaving = list.find((stay) => stay.status === RoomStayStatus.CHECK_OUT);
    const arriving = list.find((stay) => stay.status === RoomStayStatus.CHECK_IN);
    if (!leaving || !arriving) continue;
    // La misma reserva entrando y saliendo es uso diurno, no una cola.
    if (leaving.reservationId === arriving.reservationId) continue;
    turnarounds.push({
      roomNumber,
      leaving: leaving.reservationId,
      arriving: arriving.reservationId,
    });
  }

  /*
    Una reserva repartida entre varias habitaciones tampoco es un error: en el
    informe real hay una en ocho habitaciones. Se lista para que se vea, porque
    confirmar la salida de una no confirma las otras.
  */
  const multiRoom = [...byReservation.entries()]
    .filter(([, roomSet]) => roomSet.size > 1)
    .map(([reservationId, roomSet]) => ({
      reservationId,
      rooms: [...roomSet].sort(),
    }));

  const codes = new Set(stays.map((stay) => stay.reservationId));
  let newReservations = 0;
  for (const code of codes) if (!knownCodes.has(code)) newReservations += 1;

  return {
    roomsWithActivity: rooms.size,
    occupied,
    arrivals,
    departures,
    turnarounds,
    newReservations,
    knownReservations: codes.size - newReservations,
    withBalance,
    pendingByCurrency,
    totalByCurrency,
    multiRoom,
    rowIssues,
    declared,
  };
}

/** Vuelve a cargar un borrador guardado, con su análisis recalculado. */
export async function getImportPreview(batchId: string): Promise<ImportPreview> {
  const batch = await prisma.pmsImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new NotFoundError('Esa importación no existe.');

  const stays = batch.payload as unknown as StayDraft[];
  const reports = batch.reports as unknown as ReportMeta[];
  const analysis = await analyseDraft(
    midnight(batch.businessDate),
    stays,
    reports.flatMap((report) => report.declaredTotals ?? []),
  );

  return {
    batchId: batch.id,
    businessDate: batch.businessDate,
    reports,
    stays,
    ...analysis,
  };
}

export type ImportResult = {
  created: number;
  updated: number;
  preserved: number;
  /**
   * Filas que el informe repite sin un solo cambio, y por las que no se
   * escribió nada.
   *
   * Existe para que la idempotencia sea VISIBLE. Antes `updated` contaba las
   * filas existentes no protegidas, escribiera o no, así que reimportar el
   * mismo informe reportaba «2 actualizadas» cuando no había tocado nada: no
   * había forma de distinguir un informe idéntico de uno con cambios reales.
   */
  unchanged: number;
  skipped: number;
  /** Llaves principales que la importación entregó a su ocupante. */
  keysAssigned: number;
  /** Estadías que quedaron vinculadas a una reserva interna existente. */
  reservationsLinked: number;
  keysFlagged: number;
};

/**
 * Aplica un borrador revisado.
 *
 * Es idempotente: volver a aplicar la misma evidencia no duplica nada, porque
 * primero se identifica la ocurrencia de la estancia y después se resuelve su
 * transición de estado. Lo que ya tocó una persona se conserva.
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
    if (!drafts.length) {
      throw new RuleError(
        'No hay filas válidas para aplicar. Revisa los errores del archivo o descarta esta carga.',
      );
    }
    const summary: ImportResult = {
      created: 0,
      updated: 0,
      preserved: 0,
      unchanged: 0,
      skipped: 0,
      keysAssigned: 0,
      reservationsLinked: 0,
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
      where: {
        deletedAt: null,
        OR: [
          { businessDate },
          {
            stage: { in: [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO] },
          },
        ],
      },
      orderBy: [{ businessDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        reservationId: true,
        externalId: true,
        roomId: true,
        status: true,
        stage: true,
        businessDate: true,
        touchedManually: true,
        guestNames: true,
        channel: true,
        arrivalDate: true,
        departureDate: true,
        pmsStatus: true,
        // Los importes entran en la comparación de «sin cambios»: sin ellos,
        // reimportar el mismo informe no escribiría los saldos la primera vez
        // y un saldo corregido en el PMS no llegaría nunca.
        guestCount: true,
        totalAmount: true,
        pendingAmount: true,
        currency: true,
        paymentType: true,
        paymentTypeRaw: true,
        note: true,
      },
    });

    type WorkingStay = ReconciliationEvidence & {
      touchedManually: boolean;
      guestNames: string[];
      channel: string | null;
      pmsStatus: string | null;
      guestCount: number | null;
      totalAmount: number | null;
      pendingAmount: number | null;
      currency: string | null;
      paymentType: string | null;
      paymentTypeRaw: string | null;
    };

    const working: WorkingStay[] = existingStays.map((stay) => ({
      ...stay,
      status: stay.status as StayStatus,
      roomMove: Boolean(stay.note?.includes('ROOM MOVE')),
      totalAmount: stay.totalAmount === null ? null : Number(stay.totalAmount),
      pendingAmount: stay.pendingAmount === null ? null : Number(stay.pendingAmount),
    }));
    const toCreate = new Map<string, Prisma.RoomStayCreateManyInput>();
    const toUpdate = new Map<string, Prisma.RoomStayUpdateInput>();
    const roomsPerReservation = new Map<string, Set<string>>();
    for (const draft of drafts) {
      if (!draft.roomNumber) continue;
      const set = roomsPerReservation.get(draft.reservationId) ?? new Set<string>();
      set.add(draft.roomNumber);
      roomsPerReservation.set(draft.reservationId, set);
    }

    const sameDay = (a: Date | null, b: Date | null) =>
      a && b ? a.getTime() === b.getTime() : a === b;

    /*
      Compara un importe guardado con uno leído. La base devuelve `Decimal` y
      el borrador un número, así que compararlos directo daría siempre distinto
      y cada importación reescribiría las cincuenta y tres filas.

      La tolerancia es de medio centavo, que es la precisión de la columna.
    */
    const sameAmount = (stored: number | null, drafted: number | null): boolean => {
      if (stored === null || drafted === null) return stored === null && drafted === null;
      return Math.abs(Number(stored) - drafted) < 0.005;
    };

    for (const draft of drafts) {
      /*
        Los problemas de lectura nunca se convierten en estado operativo por
        omisión. Quedan registrados en el borrador/revisión y la fila se omite
        de la aplicación hasta contar con información inequívoca.
      */
      if (!draft.status || hasBlockingPmsIssues(draft.issues)) {
        summary.skipped += 1;
        continue;
      }

      const room = draft.roomNumber ? byNumber.get(draft.roomNumber) : null;
      if (!room) {
        summary.skipped += 1;
        continue;
      }

      /*
        Datos DESCRIPTIVOS: lo que el PMS cuenta de la estancia. Se refrescan en
        cada importación porque el PMS es su fuente.

        No hay nada operativo acá, y es la línea que separa las dos verdades:
        llaves, garantías, multas, novedades, pendientes, entregas y cualquier
        confirmación manual no se tocan nunca desde una importación. FNS aporta
        contexto; el Libro conserva sus procesos.
      */
      const descriptive = {
        businessDate,
        externalId: draft.externalId ?? null,
        guestNames: draft.guestNames,
        channel: draft.channel,
        arrivalDate: draft.arrivalDate ? new Date(draft.arrivalDate) : null,
        departureDate: draft.departureDate ? new Date(draft.departureDate) : null,
        pmsStatus: draft.pmsStatus,
        sourceReport: draft.sourceReport,
        guestCount: draft.guestCount,
        totalAmount: draft.totalAmount,
        pendingAmount: draft.pendingAmount,
        currency: draft.currency,
        paymentType: draft.paymentType,
        paymentTypeRaw: draft.paymentTypeRaw,
        batchId: batch.id,
      };

      const incoming: IncomingEvidence = {
        reservationId: draft.reservationId,
        externalId: draft.externalId ?? null,
        guestNames: draft.guestNames,
        roomId: room.id,
        arrivalDate: descriptive.arrivalDate,
        departureDate: descriptive.departureDate,
        businessDate,
        status: draft.status as StayStatus,
      };
      const decision = decideStayReconciliation(working, incoming, {
        reservationAppearsInSeveralRooms:
          (roomsPerReservation.get(draft.reservationId)?.size ?? 0) > 1,
      });
      if (decision.kind === 'CONFLICT') {
        summary.skipped += 1;
        continue;
      }

      if (decision.kind === 'CREATE') {
        const temporaryId = `nuevo:${batch.id}:${working.length}`;
        const stage =
          draft.status === RoomStayStatus.IN_HOUSE
            ? RoomStayStage.CONFIRMADO
            : RoomStayStage.PENDIENTE;
        const row: Prisma.RoomStayCreateManyInput = {
          ...descriptive,
          reservationId: draft.reservationId,
          roomId: room.id,
          status: draft.status,
          stage,
        };
        toCreate.set(temporaryId, row);
        working.push({
          id: temporaryId,
          reservationId: draft.reservationId,
          externalId: draft.externalId ?? null,
          guestNames: draft.guestNames,
          roomId: room.id,
          arrivalDate: descriptive.arrivalDate,
          departureDate: descriptive.departureDate,
          businessDate,
          status: draft.status as StayStatus,
          stage,
          roomMove: false,
          touchedManually: false,
          channel: draft.channel,
          pmsStatus: draft.pmsStatus,
          guestCount: draft.guestCount,
          totalAmount: draft.totalAmount,
          pendingAmount: draft.pendingAmount,
          currency: draft.currency,
          paymentType: draft.paymentType,
          paymentTypeRaw: draft.paymentTypeRaw,
        });
        summary.created += 1;
        continue;
      }

      const existing = working.find((stay) => stay.id === decision.stay.id)!;
      const resolved = reconcileStayState(existing, incoming);
      const effectiveDescriptive = resolved.preserveArrivalDate
        ? { ...descriptive, arrivalDate: existing.arrivalDate }
        : descriptive;
      const next = resolved.acceptIncomingDetails
        ? {
            ...existing,
            ...effectiveDescriptive,
            status: resolved.status,
            stage: resolved.stage,
          }
        : { ...existing, status: resolved.status, stage: resolved.stage };

      const unchanged =
        existing.status === next.status &&
        existing.stage === next.stage &&
        existing.businessDate.getTime() === next.businessDate.getTime() &&
        existing.externalId === next.externalId &&
        existing.guestNames.join('\u0000') === next.guestNames.join('\u0000') &&
        existing.channel === next.channel &&
        existing.pmsStatus === next.pmsStatus &&
        sameDay(existing.arrivalDate, next.arrivalDate) &&
        sameDay(existing.departureDate, next.departureDate) &&
        existing.guestCount === next.guestCount &&
        sameAmount(existing.totalAmount, next.totalAmount) &&
        sameAmount(existing.pendingAmount, next.pendingAmount) &&
        existing.currency === next.currency &&
        existing.paymentType === next.paymentType &&
        existing.paymentTypeRaw === next.paymentTypeRaw;

      if (unchanged) {
        summary.unchanged += 1;
        continue;
      }

      Object.assign(existing, next);
      const updateData: Prisma.RoomStayUpdateInput = resolved.acceptIncomingDetails
        ? { ...effectiveDescriptive, status: resolved.status, stage: resolved.stage }
        : { status: resolved.status, stage: resolved.stage };
      if (existing.id.startsWith('nuevo:')) {
        const pending = toCreate.get(existing.id);
        if (pending) Object.assign(pending, updateData);
      } else {
        toUpdate.set(existing.id, updateData);
      }

      if (existing.touchedManually || decision.stay.stage !== RoomStayStage.PENDIENTE) {
        summary.preserved += 1;
      } else {
        summary.updated += 1;
      }
    }

    if (toCreate.size) {
      await tx.roomStay.createMany({ data: [...toCreate.values()], skipDuplicates: true });
    }
    for (const [id, data] of toUpdate) {
      await tx.roomStay.update({ where: { id }, data });
    }

    /*
      Cruce de los informes con el inventario de llaves.
      ------------------------------------------------------------------
      Quien está dentro de la habitación tiene su llave: es un hecho físico,
      no una decisión del mesón. La regla completa vive en
      `reconcilePrincipalKeys` (services/keys.ts), que decide con
      `principalKeyHolder` del dominio. Es la misma función que usa la
      reconciliación explícita del inventario: una sola implementación.

      Acotada al día del lote, porque una importación sólo habla de su día.
    */
    summary.keysAssigned = await reconcilePrincipalKeys(tx, user, {
      businessDate,
      note: 'informe del PMS',
    });

    /*
      Vínculo con la reserva interna.
      ------------------------------------------------------------------
      `reservationId` y `guestNames` son la fotografía de lo que entregó el
      PMS y no se tocan nunca. Esto sólo **añade** el vínculo opcional cuando
      la reserva ya existe en el sistema, emparejando por CÓDIGO: nunca por
      nombre, que es la forma de confundir a dos huéspedes homónimos.

      Queda nulo cuando la reserva no existe, y eso es normal: el PMS es la
      fuente y una estadía vale por sí misma.

      Dos consultas, no una por fila: se leen los códigos presentes y se
      agrupa la actualización por reserva.
    */
    summary.reservationsLinked = await linkStaysToReservations(tx, { businessDate });

    /*
      Copias adicionales en habitaciones con salida informada. La principal ya
      quedó pendiente de devolución en el paso anterior; esto recoge las
      copias, que también hay que recuperar.
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
      `${result.skipped} sin habitación, ${result.keysAssigned} llave(s) entregada(s), ` +
      `${result.reservationsLinked} estadía(s) vinculada(s) a su reserva, ` +
      `${result.keysFlagged} copia(s) por devolver`,
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

/**
 * Estado de los informes PMS.
 *
 * Los informes no caducan por edad ni dejan de ser válidos por cambiar el día.
 * Se conserva su fecha de negocio como dato histórico y siempre se muestra el
 * último lote aplicado hasta que otro lo sustituye.
 */
export type ShiftReportsState = {
  /** Último lote aplicado, sin límite temporal de validez. */
  applied: {
    id: string;
    businessDate: Date;
    appliedAt: Date | null;
    appliedByName: string | null;
    counts: { checkIn: number; inHouse: number; checkOut: number };
  } | null;
  /** Borrador leído y pendiente de revisar, si hay alguno. */
  draft: {
    id: string;
    businessDate: Date;
    createdAt: Date;
    createdByName: string;
  } | null;
};

/**
 * Vincula estadías con la reserva interna que les corresponde, por código.
 *
 * `RoomStay.reservationId` es el código que entregó el PMS;
 * `ReservationReference.code` es el de la reserva interna. Cuando coinciden,
 * se guarda el vínculo en `reservationRefId`.
 *
 * **Nunca empareja por nombre.** Dos huéspedes pueden llamarse igual, y el
 * caso real de la habitación 515 —mismo nombre, dos reservas distintas— es
 * justamente el que se arruinaría.
 *
 * `businessDate` omitido = todas las estadías sin vincular, que es lo que
 * permite recuperar las anteriores a este vínculo.
 */
export async function linkStaysToReservations(
  tx: Prisma.TransactionClient,
  options: { businessDate?: Date } = {},
): Promise<number> {
  const pendientes = await tx.roomStay.findMany({
    where: {
      ...(options.businessDate ? { businessDate: options.businessDate } : {}),
      deletedAt: null,
      reservationRefId: null,
    },
    select: { id: true, reservationId: true, externalId: true },
  });
  if (!pendientes.length) return 0;

  const codigos = [...new Set(pendientes.map((stay) => stay.reservationId))];
  const externos = [
    ...new Set(
      pendientes
        .map((stay) => stay.externalId)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const reservas = await tx.reservationReference.findMany({
    where: {
      deletedAt: null,
      OR: [
        { code: { in: codigos } },
        ...(externos.length ? [{ externalId: { in: externos } }] : []),
      ],
    },
    select: { id: true, code: true, externalId: true },
  });
  if (!reservas.length) return 0;

  const porCodigo = new Map(reservas.map((reserva) => [reserva.code, reserva.id]));
  const porExterno = new Map(
    reservas
      .filter((reserva): reserva is typeof reserva & { externalId: string } => Boolean(reserva.externalId))
      .map((reserva) => [reserva.externalId, reserva.id]),
  );
  let vinculadas = 0;

  // Una actualización por reserva, no una por estadía: varias estadías de la
  // misma reserva (entrada, in house, salida) se agrupan en un solo UPDATE.
  for (const [code, reservationRefId] of porCodigo) {
    const ids = pendientes
      .filter((stay) => stay.reservationId === code)
      .map((stay) => stay.id);
    if (!ids.length) continue;
    const { count } = await tx.roomStay.updateMany({
      where: { id: { in: ids } },
      data: { reservationRefId },
    });
    vinculadas += count;
  }

  const aunPendientes = pendientes.filter((stay) => !porCodigo.has(stay.reservationId));
  for (const [externalId, reservationRefId] of porExterno) {
    const ids = aunPendientes
      .filter((stay) => stay.externalId === externalId)
      .map((stay) => stay.id);
    if (!ids.length) continue;
    const { count } = await tx.roomStay.updateMany({
      where: { id: { in: ids } },
      data: { reservationRefId },
    });
    vinculadas += count;
  }

  return vinculadas;
}

export async function getShiftReportsState(): Promise<ShiftReportsState> {
  // Un solo viaje: los últimos lotes, de los que se toma el primero aplicado
  // y el primer borrador. Ordena por el índice de `createdAt`.
  const batches = await prisma.pmsImportBatch.findMany({
    where: { status: { in: [PmsImportStatus.APLICADO, PmsImportStatus.BORRADOR] } },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      status: true,
      businessDate: true,
      createdAt: true,
      appliedAt: true,
      summary: true,
      createdBy: { select: { name: true } },
      appliedBy: { select: { name: true } },
    },
  });

  const applied = batches.find((batch) => batch.status === PmsImportStatus.APLICADO);
  const draft = batches.find((batch) => batch.status === PmsImportStatus.BORRADOR);

  /*
    El resumen quedó guardado como JSON al leer los informes. Se lee con
    cuidado: un lote antiguo puede no traer todas las claves.
  */
  const countsOf = (summary: unknown) => {
    const raw = ((summary ?? {}) as { counts?: Record<string, unknown> }).counts ?? {};
    const num = (key: string) => (typeof raw[key] === 'number' ? raw[key] : 0);
    return { checkIn: num('checkIn'), inHouse: num('inHouse'), checkOut: num('checkOut') };
  };

  return {
    applied: applied
      ? {
          id: applied.id,
          businessDate: applied.businessDate,
          appliedAt: applied.appliedAt,
          appliedByName: applied.appliedBy?.name ?? null,
          counts: countsOf(applied.summary),
        }
      : null,
    draft: draft
      ? {
          id: draft.id,
          businessDate: draft.businessDate,
          createdAt: draft.createdAt,
          createdByName: draft.createdBy.name,
        }
      : null,
  };
}

export { REPORT_LABELS, buildRoomSnapshot };
