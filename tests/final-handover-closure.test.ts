import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HandoverStatus, ShiftStatus, ShiftType } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  openShiftAs,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import type { CurrentUser } from '@/server/auth/current-user';
import {
  MAINTENANCE_DEFAULT,
  MAINTENANCE_SETTING_KEY,
  SYSTEM_CLOSURE_MESSAGE,
} from '@/domain/system-maintenance';
import {
  addShiftMember,
  changeShiftType,
  closeShift,
  confirmHandoverReviewStep,
  confirmReceptionReviewStep,
  getMyActiveShift,
  openShift,
  prepareHandover,
  receiveHandover,
  receiveShiftCash,
  removeShiftMember,
  sendHandover,
  startFinalHandoverReception,
  startReceptionShift,
} from '@/server/services/shifts';
import { markHandoverElements, saveCashCount } from '@/server/services/cash';
import { closeShiftCash, getShiftCashClosure } from '@/server/services/cash-closure';
import {
  approveHandoverElementException,
  reportHandoverElementMissing,
} from '@/server/services/handover-elements';
import { assertMaintenanceAccess, getMaintenanceState } from '@/server/services/system-maintenance';

describe('cierre ordenado · recepción final sin una nueva jornada', () => {
  let sender: CurrentUser;
  let receiver: CurrentUser;
  let sysadmin: CurrentUser;

  beforeAll(seedCatalog);

  beforeEach(async () => {
    await resetOperationalData();
    sender = { ...await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Saliente de prueba' }), sessionId: 'sesion-saliente' };
    receiver = { ...await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Receptor de prueba' }), sessionId: 'sesion-receptor' };
    sysadmin = { ...await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Administrador de prueba' }), sessionId: 'sesion-sysadmin' };
  });

  async function beginClosure() {
    const value = {
      enabled: false,
      message: SYSTEM_CLOSURE_MESSAGE,
      startedAt: null,
      closure: {
        phase: 'CLOSING',
        startedAt: new Date().toISOString(),
        startedById: sysadmin.id,
        pendingShiftIds: (await prisma.shift.findMany({ where: { status: { not: ShiftStatus.CERRADO } }, select: { id: true } })).map(shift => shift.id),
        backup: null,
        lockedAt: null,
        lockedById: null,
      },
    };
    await prisma.systemSetting.upsert({
      where: { key: MAINTENANCE_SETTING_KEY },
      create: { key: MAINTENANCE_SETTING_KEY, value, category: 'mantenimiento', updatedById: sysadmin.id },
      update: { value, updatedById: sysadmin.id },
    });
    expect(await getMaintenanceState()).toMatchObject({ valid: true, enabled: false, closure: { phase: 'CLOSING' } });
  }

  async function senderReview(handoverId: string) {
    await confirmHandoverReviewStep(sender, { handoverId, step: 'PENDINGS' });
    await confirmHandoverReviewStep(sender, { handoverId, step: 'FINAL', urgentAcknowledged: true });
  }

  async function finalReview(user: CurrentUser, handoverId: string) {
    await confirmReceptionReviewStep(user, { handoverId, step: 'CUSTODY' });
    await confirmReceptionReviewStep(user, { handoverId, step: 'FINAL', urgentAcknowledged: true });
  }

  async function sentHandover(options: { closing?: boolean; cash?: boolean; custody?: boolean } = {}) {
    const shift = await openShiftAs(sender, { type: ShiftType.DIA });
    if (options.closing !== false) await beginClosure();
    if (options.cash) await prisma.cashFund.create({ data: { currency: 'CLP', amount: 100_000 } });
    if (options.custody) await prisma.handoverElementType.create({ data: { name: 'Llave sintética del relevo final', required: true } });
    const handover = await prepareHandover(sender, shift.id);
    const denomination = await prisma.cashDenomination.findFirstOrThrow({ where: { currency: 'CLP', value: 20_000, active: true } });
    const quantities = { [denomination.id]: 5 };
    if (options.cash) {
      await saveCashCount(sender, { handoverId: handover.id, kind: 'DECLARADO', quantities });
      await closeShiftCash(sender, { shiftId: shift.id });
    }
    const element = await prisma.handoverElement.findFirst({ where: { handoverId: handover.id } });
    if (element) await markHandoverElements(sender, { handoverId: handover.id, field: 'declared', marks: { [element.id]: true } });
    await senderReview(handover.id);
    await sendHandover(sender, { shiftId: shift.id, notes: 'Entrega final sintética para la prueba.' });
    await closeShift(sender, { shiftId: shift.id });
    return { shift, handover, quantities, element };
  }

  it('conserva las barreras reales de Caja, custodia y revisión; permite reintentar sin abrir un turno', async () => {
    const shift = await openShiftAs(sender, { type: ShiftType.DIA });
    await beginClosure();
    await prisma.cashFund.create({ data: { currency: 'CLP', amount: 100_000 } });
    await prisma.handoverElementType.create({ data: { name: 'Llave sintética de caja', required: true } });
    const guarantee = await prisma.guarantee.create({ data: {
      kind: 'EFECTIVO', state: 'VIGENTE', currency: 'CLP', amount: 50_000,
      guestName: 'Persona ficticia', createdById: sender.id,
    } });
    const denomination = await prisma.cashDenomination.findFirstOrThrow({ where: { currency: 'CLP', value: 20_000, active: true } });
    const quantities = { [denomination.id]: 5 };
    const handover = await prepareHandover(sender, shift.id);
    const element = await prisma.handoverElement.findFirstOrThrow({ where: { handoverId: handover.id } });

    await expect(closeShiftCash(sender, { shiftId: shift.id })).rejects.toThrow(/arqueo formal/i);
    await expect(saveCashCount(sender, { handoverId: handover.id, kind: 'DECLARADO', quantities })).rejects.toThrow(/garantías/i);
    await saveCashCount(sender, { handoverId: handover.id, kind: 'DECLARADO', quantities, guaranteeIds: [guarantee.id] });
    await markHandoverElements(sender, { handoverId: handover.id, field: 'declared', marks: { [element.id]: true } });
    await expect(sendHandover(sender, { shiftId: shift.id })).rejects.toThrow(/cierre formal de Caja/i);
    expect(await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).toMatchObject({ status: 'PREPARANDO_ENTREGA', actualEnd: null });
    await closeShiftCash(sender, { shiftId: shift.id });
    await senderReview(handover.id);
    await sendHandover(sender, { shiftId: shift.id });
    await expect(startFinalHandoverReception(receiver, { handoverId: handover.id })).rejects.toThrow(/no está disponible/i);
    await closeShift(sender, { shiftId: shift.id });
    expect((await getShiftCashClosure(shift.id))?.reopenedAt).toBeNull();
    expect(await getMyActiveShift(sender.id)).toBeNull();

    const claim = await startFinalHandoverReception(receiver, { handoverId: handover.id });
    expect(claim).toMatchObject({ status: HandoverStatus.ENVIADA, toShiftId: null, receivedAt: null, receivedById: receiver.id, receiverSessionId: receiver.sessionId });
    await expect(receiveHandover(receiver, { handoverId: handover.id })).rejects.toThrow(/revisa la entrega/i);
    await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
    await expect(confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'CUSTODY' })).rejects.toThrow(/efectivo|recibiste/i);
    await expect(receiveShiftCash(receiver, { handoverId: handover.id, quantities })).rejects.toThrow(/garantías/i);
    expect(await prisma.cashCount.count({ where: { handoverId: handover.id, kind: 'CONFIRMADO' } })).toBe(0);
    const cash = await receiveShiftCash(receiver, { handoverId: handover.id, quantities, guaranteeIds: [guarantee.id] });
    expect(cash).toMatchObject({ shiftId: null, discrepancies: [] });
    await expect(confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'CUSTODY' })).rejects.toThrow(/recibiste|físicos/i);
    await markHandoverElements(receiver, { handoverId: handover.id, field: 'confirmed', marks: { [element.id]: true } });
    await finalReview(receiver, handover.id);

    // Un cambio de custodia posterior invalida los pasos finales; no fabrica una recepción.
    await markHandoverElements(receiver, { handoverId: handover.id, field: 'confirmed', marks: { [element.id]: false } });
    await expect(receiveHandover(receiver, { handoverId: handover.id })).rejects.toThrow(/custodia|revisión/i);
    expect(await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).toMatchObject({ status: 'ENVIADA', receivedAt: null });
    await markHandoverElements(receiver, { handoverId: handover.id, field: 'confirmed', marks: { [element.id]: true } });
    await finalReview(receiver, handover.id);
    const received = await receiveHandover(receiver, { handoverId: handover.id, observations: 'Relevo final verificado con datos ficticios.' });
    expect(received).toMatchObject({ status: HandoverStatus.RECIBIDA, toShiftId: null, receivedById: receiver.id, receiverSessionId: receiver.sessionId });
    expect((await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).receivedAt).not.toBeNull();
    expect(await prisma.shift.count()).toBe(1);
    expect(await prisma.shift.count({ where: { status: { not: ShiftStatus.CERRADO } } })).toBe(0);
    expect(await prisma.shiftAssignment.count()).toBe(1);
    expect(await getMyActiveShift(receiver.id)).toBeNull();
    expect(await prisma.cashCount.count({ where: { handoverId: handover.id, kind: 'CONFIRMADO', countedById: receiver.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: handover.id, action: 'TURNO_RECIBIR', userId: receiver.id, summary: { startsWith: 'Recepción final confirmada' } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: handover.id, action: 'TURNO_RECIBIR', userId: receiver.id, summary: { startsWith: 'Caja de relevo recibida' } } })).toBe(1);
    await expect(receiveHandover(receiver, { handoverId: handover.id })).rejects.toThrow(/ya fue recibida/i);
    expect(await prisma.auditLog.count({ where: { entityId: handover.id, action: 'TURNO_RECIBIR', summary: { startsWith: 'Recepción final confirmada' } } })).toBe(1);
    expect(await getMaintenanceState()).toMatchObject({ enabled: false, closure: { phase: 'CLOSING', backup: null } });
    await expect(assertMaintenanceAccess(sender)).resolves.toBeUndefined();
    await expect(assertMaintenanceAccess(sysadmin)).resolves.toBeUndefined();
    expect(await prisma.user.count({ where: { active: true, deletedAt: null } })).toBe(3);
  });

  it('requiere despedida activa, turno cerrado y una recepción reclamada por la persona real', async () => {
    const { handover } = await sentHandover({ closing: false });
    await expect(startFinalHandoverReception(receiver, { handoverId: handover.id })).rejects.toThrow(/sólo está disponible/i);
    await beginClosure();
    await expect(confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' })).rejects.toThrow();
    await expect(startFinalHandoverReception({ ...receiver, roleOperational: false }, { handoverId: handover.id })).rejects.toThrow();
    await expect(startFinalHandoverReception({ ...receiver, permissions: [] }, { handoverId: handover.id })).rejects.toThrow();
    await startFinalHandoverReception(receiver, { handoverId: handover.id });
    await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
    const beforeRetry = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } });
    const repeated = await startFinalHandoverReception(receiver, { handoverId: handover.id });
    expect(repeated.receiverBriefingReviewedAt).toEqual(beforeRetry.receiverBriefingReviewedAt);
    expect(repeated.receivedAt).toBeNull();
    await expect(startFinalHandoverReception(sender, { handoverId: handover.id })).rejects.toThrow(/Otra persona/i);
    await expect(confirmReceptionReviewStep(sender, { handoverId: handover.id, step: 'CUSTODY' })).rejects.toThrow();
    await expect(confirmReceptionReviewStep({ ...receiver, permissions: [] }, { handoverId: handover.id, step: 'CUSTODY' })).rejects.toThrow();
    const renewedSession = { ...receiver, sessionId: 'sesion-renovada-del-mismo-receptor' };
    await finalReview(renewedSession, handover.id);
    const received = await receiveHandover(renewedSession, { handoverId: handover.id });
    expect(received).toMatchObject({ toShiftId: null, receivedById: receiver.id, receiverSessionId: renewedSession.sessionId, status: 'RECIBIDA' });
    expect(await prisma.shift.count()).toBe(1);
  });

  it('bloquea las entradas existentes de apertura y cambio de participantes incluso para sysadmin', async () => {
    const shift = await openShiftAs(sender, { type: ShiftType.DIA });
    await addShiftMember(sender, { shiftId: shift.id, userId: receiver.id });
    const before = await prisma.shiftAssignment.findMany({ where: { shiftId: shift.id }, orderBy: { userId: 'asc' } });
    await beginClosure();
    for (const user of [sender, receiver, sysadmin]) {
      await expect(openShift(user, { type: ShiftType.NOCHE })).rejects.toThrow(/cierre definitivo/i);
      await expect(startReceptionShift(user, { handoverId: 'entrega-inexistente' })).rejects.toThrow(/cierre definitivo/i);
      await expect(addShiftMember(user, { shiftId: shift.id, userId: sysadmin.id })).rejects.toThrow(/cierre definitivo/i);
      await expect(removeShiftMember(user, { shiftId: shift.id, userId: receiver.id })).rejects.toThrow(/cierre definitivo/i);
      await expect(changeShiftType(user, { shiftId: shift.id, type: ShiftType.NOCHE })).rejects.toThrow(/cierre definitivo/i);
    }
    expect(await prisma.shift.count()).toBe(1);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).type).toBe(ShiftType.DIA);
    expect(await prisma.shiftAssignment.findMany({ where: { shiftId: shift.id }, orderBy: { userId: 'asc' } })).toEqual(before);
  });

  it('sysadmin recupera con motivo una recepción que no confirmó Caja ni custodia, conservando la autoría anterior', async () => {
    const { handover } = await sentHandover();
    await startFinalHandoverReception(receiver, { handoverId: handover.id });
    await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
    await expect(startFinalHandoverReception(sysadmin, { handoverId: handover.id })).rejects.toThrow(/Otra persona/i);
    const recoveryReason = 'Recuperación sintética autorizada antes de recibir bienes.';
    const claim = await startFinalHandoverReception(sysadmin, { handoverId: handover.id, recoveryReason });
    expect(claim).toMatchObject({ receivedById: sysadmin.id, receiverBriefingReviewedAt: null, receivedAt: null, toShiftId: null });
    const recoveryAudit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: handover.id, userId: sysadmin.id, reason: recoveryReason } });
    expect(recoveryAudit.before).toMatchObject({ receivedById: receiver.id });
    expect(recoveryAudit.after).toMatchObject({ receivedById: sysadmin.id, receivedAt: null });
    await expect(confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' })).rejects.toThrow();
    await confirmReceptionReviewStep(sysadmin, { handoverId: handover.id, step: 'BRIEFING' });
    await finalReview(sysadmin, handover.id);
    const received = await receiveHandover(sysadmin, { handoverId: handover.id });
    expect(received).toMatchObject({ receivedById: sysadmin.id, status: 'RECIBIDA', toShiftId: null });
    await expect(assertMaintenanceAccess(sysadmin)).resolves.toBeUndefined();
    expect(await prisma.shift.count()).toBe(1);
  });

  it('recuperar el sistema conserva al receptor final y le permite continuar por la recepción normal', async () => {
    const { handover, shift: outgoing } = await sentHandover();
    await startFinalHandoverReception(receiver, { handoverId: handover.id });
    await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
    await prisma.systemSetting.update({
      where: { key: MAINTENANCE_SETTING_KEY },
      data: { value: MAINTENANCE_DEFAULT, updatedById: sysadmin.id },
    });
    expect(await getMaintenanceState()).toMatchObject({ valid: true, enabled: false, closure: null });

    for (const other of [sender, sysadmin]) {
      await expect(startReceptionShift(other, { handoverId: handover.id, type: ShiftType.NOCHE })).rejects.toThrow(/Otra persona|receptor/i);
    }
    expect(await prisma.shift.count()).toBe(1);
    expect(await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).toMatchObject({ receivedById: receiver.id, receivedAt: null, toShiftId: null, status: 'ENVIADA' });

    const incoming = await startReceptionShift(receiver, { handoverId: handover.id, type: ShiftType.NOCHE });
    expect(incoming.id).not.toBe(outgoing.id);
    expect(incoming.status).toBe(ShiftStatus.INICIADO);
    expect(await prisma.shift.count()).toBe(2);
    expect(await prisma.cashCount.count({ where: { handoverId: handover.id } })).toBe(0);
    expect(await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).toMatchObject({ receivedById: receiver.id, receivedAt: null, toShiftId: incoming.id, status: 'ENVIADA' });
    await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
    await finalReview(receiver, handover.id);
    await receiveHandover(receiver, { handoverId: handover.id });
    expect(await prisma.shift.findUniqueOrThrow({ where: { id: incoming.id } })).toMatchObject({ status: ShiftStatus.ACTIVO });
    expect(await prisma.shift.findUniqueOrThrow({ where: { id: outgoing.id } })).toMatchObject({ status: ShiftStatus.CERRADO });
    expect(await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).toMatchObject({ receivedById: receiver.id, status: HandoverStatus.RECIBIDA, toShiftId: incoming.id });
  });

  it('no amplía el permiso de arqueo ni permite reasignar evidencia de Caja ya recibida', async () => {
    const { handover, quantities } = await sentHandover({ cash: true });
    await startFinalHandoverReception(receiver, { handoverId: handover.id });
    const withoutCashPermission = { ...receiver, permissions: receiver.permissions.filter(key => key !== 'cash.count_receive') };
    await expect(receiveShiftCash(withoutCashPermission, { handoverId: handover.id, quantities })).rejects.toThrow();
    expect(await prisma.cashCount.count({ where: { handoverId: handover.id, kind: 'CONFIRMADO' } })).toBe(0);
    await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
    await receiveShiftCash(receiver, { handoverId: handover.id, quantities });
    await expect(startFinalHandoverReception(sysadmin, { handoverId: handover.id, recoveryReason: 'Intento sintético después del recuento.' })).rejects.toThrow(/ya tiene Caja o custodia/i);
    expect(await prisma.cashCount.findUniqueOrThrow({ where: { handoverId_kind: { handoverId: handover.id, kind: 'CONFIRMADO' } } })).toMatchObject({ countedById: receiver.id });
    expect((await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).receivedById).toBe(receiver.id);
    await finalReview(receiver, handover.id);
    await receiveHandover(receiver, { handoverId: handover.id });
    expect(await prisma.shift.count()).toBe(1);
  });

  it('conserva una ausencia física y su revisión independiente sin inventar custodia ni sustituir al receptor', async () => {
    const { handover, element } = await sentHandover({ custody: true });
    if (!element) throw new Error('Falta la custodia sintética de la prueba.');
    await startFinalHandoverReception(receiver, { handoverId: handover.id });
    await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
    const currentElement = await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } });
    const missing = await reportHandoverElementMissing(receiver, { handoverId: handover.id, elementId: element.id, reason: 'Llave ficticia no recibida; queda pendiente su localización.', revision: currentElement.updatedAt.toISOString() });
    await expect(confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'CUSTODY' })).rejects.toThrow(/No recibido|recibiste/i);
    await expect(startFinalHandoverReception(sysadmin, { handoverId: handover.id, recoveryReason: 'Intento sintético después de declarar custodia.' })).rejects.toThrow(/ya tiene Caja o custodia/i);
    await approveHandoverElementException(sysadmin, { handoverId: handover.id, elementId: element.id, reason: 'Pendiente registrado para recuperación administrativa; no acredita posesión.', revision: missing.updatedAt.toISOString() });
    await finalReview(receiver, handover.id);
    await receiveHandover(receiver, { handoverId: handover.id });
    expect(await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } })).toMatchObject({ confirmed: false, missingReportedById: receiver.id, missingApprovedById: sysadmin.id });
    expect(await prisma.shift.count()).toBe(1);
    expect((await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).receivedById).toBe(receiver.id);
  });

  for (const successorStatus of [ShiftStatus.CERRADO, ShiftStatus.ANULADO]) {
    it(`completa el relevo histórico con sucesor ${successorStatus} sin cambiar su vínculo ni reactivar jornadas`, async () => {
      const withCash = successorStatus === ShiftStatus.ANULADO;
      const { handover, quantities, element } = await sentHandover({ closing: false, cash: withCash, custody: true });
      if (!element) throw new Error('Falta la custodia sintética de la prueba.');
      const successor = await startReceptionShift(receiver, { handoverId: handover.id, type: ShiftType.NOCHE });
      await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
      if (withCash) await receiveShiftCash(receiver, { handoverId: handover.id, quantities });
      await markHandoverElements(receiver, { handoverId: handover.id, field: 'confirmed', marks: { [element.id]: true } });
      const endedAt = new Date();
      // Fixture histórica local: la jornada receptora terminó sin confirmar el relevo anterior.
      await prisma.$transaction([
        prisma.shift.update({ where: { id: successor.id }, data: { status: successorStatus, actualEnd: endedAt } }),
        prisma.shiftAssignment.updateMany({ where: { shiftId: successor.id }, data: { leftAt: endedAt } }),
      ]);
      await beginClosure();

      for (const unrelated of [sender, sysadmin]) {
        await expect(startFinalHandoverReception(unrelated, { handoverId: handover.id })).rejects.toThrow(/no está disponible/i);
      }
      const adminAssignment = await prisma.shiftAssignment.create({ data: {
        shiftId: successor.id, userId: sysadmin.id, role: 'APOYO', leftAt: endedAt,
      } });
      await expect(startFinalHandoverReception(sysadmin, { handoverId: handover.id })).rejects.toThrow(/no está disponible/i);
      await prisma.shiftAssignment.update({ where: { id: adminAssignment.id }, data: { activatedAt: successor.actualStart, removedExplicitly: true } });
      await expect(startFinalHandoverReception(sysadmin, { handoverId: handover.id })).rejects.toThrow(/no está disponible/i);
      await prisma.shiftAssignment.update({ where: { id: adminAssignment.id }, data: { removedExplicitly: false } });
      await expect(startFinalHandoverReception(sysadmin, { handoverId: handover.id })).rejects.toThrow(withCash ? /otro receptor real/i : /autoría.*custodia/i);

      const cashBefore = await prisma.cashCount.findMany({ where: { handoverId: handover.id }, include: { lines: true }, orderBy: { kind: 'asc' } });
      const custodyBefore = await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } });
      const claim = await startFinalHandoverReception(receiver, { handoverId: handover.id });
      expect(claim).toMatchObject({ receivedById: receiver.id, receivedAt: null, toShiftId: successor.id, status: HandoverStatus.ENVIADA });
      await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
      await finalReview(receiver, handover.id);
      const received = await receiveHandover(receiver, { handoverId: handover.id });
      expect(received).toMatchObject({ receivedById: receiver.id, toShiftId: successor.id, status: HandoverStatus.RECIBIDA });
      expect((await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).receivedAt).not.toBeNull();
      expect(await prisma.shift.count()).toBe(2);
      expect(await prisma.shift.findUniqueOrThrow({ where: { id: successor.id } })).toMatchObject({ status: successorStatus, actualEnd: endedAt });
      expect(await prisma.shiftAssignment.count({ where: { activatedAt: { not: null }, leftAt: null } })).toBe(0);
      expect(await getMyActiveShift(receiver.id)).toBeNull();
      expect(await prisma.cashCount.findMany({ where: { handoverId: handover.id }, include: { lines: true }, orderBy: { kind: 'asc' } })).toEqual(cashBefore);
      expect(await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } })).toEqual(custodyBefore);
      expect(await prisma.auditLog.count({ where: { entityId: successor.id, action: 'TURNO_RECIBIR' } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { entityId: handover.id, action: 'TURNO_RECIBIR', summary: { startsWith: 'Recepción final confirmada' } } })).toBe(1);
    });
  }

  for (const evidence of ['ausente', 'otra persona'] as const) {
    it(`rechaza custodia histórica confirmada cuya auditoría más reciente pertenece a ${evidence}`, async () => {
      const { handover, element } = await sentHandover({ closing: false, custody: true });
      if (!element) throw new Error('Falta la custodia sintética de la prueba.');
      const successor = await startReceptionShift(receiver, { handoverId: handover.id, type: ShiftType.NOCHE });
      await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
      if (evidence === 'otra persona') {
        await markHandoverElements(receiver, { handoverId: handover.id, field: 'confirmed', marks: { [element.id]: true } });
        const prior = await prisma.auditLog.findFirstOrThrow({ where: { entityId: handover.id, action: 'EDITAR' }, orderBy: { createdAt: 'desc' } });
        // Evidencia histórica inconsistente sintética: no se atribuye a quien reclama.
        await prisma.auditLog.create({ data: {
          entity: 'ShiftHandover', entityId: handover.id, action: 'EDITAR', userId: sysadmin.id,
          summary: 'Confirmación histórica sintética de otra persona.',
          after: { field: 'confirmed', marks: { [element.id]: true } },
          createdAt: new Date(prior.createdAt.getTime() + 1),
        } });
      } else {
        // Fixture inconsistente sin auditoría: el servicio debe rechazarla, no reconstruir autoría.
        await prisma.handoverElement.update({ where: { id: element.id }, data: { confirmed: true } });
      }
      const endedAt = new Date();
      await prisma.$transaction([
        prisma.shift.update({ where: { id: successor.id }, data: { status: ShiftStatus.CERRADO, actualEnd: endedAt } }),
        prisma.shiftAssignment.updateMany({ where: { shiftId: successor.id }, data: { leftAt: endedAt } }),
      ]);
      await beginClosure();
      const originalCustody = await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } });
      await expect(startFinalHandoverReception(receiver, { handoverId: handover.id })).rejects.toThrow(/autoría.*custodia/i);
      expect(await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).toMatchObject({ receivedById: null, receivedAt: null, toShiftId: successor.id, status: HandoverStatus.ENVIADA });
      expect(await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } })).toEqual(originalCustody);
      expect(await prisma.shift.count()).toBe(2);
    });
  }

  it('mantiene la autoría de una ausencia declarada en el sucesor terminado y exige revisión independiente', async () => {
    const { handover, element } = await sentHandover({ closing: false, custody: true });
    if (!element) throw new Error('Falta la custodia sintética de la prueba.');
    const successor = await startReceptionShift(receiver, { handoverId: handover.id, type: ShiftType.NOCHE });
    await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
    const currentElement = await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } });
    const missing = await reportHandoverElementMissing(receiver, {
      handoverId: handover.id, elementId: element.id,
      reason: 'Elemento ficticio pendiente de localización desde el relevo histórico.',
      revision: currentElement.updatedAt.toISOString(),
    });
    const endedAt = new Date();
    await prisma.$transaction([
      prisma.shift.update({ where: { id: successor.id }, data: { status: ShiftStatus.CERRADO, actualEnd: endedAt } }),
      prisma.shiftAssignment.updateMany({ where: { shiftId: successor.id }, data: { leftAt: endedAt } }),
      prisma.shiftAssignment.create({ data: { shiftId: successor.id, userId: sysadmin.id, role: 'APOYO', activatedAt: successor.actualStart, leftAt: endedAt } }),
    ]);
    await beginClosure();
    await expect(startFinalHandoverReception(sysadmin, { handoverId: handover.id })).rejects.toThrow(/otro receptor real/i);
    await startFinalHandoverReception(receiver, { handoverId: handover.id });
    await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
    await expect(confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'CUSTODY' })).rejects.toThrow(/No recibido|recibiste/i);
    await approveHandoverElementException(sysadmin, {
      handoverId: handover.id, elementId: element.id,
      reason: 'Tratamiento administrativo ficticio revisado; el elemento sigue no recibido.',
      revision: missing.updatedAt.toISOString(),
    });
    await finalReview(receiver, handover.id);
    await receiveHandover(receiver, { handoverId: handover.id });
    expect(await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } })).toMatchObject({ confirmed: false, missingReportedById: receiver.id, missingApprovedById: sysadmin.id });
    expect(await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).toMatchObject({ receivedById: receiver.id, toShiftId: successor.id, status: HandoverStatus.RECIBIDA });
    expect(await prisma.shift.findUniqueOrThrow({ where: { id: successor.id } })).toMatchObject({ status: ShiftStatus.CERRADO, actualEnd: endedAt });
    expect(await prisma.shift.count()).toBe(2);
  });

  it('la base rechaza una ausencia sin autor y revierte juntos los cambios de custodia y jornada', async () => {
    const { handover, element } = await sentHandover({ closing: false, custody: true });
    if (!element) throw new Error('Falta la custodia sintética de la prueba.');
    const successor = await startReceptionShift(receiver, { handoverId: handover.id, type: ShiftType.NOCHE });
    await confirmReceptionReviewStep(receiver, { handoverId: handover.id, step: 'BRIEFING' });
    const originalCustody = await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } });
    const originalSuccessor = await prisma.shift.findUniqueOrThrow({ where: { id: successor.id } });
    const originalAssignments = await prisma.shiftAssignment.findMany({ where: { shiftId: successor.id }, orderBy: { userId: 'asc' } });
    const endedAt = new Date();
    // La restricción de verdad debe revertir también las escrituras previas de esta transacción sintética.
    await expect(prisma.$transaction([
      prisma.shift.update({ where: { id: successor.id }, data: { status: ShiftStatus.CERRADO, actualEnd: endedAt } }),
      prisma.shiftAssignment.updateMany({ where: { shiftId: successor.id }, data: { leftAt: endedAt } }),
      prisma.handoverElement.update({ where: { id: element.id }, data: {
        missingReason: 'Ausencia ficticia histórica sin una persona declarante verificable.',
        missingReportedAt: endedAt, missingReportedById: null,
      } }),
    ])).rejects.toThrow(/HandoverElement_missing_truth_check/);
    expect(await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } })).toEqual(originalCustody);
    expect(await prisma.shift.findUniqueOrThrow({ where: { id: successor.id } })).toEqual(originalSuccessor);
    expect(await prisma.shiftAssignment.findMany({ where: { shiftId: successor.id }, orderBy: { userId: 'asc' } })).toEqual(originalAssignments);
    await beginClosure();
    await expect(startFinalHandoverReception(receiver, { handoverId: handover.id })).rejects.toThrow(/no está disponible/i);
    expect(await prisma.handoverElement.findUniqueOrThrow({ where: { id: element.id } })).toEqual(originalCustody);
    expect(await prisma.shiftHandover.findUniqueOrThrow({ where: { id: handover.id } })).toMatchObject({ receivedById: null, receivedAt: null, toShiftId: successor.id, status: HandoverStatus.ENVIADA });
    expect(await prisma.shift.count()).toBe(2);
    expect(await getMyActiveShift(receiver.id)).toMatchObject({ id: successor.id, status: ShiftStatus.INICIADO });
  });
});
