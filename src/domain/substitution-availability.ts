import { coverageSlots, validDate, type IntervalSlot } from './schedule';

/** Reader-normalized evidence; the reader owns account, area and access checks. */
export type SubstitutionSlotEvidence = IntervalSlot & {
  id: string;
  userId: string | null;
  date: string;
  planId: string;
  planStatus: string;
  publishedVersion: number | null;
  publishedAt: Date | null;
  updatedAt: Date;
};

export type SubstitutionSlotSelection = {
  userId: string;
  /** Zero-based position in the policy's explicit candidate order. */
  candidatePosition: number;
  slotId: string;
  planId: string;
  publishedVersion: number;
  slotUpdatedAt: Date;
  startAt: Date;
  effectiveEndAt: Date;
  eligibleUntil: Date;
};

export type SubstitutionAvailabilityInput = {
  candidateIds: readonly string[];
  currentOwnerId: string | null;
  eligibleUserIds: readonly string[];
  slots: readonly SubstitutionSlotEvidence[];
  now: Date;
  expiresAt: Date;
  /** Exclusive start boundary, computed with Santiago calendar days by the reader. */
  searchUntil: Date;
  /** Includes published planning conflicts and any reader-specific eligibility veto. */
  blockedSlotIds?: readonly string[];
  /** False if any evidence needed to establish candidate order or conflicts is missing. */
  complete?: boolean;
};

export type SubstitutionAvailabilityResult = {
  state: 'AVAILABLE_NOW' | 'FUTURE_SLOT' | 'NO_SLOT' | 'AUTHORIZATION_EXPIRES' | 'REVIEW_REQUIRED' | 'INCOMPLETE';
  reasonCode: 'PUBLISHED_SLOT_NOW' | 'NEXT_PUBLISHED_SLOT' | 'NO_SLOT_IN_WINDOW' | 'NO_ELIGIBLE_CANDIDATE' | 'AUTHORIZATION_EXPIRES' | 'PLANNING_CONFLICT' | 'INVALID_SEARCH_WINDOW' | 'INCOMPLETE_EVIDENCE';
  planningOnly: true;
  eligibleNow: boolean;
  selection: SubstitutionSlotSelection | null;
};

function finiteDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function result(
  state: SubstitutionAvailabilityResult['state'],
  reasonCode: SubstitutionAvailabilityResult['reasonCode'],
  selection: SubstitutionSlotSelection | null = null,
): SubstitutionAvailabilityResult {
  return { state, reasonCode, planningOnly: true, eligibleNow: state === 'AVAILABLE_NOW', selection };
}

