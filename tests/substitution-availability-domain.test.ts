import { describe, expect, it } from 'vitest';
import { datePlus, dayWindow, templateWindow } from '@/domain/schedule';
import { hotelDateKey } from '@/domain/time';
import { selectSubstitutionAvailability, type SubstitutionAvailabilityInput, type SubstitutionSlotEvidence } from '@/domain/substitution-availability';

const now = new Date('2026-10-04T17:00:00.000Z');
function slot(userId: string, id: string, start: string, end: string, patch: Partial<SubstitutionSlotEvidence> = {}): SubstitutionSlotEvidence {
  const startAt = new Date(start);
  return {
    id, userId, collaboratorId: `collaborator-${userId}`, date: hotelDateKey(startAt),
    planId: 'plan-1', planStatus: 'PUBLICADO', publishedVersion: 3,
    publishedAt: new Date('2026-09-01T12:00:00.000Z'), updatedAt: new Date('2026-09-02T12:00:00.000Z'),
    functionName: 'Recepcionista', kind: 'TURNO', startAt, endAt: new Date(end),
    baseEndAt: new Date(end), breakStartAt: null, breakEndAt: null, breakPaid: false,
    cancelledAt: null, extraKind: 'NINGUNO', extraStatus: 'NO_APLICA', ...patch,
  };
}
function input(slots: SubstitutionSlotEvidence[], patch: Partial<SubstitutionAvailabilityInput> = {}): SubstitutionAvailabilityInput {
  return {
    candidateIds: ['a', 'b'], currentOwnerId: 'owner', eligibleUserIds: ['a', 'b'], slots, now,
    expiresAt: new Date('2026-11-01T03:00:00.000Z'), searchUntil: dayWindow(datePlus(hotelDateKey(now), 14)).startAt,
    ...patch,
  };
}
const currentA = () => slot('a', 'a-current', '2026-10-04T11:00:00Z', '2026-10-04T22:00:00Z');
const currentB = () => slot('b', 'b-current', '2026-10-04T12:00:00Z', '2026-10-04T23:00:00Z');
const futureA = () => slot('a', 'a-tomorrow', '2026-10-05T11:00:00Z', '2026-10-05T22:00:00Z');
const futureB = () => slot('b', 'b-tonight', '2026-10-05T00:00:00Z', '2026-10-05T11:00:00Z');

