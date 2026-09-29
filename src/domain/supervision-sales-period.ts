export type SalesPeriodSeverity = 'BAJA' | 'MEDIA' | 'ALTA';

export type SalesPeriodFinding = {
  key: string;
  severity: SalesPeriodSeverity;
  title: string;
  detail: string;
};

export type SalesPeriodCostCenters = {
  alojamiento: number | null;
  eventos: number | null;
  spa: number | null;
  multas: number | null;
  multasFumar: number | null;
  multasBlancos: number | null;
  varios: number | null;
  tasas: number | null;
};

export type SalesPeriodDay = {
  date: string;
  hotelTotalClp: number | null;
  costCenters: SalesPeriodCostCenters;
  totalRooms: number | null;
  freeRooms: number | null;
  occupiedRooms: number | null;
  occupiedWithCost: number | null;
  courtesyRooms: number | null;
  dayUse: number | null;
  blockedRooms: number | null;
  groupRooms: number | null;
  passengers: number | null;
  guests: number | null;
  adrClp: number | null;
  occupancyPct: number | null;
  paidOccupancyPct: number | null;
  roomRevenueClp: number | null;
  checkIns: number | null;
  checkOuts: number | null;
  noShows: number | null;
  cancellations: number | null;
  breakfasts: number | null;
  totalAccommodationClp: number | null;
};

export type SalesPeriodMetrics = {
  periodStart: string;
  periodEnd: string;
  generatedAt: string | null;
  visibleThrough: string | null;
  visibleDays: number;
  expectedVisibleDays: number;
  truncated: boolean;
  daily: SalesPeriodDay[];
  totals: {
    courtesyRooms: number;
    dayUse: number;
    blockedRoomDays: number;
    costCentersClp: Record<keyof SalesPeriodCostCenters, number>;
  };
};

function normalizedLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function dmyToIso(raw: string): string | null {
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match?.[1] || !match[2] || !match[3]) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

function isoDate(raw: string): Date {
  return new Date(`${raw}T00:00:00.000Z`);
}