function stableId(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

/**
 * Planning evidence only: this neither assigns work nor establishes attendance.
 * Current candidates retain policy order; only future opportunities sort by time first.
 * Slots use persisted instants after canonical extra-shift coverage normalization.
 */
export function selectSubstitutionAvailability(input: SubstitutionAvailabilityInput): SubstitutionAvailabilityResult {
  const { now, expiresAt, searchUntil } = input;
  if (!finiteDate(now) || !finiteDate(expiresAt) || !finiteDate(searchUntil) || searchUntil <= now) {
    return result('REVIEW_REQUIRED', 'INVALID_SEARCH_WINDOW');
  }
  if (expiresAt <= now) return result('AUTHORIZATION_EXPIRES', 'AUTHORIZATION_EXPIRES');
  if (input.complete === false) return result('INCOMPLETE', 'INCOMPLETE_EVIDENCE');

  const eligible = new Set(input.eligibleUserIds);
  const positions = new Map<string, number>();
  input.candidateIds.forEach((id, position) => {
    if (id && id !== input.currentOwnerId && eligible.has(id) && !positions.has(id)) positions.set(id, position);
  });
  if (!positions.size) return result('NO_SLOT', 'NO_ELIGIBLE_CANDIDATE');

  const blocked = new Set(input.blockedSlotIds);
  const current: SubstitutionSlotSelection[] = [];
  const future: SubstitutionSlotSelection[] = [];
  let hasBlockedOpportunity = false;
  let hasOpportunityAfterExpiry = false;

  for (const slot of coverageSlots([...input.slots])) {
    const position = slot.userId ? positions.get(slot.userId) : undefined;
    if (position === undefined || !slot.userId || !slot.id || !slot.planId || slot.planStatus !== 'PUBLICADO' ||
      !Number.isSafeInteger(slot.publishedVersion) || slot.publishedVersion! <= 0 ||
      !finiteDate(slot.publishedAt) || !finiteDate(slot.updatedAt) || !validDate(slot.date) ||
      slot.kind !== 'TURNO' || !finiteDate(slot.startAt) || !finiteDate(slot.endAt) || slot.endAt <= slot.startAt ||
      slot.endAt <= now || slot.startAt >= searchUntil) continue;

    if (slot.startAt >= expiresAt) {
      hasOpportunityAfterExpiry = true;
      continue;
    }
    if (blocked.has(slot.id)) {
      hasBlockedOpportunity = true;
      continue;
    }

    const selection: SubstitutionSlotSelection = {
      userId: slot.userId, candidatePosition: position, slotId: slot.id, planId: slot.planId,
      publishedVersion: slot.publishedVersion!, slotUpdatedAt: new Date(slot.updatedAt),
      startAt: new Date(slot.startAt), effectiveEndAt: new Date(slot.endAt),
      eligibleUntil: new Date(Math.min(slot.endAt.getTime(), expiresAt.getTime())),
    };
    (slot.startAt <= now ? current : future).push(selection);
  }

  current.sort((a, b) => a.candidatePosition - b.candidatePosition || a.startAt.getTime() - b.startAt.getTime() || stableId(a.slotId, b.slotId));
  if (current[0]) return result('AVAILABLE_NOW', 'PUBLISHED_SLOT_NOW', current[0]);
  future.sort((a, b) => a.startAt.getTime() - b.startAt.getTime() || a.candidatePosition - b.candidatePosition || stableId(a.slotId, b.slotId));
  if (future[0]) return result('FUTURE_SLOT', 'NEXT_PUBLISHED_SLOT', future[0]);
  if (hasBlockedOpportunity) return result('REVIEW_REQUIRED', 'PLANNING_CONFLICT');
  if (hasOpportunityAfterExpiry) return result('AUTHORIZATION_EXPIRES', 'AUTHORIZATION_EXPIRES');
  return result('NO_SLOT', 'NO_SLOT_IN_WINDOW');
}

const availabilityReasons:Record<string,string>={
  HK_ORIGINAL_DATE_UNAVAILABLE:'La persona está declarada no disponible en la fecha original del trabajo; el arrastre requiere revisión humana, sin cambiar la fecha',
  NO_SLOT_IN_WINDOW:'No hay una franja publicada elegible en la ventana consultada; revisa cobertura o asigna manualmente',
  NO_ELIGIBLE_CANDIDATE:'No hay candidato elegible con los datos actuales; revisa cuentas, permisos y disponibilidad',
  AUTHORIZATION_EXPIRES:'La autorización termina antes de la próxima oportunidad publicada',
  POLICY_NOT_CURRENT:'La autorización está revocada o vencida',
  PLANNING_CONFLICT:'La planificación o disponibilidad requiere revisión humana',
  INCOMPLETE_EVIDENCE:'Lectura incompleta; no se puede afirmar cuál es la próxima franja',
  INVALID_SEARCH_WINDOW:'La ventana temporal requiere revisión',
  POLICY_ACCESS_REQUIRED:'La política está fuera de tu acceso',
  ASSIGNMENT_PERMISSION_REQUIRED:'No conservas autorización para asignar este trabajo',
  SCHEDULE_ACCESS_REQUIRED:'El horario de equipo está fuera de tu acceso',
  SCHEDULE_AREA_REQUIRED:'El horario de esta área está fuera de tu acceso',
  WORK_NO_LONGER_PENDING:'El trabajo cambió, ya fue recibido o iniciado; conserva su responsable y circuito humano',
};

export function substitutionAvailabilityReason(reasonCode:string):string {
  return availabilityReasons[reasonCode]??'El pendiente requiere revisión humana.';
}