describe('suplencia: selección publicada determinística', () => {
  it('elige la próxima franja aunque otra persona tenga mayor preferencia y comience después', () => {
    const result = selectSubstitutionAvailability(input([futureA(), futureB()]));
    expect(result).toMatchObject({ state: 'FUTURE_SLOT', reasonCode: 'NEXT_PUBLISHED_SLOT', eligibleNow: false, planningOnly: true });
    expect(result.selection).toMatchObject({ userId: 'b', candidatePosition: 1, slotId: 'b-tonight', planId: 'plan-1', publishedVersion: 3 });
    expect(selectSubstitutionAvailability(input([futureB(), futureA()]))).toEqual(result);
  });

  it('desempata la misma hora por el orden de personas y luego por id estable de franja', () => {
    const first = futureB();
    const aZ = { ...first, userId: 'a', id: 'z-slot' }; const aA = { ...aZ, id: 'a-slot' };
    const result = selectSubstitutionAvailability(input([first, aZ, aA]));
    expect(result.selection).toMatchObject({ userId: 'a', slotId: 'a-slot', candidatePosition: 0 });
    expect(selectSubstitutionAvailability(input([aA, first, aZ]))).toEqual(result);
    expect(selectSubstitutionAvailability(input([aZ, first, aA], { candidateIds: ['b', 'a'] })).selection?.userId).toBe('b');
  });

  it('conserva preferencia de candidato actual aunque el otro haya empezado antes', () => {
    const a = currentA(); const b = { ...currentB(), startAt: new Date('2026-10-04T10:00:00Z') };
    expect(selectSubstitutionAvailability(input([b, a]))).toMatchObject({
      state: 'AVAILABLE_NOW', reasonCode: 'PUBLISHED_SLOT_NOW', eligibleNow: true, selection: { userId: 'a' },
    });
  });

  it('no posterga a un candidato actual por uno preferido con horario futuro', () => {
    expect(selectSubstitutionAvailability(input([futureA(), currentB()]))).toMatchObject({ state: 'AVAILABLE_NOW', selection: { userId: 'b' } });
  });

  it('excluye responsable actual, personas no elegibles y cuentas fuera de la lista explícita', () => {
    expect(selectSubstitutionAvailability(input([currentA(), currentB()], { currentOwnerId: 'a' })).selection?.userId).toBe('b');
    expect(selectSubstitutionAvailability(input([currentA(), currentB()], { eligibleUserIds: ['b'] })).selection?.userId).toBe('b');
    expect(selectSubstitutionAvailability(input([currentA()], { candidateIds: ['b'] }))).toMatchObject({ state: 'NO_SLOT', reasonCode: 'NO_SLOT_IN_WINDOW', selection: null });
    expect(selectSubstitutionAvailability(input([currentA()], { eligibleUserIds: [] }))).toMatchObject({ state: 'NO_SLOT', reasonCode: 'NO_ELIGIBLE_CANDIDATE' });
    expect(selectSubstitutionAvailability(input([{ ...currentA(), userId: null }])).selection).toBeNull();
  });

  it('no afirma ausencia global ni confirma asistencia si no encuentra evidencia', () => {
    expect(selectSubstitutionAvailability(input([]))).toEqual({ state: 'NO_SLOT', reasonCode: 'NO_SLOT_IN_WINDOW', planningOnly: true, eligibleNow: false, selection: null });
  });

  it.each([false, true])('una lectura incompleta no ofrece selección aunque haya franja actual: %s', (hasCurrent) => {
    expect(selectSubstitutionAvailability(input([hasCurrent ? currentA() : futureA()], { complete: false }))).toEqual({
      state: 'INCOMPLETE', reasonCode: 'INCOMPLETE_EVIDENCE', planningOnly: true, eligibleNow: false, selection: null,
    });
  });
});

describe('suplencia: límites exclusivos y evidencia válida', () => {
  it('incluye el comienzo exacto y excluye el final exacto de una jornada', () => {
    const s = currentA();
    expect(selectSubstitutionAvailability(input([s], { now: s.startAt! })).state).toBe('AVAILABLE_NOW');
    expect(selectSubstitutionAvailability(input([s], { now: new Date(s.endAt!.getTime() - 1) })).state).toBe('AVAILABLE_NOW');
    expect(selectSubstitutionAvailability(input([s], { now: s.endAt! })).state).toBe('NO_SLOT');
    expect(selectSubstitutionAvailability(input([s], { now: new Date(s.startAt!.getTime() - 1) })).state).toBe('FUTURE_SLOT');
  });

  it('excluye el límite de búsqueda, pero permite una franja que empieza un instante antes', () => {
    const searchUntil = input([]).searchUntil;
    const edge = slot('a', 'edge', searchUntil.toISOString(), new Date(searchUntil.getTime() + 3600000).toISOString());
    expect(selectSubstitutionAvailability(input([edge])).reasonCode).toBe('NO_SLOT_IN_WINDOW');
    const before = { ...edge, startAt: new Date(searchUntil.getTime() - 1) };
    const selection = selectSubstitutionAvailability(input([before])).selection;
    expect(selection?.slotId).toBe('edge');
    // The horizon limits where to search for a start; it is not an authorization end.
    expect(selection?.eligibleUntil).toEqual(before.endAt);
  });

  it('no ofrece una franja que empieza exactamente al vencer la autorización', () => {
    const s = futureB();
    expect(selectSubstitutionAvailability(input([s], { expiresAt: s.startAt! }))).toMatchObject({ state: 'AUTHORIZATION_EXPIRES', eligibleNow: false, selection: null });
    expect(selectSubstitutionAvailability(input([s], { expiresAt: new Date(s.startAt!.getTime() - 1) })).reasonCode).toBe('AUTHORIZATION_EXPIRES');
  });

  it('la autorización puede cubrir sólo parte de la franja y recorta eligibleUntil', () => {
    const s = futureB(); const expiresAt = new Date(s.startAt!.getTime() + 1);
    expect(selectSubstitutionAvailability(input([s], { expiresAt })).selection).toMatchObject({ effectiveEndAt: s.endAt, eligibleUntil: expiresAt });
    expect(selectSubstitutionAvailability(input([currentA()], { expiresAt: now }))).toMatchObject({ state: 'AUTHORIZATION_EXPIRES', selection: null });
  });

  it.each<Partial<SubstitutionSlotEvidence>>([
    { cancelledAt: now }, { planStatus: 'BORRADOR' }, { publishedVersion: null }, { publishedVersion: 0 },
    { publishedVersion: 1.5 }, { publishedAt: null }, { publishedAt: new Date(NaN) }, { updatedAt: new Date(NaN) },
    { kind: 'LIBRE' }, { kind: 'AUSENCIA' }, { kind: 'VACACIONES' }, { startAt: null }, { endAt: null },
    { startAt: new Date(NaN) }, { endAt: new Date(NaN) }, { endAt: new Date('2026-10-04T11:00:00Z') },
    { endAt: new Date('2026-10-04T10:59:59Z') }, { date: '2026-02-30' }, { id: '' }, { planId: '' },
  ])('omite evidencia cancelada, no publicada o inválida: %j', (patch) => {
    expect(selectSubstitutionAvailability(input([{ ...currentA(), ...patch }])).selection).toBeNull();
  });

  it.each<Partial<SubstitutionAvailabilityInput>>([
    { now: new Date(NaN) }, { expiresAt: new Date(NaN) }, { searchUntil: new Date(NaN) },
    { searchUntil: now }, { searchUntil: new Date(now.getTime() - 1) },
  ])('no inventa una ventana de consulta cuando los límites son inválidos: %j', (patch) => {
    expect(selectSubstitutionAvailability(input([currentA()], patch))).toMatchObject({ state: 'REVIEW_REQUIRED', reasonCode: 'INVALID_SEARCH_WINDOW', selection: null });
  });

  it('no modifica evidencia ni entrega las referencias de fecha originales', () => {
    const s = currentA(); const before = structuredClone(s); const result = selectSubstitutionAvailability(input([s]));
    expect(s).toEqual(before);
    result.selection?.startAt.setTime(0); result.selection?.effectiveEndAt.setTime(0); result.selection?.slotUpdatedAt.setTime(0);
    expect(s).toEqual(before);
  });
});