function inclusiveDays(from: string, to: string): number {
  const diff = isoDate(to).getTime() - isoDate(from).getTime();
  return Math.max(0, Math.floor(diff / 86_400_000) + 1);
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

function numericTokens(line: string): number[] {
  return Array.from(line.matchAll(/(?<![\d.])(\d{1,3}(?:\.\d{3})+|\d+)(?![\d.])/g))
    .map((match) => Number((match[1] ?? '').replace(/\./g, '')))
    .filter((value) => Number.isFinite(value));
}

function percentageTokens(line: string): number[] {
  return Array.from(line.matchAll(/(\d+(?:[.,]\d+)?)%/g))
    .map((match) => Number((match[1] ?? '').replace(',', '.')))
    .filter((value) => Number.isFinite(value));
}

function findLine(lines: string[], predicate: (line: string, index: number) => boolean): number {
  return lines.findIndex(predicate);
}

function startsWith(line: string, prefix: string): boolean {
  return line.toLocaleLowerCase('es-CL').startsWith(prefix.toLocaleLowerCase('es-CL'));
}

function seriesAt(
  lines: string[],
  index: number,
  prefix: string,
  count: number,
  options: { allowNextLine?: boolean } = {},
): Array<number | null> {
  if (index < 0 || !lines[index]) return Array.from({ length: count }, () => null);
  const line = lines[index]!;
  const own = numericTokens(line.slice(prefix.length));
  const values = [...own];
  if (options.allowNextLine !== false && values.length < count && lines[index + 1]) {
    values.push(...numericTokens(lines[index + 1]!));
  }
  return Array.from({ length: count }, (_, i) => values[i] ?? null);
}

function percentSeriesAt(
  lines: string[],
  index: number,
  count: number,
): Array<number | null> {
  if (index < 0 || !lines[index]) return Array.from({ length: count }, () => null);
  const values = percentageTokens(lines[index]!);
  return Array.from({ length: count }, (_, i) => values[i] ?? null);
}

function valueAt(values: Array<number | null>, index: number): number | null {
  return values[index] ?? null;
}

function sumNonNull(values: Array<number | null>): number {
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function costCenterTotals(days: SalesPeriodDay[]): Record<keyof SalesPeriodCostCenters, number> {
  const keys: Array<keyof SalesPeriodCostCenters> = [
    'alojamiento',
    'eventos',
    'spa',
    'multas',
    'multasFumar',
    'multasBlancos',
    'varios',
    'tasas',
  ];
  return Object.fromEntries(
    keys.map((key) => [key, days.reduce((sum, day) => sum + (day.costCenters[key] ?? 0), 0)]),
  ) as Record<keyof SalesPeriodCostCenters, number>;
}

export function parseSalesPeriodReport(rawText: string): SalesPeriodMetrics | null {
  const lines = normalizedLines(rawText);
  const header = lines.find((line) => /informe detalle ventas periodo:/i.test(line));
  if (!header) return null;

  const period = header.match(
    /\((\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})\)/,
  );
  const periodStart = period?.[1] ? dmyToIso(period[1]) : null;
  const periodEnd = period?.[2] ? dmyToIso(period[2]) : null;
  if (!periodStart || !periodEnd) return null;

  const dateLine = lines.find((line) => /de coste/i.test(line) && /\d{1,2}\/\d{1,2}\/\d{4}/.test(line));
  const dates = Array.from(dateLine?.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) ?? [])
    .map((match) => dmyToIso(match[0]))
    .filter((value): value is string => Boolean(value));
  if (!dates.length) return null;

  const count = dates.length;
  const hotelIndex = findLine(lines, (line) => /^Hotel HW\b/i.test(line));
  const accommodationIndex = findLine(lines, (line) => /^Alojamiento\s+CL\$/i.test(line));
  const eventsIndex = findLine(lines, (line) => /^Eventos\b/i.test(line));
  const spaIndex = findLine(lines, (line) => /^Spa\b/i.test(line));
  const finesIndex = findLine(lines, (line) => /^Multas\s+CL\$/i.test(line));
  const fineSubrows = lines
    .map((line, index) => ({ line, index }))
    .filter((row) => /^Multas por\s+CL\$/i.test(row.line))
    .map((row) => row.index);
  const smokingFineIndex = fineSubrows[0] ?? -1;
  const linenFineIndex = fineSubrows[1] ?? -1;
  const miscIndex = findLine(lines, (line) => /^Varios\b/i.test(line));
  const taxesIndex = findLine(lines, (line) => /^Tasas\b/i.test(line));
  const totalRoomsIndex = findLine(lines, (line) => /^Totales\b/i.test(line));
  const freeRoomsIndex = findLine(lines, (line) => /^Libres\b/i.test(line));
  const occupiedIndex = findLine(lines, (line) => /^Ocupadas\b/i.test(line));
  const withCostIndex = findLine(lines, (line) => /^Con coste\b/i.test(line));
  const courtesyIndex = findLine(lines, (line) => /^Cortesia\b/i.test(line));
  const dayUseIndex = findLine(lines, (line) => /^Day use\b/i.test(line));
  const blockedIndex = findLine(lines, (line) => /^Bloqueadas\b/i.test(line));
  const groupIndex = findLine(lines, (line) => /^Grupales\b/i.test(line));
  const passengersIndex = findLine(lines, (line) => /^Pasajeros\b/i.test(line));
  const guestsIndex = findLine(lines, (line) => /^Hu[eé]spedes\b/i.test(line));
  const adrIndex = findLine(lines, (line) => /^ADR\b/i.test(line));
  const occupancyIndex = findLine(lines, (line) => /^OCC Gen\b/i.test(line));
  const paidOccupancyIndex = findLine(lines, (line) => /^OCC Coste\b/i.test(line));
  const roomRevenueIndex = findLine(lines, (line) => /^RREV\b/i.test(line));
  const checkInIndex = findLine(lines, (line) => /^Check-in\b/i.test(line));
  const checkOutIndex = findLine(lines, (line) => /^Check-out\b/i.test(line));
  const noShowIndex = findLine(lines, (line) => /^No Show\b/i.test(line));
  const cancellationsIndex = findLine(lines, (line) => /^Canceladas\b/i.test(line));
  const breakfastsIndex = findLine(lines, (line) => /^Desayuno\b/i.test(line));
  const totalAccommodationIndex = findLine(lines, (line) => /^TOTAL\s+CL\$/i.test(line));

  const hotelTotal = seriesAt(lines, hotelIndex, 'Hotel HW', count);
  const accommodation = seriesAt(lines, accommodationIndex, 'Alojamiento', count);
  const events = seriesAt(lines, eventsIndex, 'Eventos', count);
  const spa = seriesAt(lines, spaIndex, 'Spa', count);
  const fines = seriesAt(lines, finesIndex, 'Multas', count);
  const smokingFines = seriesAt(lines, smokingFineIndex, 'Multas por', count);
  const linenFines = seriesAt(lines, linenFineIndex, 'Multas por', count);
  const misc = seriesAt(lines, miscIndex, 'Varios', count);
  const taxes = seriesAt(lines, taxesIndex, 'Tasas', count);
  const totalRooms = seriesAt(lines, totalRoomsIndex, 'Totales', count);
  const freeRooms = seriesAt(lines, freeRoomsIndex, 'Libres', count);
  const occupiedRooms = seriesAt(lines, occupiedIndex, 'Ocupadas', count);
  const occupiedWithCost = seriesAt(lines, withCostIndex, 'Con coste', count);
  const courtesyRooms = seriesAt(lines, courtesyIndex, 'Cortesia', count);
  const dayUse = seriesAt(lines, dayUseIndex, 'Day use', count);
  const blockedRooms = seriesAt(lines, blockedIndex, 'Bloqueadas', count);
  const groupRooms = seriesAt(lines, groupIndex, 'Grupales', count);
  const passengers = seriesAt(lines, passengersIndex, 'Pasajeros', count);
  const guests = seriesAt(lines, guestsIndex, 'Huéspedes', count);
  const adr = seriesAt(lines, adrIndex, 'ADR', count);
  const occupancy = percentSeriesAt(lines, occupancyIndex, count);
  const paidOccupancy = percentSeriesAt(lines, paidOccupancyIndex, count);
  const roomRevenue = seriesAt(lines, roomRevenueIndex, 'RREV', count);
  const checkIns = seriesAt(lines, checkInIndex, 'Check-in', count);
  const checkOuts = seriesAt(lines, checkOutIndex, 'Check-out', count);
  const noShows = seriesAt(lines, noShowIndex, 'No Show', count);
  const cancellations = seriesAt(lines, cancellationsIndex, 'Canceladas', count);
  const breakfasts = seriesAt(lines, breakfastsIndex, 'Desayuno', count);
  const totalAccommodation = seriesAt(lines, totalAccommodationIndex, 'TOTAL', count);

  const daily: SalesPeriodDay[] = dates.map((date, index) => ({
    date,
    hotelTotalClp: valueAt(hotelTotal, index),
    costCenters: {
      alojamiento: valueAt(accommodation, index),
      eventos: valueAt(events, index),
      spa: valueAt(spa, index),
      multas: valueAt(fines, index),
      multasFumar: valueAt(smokingFines, index),
      multasBlancos: valueAt(linenFines, index),
      varios: valueAt(misc, index),
      tasas: valueAt(taxes, index),
    },
    totalRooms: valueAt(totalRooms, index),
    freeRooms: valueAt(freeRooms, index),
    occupiedRooms: valueAt(occupiedRooms, index),
    occupiedWithCost: valueAt(occupiedWithCost, index),
    courtesyRooms: valueAt(courtesyRooms, index),
    dayUse: valueAt(dayUse, index),
    blockedRooms: valueAt(blockedRooms, index),
    groupRooms: valueAt(groupRooms, index),
    passengers: valueAt(passengers, index),
    guests: valueAt(guests, index),
    adrClp: valueAt(adr, index),
    occupancyPct: valueAt(occupancy, index),
    paidOccupancyPct: valueAt(paidOccupancy, index),
    roomRevenueClp: valueAt(roomRevenue, index),
    checkIns: valueAt(checkIns, index),
    checkOuts: valueAt(checkOuts, index),
    noShows: valueAt(noShows, index),
    cancellations: valueAt(cancellations, index),
    breakfasts: valueAt(breakfasts, index),
    totalAccommodationClp: valueAt(totalAccommodation, index),
  }));

  const generatedLine = lines.find((line) => /^Informe generado el\b/i.test(line));
  const generatedMatch = generatedLine?.match(
    /(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+(\d{1,2}:\d{2}:\d{2}))?/,
  );
  const generatedDate = generatedMatch?.[1] ? dmyToIso(generatedMatch[1]) : null;
  const expectedThrough = generatedDate
    ? minIso(periodEnd, generatedDate < periodStart ? periodStart : generatedDate)
    : periodEnd;
  const expectedVisibleDays = inclusiveDays(periodStart, expectedThrough);
  const visibleThrough = dates.at(-1) ?? null;
  const truncated = daily.length < expectedVisibleDays;

  return {
    periodStart,
    periodEnd,
    generatedAt:
      generatedDate && generatedMatch?.[2]
        ? `${generatedDate}T${generatedMatch[2]}`
        : generatedDate,
    visibleThrough,
    visibleDays: daily.length,
    expectedVisibleDays,
    truncated,
    daily,
    totals: {
      courtesyRooms: sumNonNull(courtesyRooms),
      dayUse: sumNonNull(dayUse),
      blockedRoomDays: sumNonNull(blockedRooms),
      costCentersClp: costCenterTotals(daily),
    },
  };
}

