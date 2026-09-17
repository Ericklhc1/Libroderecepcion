import 'server-only';

import { randomUUID } from 'node:crypto';
import { AuditAction, GuaranteeStatus, ReservationStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';
import { NotFoundError, RuleError } from '@/server/errors';
import { readPdfFragments } from '@/server/pms/read-pdf';
import { hotelWallDateTime } from '@/domain/time';

export type ReservationPdfExtract = {
  code: string | null;
  guestName: string | null;
  roomNumber: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  channel: string | null;
  rawText: string;
};

export type ReservationPdfDraft = {
  id: string;
  fileName: string;
  extracted: ReservationPdfExtract;
  createdAt: Date;
  appliedAt: Date | null;
  discardedAt: Date | null;
};

type DraftRow = ReservationPdfDraft;

function linesFromFragments(
  fragments: Array<{ page: number; x: number; y: number; text: string }>,
): string[] {
  const grouped = new Map<string, Array<{ x: number; text: string }>>();
  for (const fragment of fragments) {
    const yBucket = Math.round(fragment.y / 3) * 3;
    const key = `${fragment.page}:${yBucket}`;
    const row = grouped.get(key) ?? [];
    row.push({ x: fragment.x, text: fragment.text.trim() });
    grouped.set(key, row);
  }
  return [...grouped.entries()]
    .map(([key, values]) => {
      const parts = key.split(':').map(Number);
      const page = parts[0] ?? 0;
      const y = parts[1] ?? 0;
      return {
        page,
        y,
        text: values.sort((a, b) => a.x - b.x).map((value) => value.text).join(' ').replace(/\s+/g, ' ').trim(),
      };
    })
    .sort((a, b) => a.page - b.page || b.y - a.y)
    .map((row) => row.text)
    .filter(Boolean);
}

function candidateAfterLabel(lines: string[], labels: RegExp[]): string | null {
  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(label);
      if (!match || match.index === undefined) continue;
      const rest = line.slice(match.index + match[0].length).replace(/^[\s:#.\-–—]+/, '').trim();
      if (rest) return rest;
    }
  }
  return null;
}

function reservationCode(lines: string[]): string | null {
  const fullText = lines.join('\n');
  const fns = fullText.match(/\bDatos\s+de\s+la\s+reserva\.?\s*ID\s*:\s*([A-Z0-9._\/-]{3,})/i)
    ?? fullText.match(/(?:^|\n)\s*ID\s*:\s*(\d{6,12})\b/i);
  if (fns?.[1]) return fns[1].replace(/[.,;:]+$/, '').toUpperCase();

  const labels = [
    /\bID\s*(?:DE\s*)?(?:RESERVA|RESERVATION)\b/i,
    /\bN[°º.]?\s*(?:DE\s*)?RESERVA\b/i,
    /\bRESERVATION\s*(?:ID|NUMBER|NO\.?|#)\b/i,
    /\bCONFIRMATION\s*(?:NUMBER|NO\.?|#)\b/i,
    /\bCONFIRMACI[ÓO]N\s*(?:N[°º.]?|#)?\b/i,
  ];
  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(label);
      if (!match || match.index === undefined) continue;
      const rest = line.slice(match.index + match[0].length);
      const tokens = rest.match(/[A-Z0-9][A-Z0-9._\/-]{3,}/gi) ?? [];
      const code = tokens.find((token) => /\d/.test(token));
      if (code) return code.replace(/[.,;:]+$/, '').toUpperCase();
    }
  }

  for (const line of lines) {
    if (!/reserva|reservation|confirmaci[oó]n/i.test(line)) continue;
    const code = line.match(/\b\d{6,12}\b/)?.[0];
    if (code) return code;
  }
  return null;
}

function dateFromLabel(lines: string[], labels: RegExp[]): string | null {
  // La prioridad es la del tipo de campo, no la primera palabra que aparezca
  // visualmente en el PDF. FNSRooms imprime arriba "Check-in Cobrado Check-out"
  // como estados y más abajo los campos autoritativos "Entrada:" / "Salida:".
  for (const label of labels) {
    for (const line of lines) {
      const found = line.match(label);
      if (!found || found.index === undefined) continue;
      const rest = line.slice(found.index + found[0].length).replace(/^[\s:#.\-–—]+/, '').trim();
      const match = rest.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/);
      if (!match) continue;
      const day = match[1];
      const month = match[2];
      const year = match[3];
      if (!day || !month || !year) continue;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }
  return null;
}

function cleanFieldValue(value: string | null | undefined, max = 160): string | null {
  const clean = value
    ?.replace(/[|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
  return clean || null;
}

function fnsGuestName(lines: string[]): string | null {
  const fullText = lines.join('\n');
  const start = fullText.search(/\bDatos\s+del\s+cliente\b/i);
  if (start < 0) return null;
  const tail = fullText.slice(start);
  const end = tail.search(/\b(?:Datos\s+empresa|Desglose\s+reserva|Consumos\s+y\s+servicios)\b/i);
  const section = end > 0 ? tail.slice(0, end) : tail.slice(0, 2_500);
  const match = section.match(
    /\bNombre\s*:\s*([\s\S]*?)(?=\s+(?:Email|Tel[eé]fono|Direcci[oó]n|Ciudad|Provincia|Pa[ií]s|Nacionalidad|N[º°o]\s*de\s*documento|Sexo|Motivo\s+viaje|Observaciones)\s*:|$)/i,
  );
  return cleanFieldValue(match?.[1]);
}

function guestName(lines: string[]): string | null {
  const fns = fnsGuestName(lines);
  if (fns) return fns;
  const value = candidateAfterLabel(lines, [
    /\bHU[EÉ]SPED(?:\s+PRINCIPAL)?\b/i,
    /\bNOMBRE\s+DEL\s+HU[EÉ]SPED\b/i,
    /\bGUEST\s*(?:NAME)?\b/i,
  ]);
  if (!value) return null;
  return cleanFieldValue(
    value.split(/\s{2,}|\b(?:HABITACI[ÓO]N|ROOM|LLEGADA|ARRIVAL|CHECK[- ]?IN|SALIDA|DEPARTURE|CHECK[- ]?OUT)\b/i)[0],
  );
}

function isHotelRoom(value: string): boolean {
  const room = Number(value);
  return (room >= 401 && room <= 429) || (room >= 501 && room <= 530) || (room >= 601 && room <= 630);
}

function roomNumber(lines: string[]): string | null {
  const fullText = lines.join('\n');
  const explicit = fullText.match(/\b(?:Habitaci[oó]n|Room)\s*:\s*([456]\d{2})\b/i)?.[1];
  if (explicit && isHotelRoom(explicit)) return explicit;

  // FNSRooms imprime la habitación dentro de la fila de «Desglose reserva».
  // La geometría del PDF puede separar el encabezado «Hab.» del valor, por eso
  // se busca primero en las filas del desglose, nunca en dirección/teléfono.
  const headerIndex = lines.findIndex((line) => /\bHab\.?\b/i.test(line) && /Hu[eé]spedes/i.test(line));
  const detailLines = headerIndex >= 0 ? lines.slice(headerIndex + 1, headerIndex + 6) : lines;
  for (const line of detailLines) {
    if (!/(?:Tarifa|Matrimonial|Individual|Doble|CL\$|\(\d+N\)|Hu[eé]sped)/i.test(line)) continue;
    const candidates = line.match(/\b[456]\d{2}\b/g) ?? [];
    const room = candidates.find(isHotelRoom);
    if (room) return room;
  }

  const raw = candidateAfterLabel(lines, [/\bHABITACI[ÓO]N\b/i, /\bROOM\b/i]);
  const candidates = raw?.match(/\b[456]\d{2}\b/g) ?? [];
  return candidates.find(isHotelRoom) ?? null;
}

function channel(lines: string[]): string | null {
  const fullText = lines.join('\n');
  const fns = fullText.match(
    /\bCanal\s*:\s*([\s\S]*?)(?=\s+(?:Segmento|Entrada|Salida|Direcci[oó]n|Ciudad|Provincia|Pa[ií]s|Nacionalidad|Datos\s+del\s+cliente)\s*:|\n|$)/i,
  );
  const precise = cleanFieldValue(fns?.[1], 80);
  if (precise) return precise;

  const raw = candidateAfterLabel(lines, [/\bCANAL\b/i, /\bCHANNEL\b/i, /\bORIGEN\b/i]);
  return cleanFieldValue(
    raw?.split(/\s{2,}|\b(?:SEGMENTO|ENTRADA|HABITACI[ÓO]N|ROOM|LLEGADA|SALIDA|DIRECCI[ÓO]N|CIUDAD|PROVINCIA|PA[IÍ]S|NACIONALIDAD)\b/i)[0],
    80,
  );
}

export function parseReservationLines(lines: string[]): ReservationPdfExtract {
  if (lines.length === 0) throw new RuleError('El PDF no contiene texto legible.');
  return {
    code: reservationCode(lines),
    guestName: guestName(lines),
    roomNumber: roomNumber(lines),
    checkInDate: dateFromLabel(lines, [/\bENTRADA\b/i, /\bLLEGADA\b/i, /\bARRIVAL\b/i, /\bCHECK[- ]?IN\b/i]),
    checkOutDate: dateFromLabel(lines, [/\bSALIDA\b/i, /\bDEPARTURE\b/i, /\bCHECK[- ]?OUT\b/i]),
    channel: channel(lines),
    rawText: lines.join('\n').slice(0, 12_000),
  };
}

export async function extractReservationPdf(data: Uint8Array): Promise<ReservationPdfExtract> {
  const fragments = await readPdfFragments(data);
  const lines = linesFromFragments(fragments);
  return parseReservationLines(lines);
}

export async function createReservationPdfDraft(
  user: CurrentUser,
  params: { fileName: string; data: Uint8Array },
): Promise<ReservationPdfDraft> {
  const extracted = await extractReservationPdf(params.data);
  const id = randomUUID();
  const json = JSON.stringify(extracted);
  await prisma.$executeRaw`
    INSERT INTO "ReservationPdfDraft" ("id", "fileName", "extracted", "createdById")
    VALUES (${id}, ${params.fileName}, ${json}::jsonb, ${user.id})
  `;
  const draft = await getReservationPdfDraft(id);
  if (!draft) throw new RuleError('No fue posible guardar la revisión del PDF.');
  return draft;
}

export async function getReservationPdfDraft(id: string): Promise<ReservationPdfDraft | null> {
  const rows = await prisma.$queryRaw<DraftRow[]>`
    SELECT "id", "fileName", "extracted", "createdAt", "appliedAt", "discardedAt"
    FROM "ReservationPdfDraft"
    WHERE "id" = ${id}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function applyReservationPdfDraft(
  user: CurrentUser,
  params: {
    draftId: string;
    code: string;
    guestName?: string | null;
    roomNumber?: string | null;
    checkInDate?: string | null;
    checkOutDate?: string | null;
    channel?: string | null;
  },
): Promise<{ reservationId: string; code: string; created: boolean }> {
  const draft = await getReservationPdfDraft(params.draftId);
  if (!draft) throw new NotFoundError('El borrador de reserva no existe.');
  if (draft.appliedAt) throw new RuleError('Este PDF ya fue aplicado.');
  if (draft.discardedAt) throw new RuleError('Este PDF fue descartado.');

  const code = params.code.trim().toUpperCase();
  if (code.length < 3) throw new RuleError('Confirma el ID de reserva antes de aplicar.');
  const guestName = params.guestName?.trim() || null;
  const roomNumber = params.roomNumber?.trim() || null;
  const checkIn = params.checkInDate ? hotelWallDateTime(params.checkInDate, 15, 0) : null;
  const checkOut = params.checkOutDate ? hotelWallDateTime(params.checkOutDate, 11, 0) : null;
  if (checkIn && checkOut && checkOut <= checkIn) {
    throw new RuleError('La salida debe ser posterior a la llegada.');
  }

  const previous = await prisma.reservationReference.findUnique({ where: { code }, select: { id: true } });
  const result = await prisma.$transaction(async (tx) => {
    let guestId: string | null = null;
    if (guestName) {
      const existingGuest = await tx.guestReference.findFirst({
        where: { deletedAt: null, fullName: { equals: guestName, mode: 'insensitive' } },
        select: { id: true },
      });
      guestId = existingGuest?.id ?? (await tx.guestReference.create({ data: { fullName: guestName, roomNumber } })).id;
    }

    const reservation = await tx.reservationReference.upsert({
      where: { code },
      create: {
        code,
        guestId,
        roomNumber,
        checkIn,
        checkOut,
        channel: params.channel?.trim() || null,
        status: ReservationStatus.CONFIRMADA,
        guaranteeStatus: GuaranteeStatus.PENDIENTE,
        externalId: code,
        notes: `Reserva cargada desde PDF ${draft.fileName}. Revisada por ${user.name}.`,
      },
      update: {
        ...(guestId ? { guestId } : {}),
        ...(roomNumber ? { roomNumber } : {}),
        ...(checkIn ? { checkIn } : {}),
        ...(checkOut ? { checkOut } : {}),
        ...(params.channel?.trim() ? { channel: params.channel.trim() } : {}),
        externalId: code,
      },
      select: { id: true, code: true },
    });

    await tx.$executeRaw`
      UPDATE "ReservationPdfDraft"
      SET "appliedAt" = NOW()
      WHERE "id" = ${draft.id} AND "appliedAt" IS NULL AND "discardedAt" IS NULL
    `;

    await recordAudit(
      {
        entity: 'ReservationReference',
        entityId: reservation.id,
        action: previous ? AuditAction.EDITAR : AuditAction.CREAR,
        user,
        summary: `${previous ? 'Reserva reconciliada' : 'Reserva creada'} desde PDF: ${code}`,
        after: { code, guestName, roomNumber, checkIn, checkOut, channel: params.channel, draftId: draft.id },
      },
      tx,
    );
    return reservation;
  });

  return { reservationId: result.id, code: result.code, created: !previous };
}

export async function discardReservationPdfDraft(user: CurrentUser, id: string): Promise<void> {
  const draft = await getReservationPdfDraft(id);
  if (!draft) throw new NotFoundError('El borrador de reserva no existe.');
  if (draft.appliedAt) throw new RuleError('Una reserva ya aplicada no puede descartarse desde el borrador.');
  await prisma.$executeRaw`
    UPDATE "ReservationPdfDraft" SET "discardedAt" = NOW()
    WHERE "id" = ${id} AND "appliedAt" IS NULL
  `;
  await recordAudit({
    entity: 'ReservationPdfDraft',
    entityId: id,
    action: AuditAction.ELIMINAR,
    user,
    summary: `Borrador de reserva PDF descartado: ${draft.fileName}`,
  });
}