describe('suplencia: cobertura canónica de extras y conflictos', () => {
  it.each(['PENDIENTE', 'RECHAZADO', 'NO_APLICA'])('el turno adicional %s no ofrece cobertura', (extraStatus) => {
    expect(selectSubstitutionAvailability(input([{ ...currentA(), extraKind: 'TURNO_EXTRA', extraStatus }])).selection).toBeNull();
  });

  it.each(['APROBADO', 'REPORTADO', 'VALIDADO'])('el turno adicional %s sí ofrece cobertura', (extraStatus) => {
    expect(selectSubstitutionAvailability(input([{ ...currentA(), extraKind: 'TURNO_EXTRA', extraStatus }])).state).toBe('AVAILABLE_NOW');
  });

  it.each(['PENDIENTE', 'RECHAZADO'])('la extensión %s conserva la jornada base y descarta sólo minutos adicionales', (extraStatus) => {
    const s = { ...currentA(), extraKind: 'EXTENSION', extraStatus, endAt: new Date('2026-10-05T00:00:00Z') };
    expect(selectSubstitutionAvailability(input([s])).selection?.effectiveEndAt).toEqual(s.baseEndAt);
    expect(selectSubstitutionAvailability(input([s], { now: s.baseEndAt! })).state).toBe('NO_SLOT');
    expect(s.endAt.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('conserva el término de una extensión aprobada', () => {
    const s = { ...currentA(), extraKind: 'EXTENSION', extraStatus: 'APROBADO', endAt: new Date('2026-10-05T00:00:00Z') };
    expect(selectSubstitutionAvailability(input([s], { now: s.baseEndAt! }))).toMatchObject({ state: 'AVAILABLE_NOW', selection: { effectiveEndAt: s.endAt } });
  });

  it('descarta intervalos efectivos inválidos tras recortar una extensión', () => {
    const s = { ...currentA(), extraKind: 'EXTENSION', extraStatus: 'RECHAZADO', baseEndAt: currentA().startAt };
    expect(selectSubstitutionAvailability(input([s])).selection).toBeNull();
  });

  it('salta conflictos publicados conocidos y elige otra franja válida', () => {
    expect(selectSubstitutionAvailability(input([futureB(), futureA()], { blockedSlotIds: ['b-tonight'] }))).toMatchObject({ state: 'FUTURE_SLOT', selection: { userId: 'a' } });
    expect(selectSubstitutionAvailability(input([currentA(), currentB()], { blockedSlotIds: ['a-current'] })).selection?.userId).toBe('b');
  });

  it('pide revisión si sólo quedan franjas bloqueadas, sin revelar los conflictos privados', () => {
    expect(selectSubstitutionAvailability(input([futureB()], { blockedSlotIds: ['b-tonight'] }))).toEqual({
      state: 'REVIEW_REQUIRED', reasonCode: 'PLANNING_CONFLICT', planningOnly: true, eligibleNow: false, selection: null,
    });
    expect(selectSubstitutionAvailability(input([], { blockedSlotIds: ['unknown-slot'] })).reasonCode).toBe('NO_SLOT_IN_WINDOW');
  });
});

describe('suplencia: noches y calendario America/Santiago', () => {
  function night(date: string): SubstitutionSlotEvidence {
    const window = templateWindow(date, { startTime: '21:00', endTime: '08:00', crossesMidnight: true, breakMinutes: 0, breakPaid: false });
    return slot('a', `night-${date}`, window.startAt.toISOString(), window.endAt.toISOString(), { date });
  }

  it('reconoce una noche iniciada en la fecha anterior sin reconstruir la plantilla', () => {
    const s = night('2026-10-03');
    const result = selectSubstitutionAvailability(input([s], { now: new Date('2026-10-04T05:00:00Z') }));
    expect(result).toMatchObject({ state: 'AVAILABLE_NOW', selection: { startAt: s.startAt, effectiveEndAt: s.endAt } });
    expect(s.date).toBe('2026-10-03');
  });

  it.each([['2026-04-04', 12], ['2026-09-05', 10]] as const)('conserva los instantes persistidos de RN01 %s y sus %s horas reales', (date, hours) => {
    const s = night(date); const clock = new Date(s.startAt!.getTime() + 1);
    const result = selectSubstitutionAvailability(input([s], { now: clock, searchUntil: dayWindow(datePlus(hotelDateKey(clock), 14)).startAt }));
    expect(result.state).toBe('AVAILABLE_NOW');
    expect((result.selection!.effectiveEndAt.getTime() - result.selection!.startAt.getTime()) / 3600000).toBe(hours);
  });

  it('la ventana de 14 fechas civiles respeta el salto DST y excluye su inicio final', () => {
    const clock = dayWindow('2026-08-24').startAt;
    const searchUntil = dayWindow(datePlus(hotelDateKey(clock), 14)).startAt;
    expect(searchUntil.toISOString()).toBe('2026-09-07T03:00:00.000Z');
    expect((searchUntil.getTime() - clock.getTime()) / 3600000).toBe(335);
    const edge = slot('a', 'edge', searchUntil.toISOString(), '2026-09-07T11:00:00Z');
    expect(selectSubstitutionAvailability(input([edge], { now: clock, searchUntil })).reasonCode).toBe('NO_SLOT_IN_WINDOW');
  });

  it('la medianoche omitida no se transforma en un comienzo ficticio', () => {
    const spring = dayWindow('2026-09-06');
    expect(spring.startAt.toISOString()).toBe('2026-09-06T04:00:00.000Z');
    const s = slot('a', 'spring-first-minute', spring.startAt.toISOString(), spring.endAt.toISOString());
    expect(selectSubstitutionAvailability(input([s], { now: new Date('2026-09-06T03:59:59Z'), searchUntil: spring.endAt })).state).toBe('FUTURE_SLOT');
    expect(selectSubstitutionAvailability(input([s], { now: spring.startAt, searchUntil: spring.endAt })).state).toBe('AVAILABLE_NOW');
    expect(() => templateWindow('2026-09-06', { startTime: '00:30', endTime: '08:00', crossesMidnight: false, breakMinutes: 0, breakPaid: false })).toThrow('no existe');
  });
});