function formatDates(rows: Array<{ date: string; value?: number }>, limit = 6): string {
  const shown = rows.slice(0, limit).map((row) =>
    row.value === undefined ? row.date : `${row.date} (${row.value})`,
  );
  return rows.length > limit ? `${shown.join(', ')} y ${rows.length - limit} día(s) más` : shown.join(', ');
}

function closeEnough(a: number | null, b: number | null, tolerance: number): boolean {
  if (a === null || b === null) return true;
  return Math.abs(a - b) <= tolerance;
}

export function salesPeriodFindings(metrics: SalesPeriodMetrics): SalesPeriodFinding[] {
  const findings: SalesPeriodFinding[] = [];

  if (metrics.truncated) {
    findings.push({
      key: 'sales-period:coverage',
      severity: 'MEDIA',
      title: 'Ventas por período incompleto o truncado',
      detail: `El informe declara ${metrics.periodStart} a ${metrics.periodEnd}, pero sólo contiene ${metrics.visibleDays} día(s) completos; al momento de generarse se esperaban ${metrics.expectedVisibleDays}. Último día legible: ${metrics.visibleThrough ?? 'ninguno'}.`,
    });
  }

  const courtesyDays = metrics.daily
    .filter((day) => (day.courtesyRooms ?? 0) > 0)
    .map((day) => ({ date: day.date, value: day.courtesyRooms ?? 0 }));
  if (courtesyDays.length > 0) {
    findings.push({
      key: 'sales-period:courtesy',
      severity: 'ALTA',
      title: 'Cortesías detectadas en el período',
      detail: `Se registran ${metrics.totals.courtesyRooms} habitación(es)-día en cortesía: ${formatDates(courtesyDays)}. Requiere revisión de autorización y motivo.`,
    });
  }

  const availabilityMismatch = metrics.daily.filter(
    (day) =>
      day.totalRooms !== null &&
      day.freeRooms !== null &&
      day.occupiedRooms !== null &&
      day.freeRooms + day.occupiedRooms !== day.totalRooms,
  );
  if (availabilityMismatch.length > 0) {
    findings.push({
      key: 'sales-period:room-balance',
      severity: 'ALTA',
      title: 'Habitaciones libres + ocupadas no cuadran',
      detail: `El balance de inventario no coincide en: ${formatDates(availabilityMismatch)}.`,
    });
  }

  const classificationMismatch = metrics.daily.filter(
    (day) =>
      day.occupiedRooms !== null &&
      day.occupiedWithCost !== null &&
      day.courtesyRooms !== null &&
      day.occupiedWithCost + day.courtesyRooms !== day.occupiedRooms,
  );
  if (classificationMismatch.length > 0) {
    findings.push({
      key: 'sales-period:occupancy-classification',
      severity: 'ALTA',
      title: 'Ocupación no concilia con con-coste + cortesía',
      detail: `La clasificación de habitaciones ocupadas difiere en: ${formatDates(classificationMismatch)}.`,
    });
  }

  const centerMismatch = metrics.daily
    .map((day) => {
      const centerTotal = Object.values(day.costCenters).reduce<number>(
        (sum, value) => sum + (value ?? 0),
        0,
      );
      const difference =
        day.hotelTotalClp === null ? null : day.hotelTotalClp - centerTotal;
      return { date: day.date, difference };
    })
    .filter(
      (row): row is { date: string; difference: number } =>
        row.difference !== null && Math.abs(row.difference) > 2,
    );
  if (centerMismatch.length > 0) {
    findings.push({
      key: 'sales-period:cost-center-total',
      severity: 'MEDIA',
      title: 'Total del hotel no concilia con centros de coste visibles',
      detail: `Hay diferencias superiores a $2 en: ${formatDates(
        centerMismatch.map((row) => ({ date: row.date, value: row.difference })),
      )}. Puede indicar un centro de coste omitido, una imputación distinta o un problema del reporte.`,
    });
  }

  const lodgingRevenueMismatch = metrics.daily.filter(
    (day) =>
      !closeEnough(day.costCenters.alojamiento, day.roomRevenueClp, 2) ||
      !closeEnough(day.hotelTotalClp, day.totalAccommodationClp, 2),
  );
  if (lodgingRevenueMismatch.length > 0) {
    findings.push({
      key: 'sales-period:lodging-revenue',
      severity: 'MEDIA',
      title: 'Producción de alojamiento no cuadra dentro del propio informe',
      detail: `RREV/Alojamiento o el total superior/inferior difieren en: ${formatDates(lodgingRevenueMismatch)}.`,
    });
  }

  const adrMismatch = metrics.daily.filter((day) => {
    if (
      day.adrClp === null ||
      day.roomRevenueClp === null ||
      day.occupiedWithCost === null ||
      day.occupiedWithCost <= 0
    ) {
      return false;
    }
    return Math.abs(day.adrClp - day.roomRevenueClp / day.occupiedWithCost) > 2;
  });
  if (adrMismatch.length > 0) {
    findings.push({
      key: 'sales-period:adr',
      severity: 'MEDIA',
      title: 'ADR no concilia con RREV / habitaciones con coste',
      detail: `El cálculo interno difiere en: ${formatDates(adrMismatch)}.`,
    });
  }

  const occupancyMismatch = metrics.daily.filter((day) => {
    if (
      day.occupancyPct === null ||
      day.occupiedRooms === null ||
      day.totalRooms === null ||
      day.totalRooms <= 0
    ) {
      return false;
    }
    return Math.abs(day.occupancyPct - (day.occupiedRooms / day.totalRooms) * 100) > 0.06;
  });
  if (occupancyMismatch.length > 0) {
    findings.push({
      key: 'sales-period:occupancy-pct',
      severity: 'MEDIA',
      title: 'OCC general no concilia con ocupación / inventario',
      detail: `El porcentaje informado difiere del cálculo en: ${formatDates(occupancyMismatch)}.`,
    });
  }

  const paidOccupancyMismatch = metrics.daily.filter((day) => {
    if (
      day.paidOccupancyPct === null ||
      day.occupiedWithCost === null ||
      day.totalRooms === null ||
      day.totalRooms <= 0
    ) {
      return false;
    }
    return Math.abs(day.paidOccupancyPct - (day.occupiedWithCost / day.totalRooms) * 100) > 0.06;
  });
  if (paidOccupancyMismatch.length > 0) {
    findings.push({
      key: 'sales-period:paid-occupancy-pct',
      severity: 'MEDIA',
      title: 'OCC con coste no concilia con habitaciones con coste / inventario',
      detail: `El porcentaje informado difiere del cálculo en: ${formatDates(paidOccupancyMismatch)}.`,
    });
  }

  return findings;
}
