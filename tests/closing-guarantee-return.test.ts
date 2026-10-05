import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CurrentUser } from '@/server/auth/current-user';
import { createUser, openShiftAs, resetOperationalData, seedCatalog, ROLE_KEYS } from './helpers';
import { prepareHandover, receiveHandover } from '@/server/services/shifts';
import {
  assertReceptionCashGuaranteeReturn,
  assertReceptionOperationPermission,
  getReceptionOperationGate,
} from '@/server/services/reception-operation-gate';

describe('devolver garantía durante preparación de cierre', () => {
  let receptionist: CurrentUser;
  beforeAll(seedCatalog);
  beforeEach(async () => {
    await resetOperationalData();
    receptionist = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
  });

  async function startClosing() {
    const shift = await openShiftAs(receptionist, { type: 'DIA' });
    await receiveHandover(receptionist, { shiftId: shift.id });
    await prepareHandover(receptionist, shift.id);
    return shift;
  }

  it('mantiene bloqueado cash.guarantee_out genérico pero permite sólo la devolución física durante PREPARANDO_ENTREGA', async () => {
    await startClosing();
    expect(await getReceptionOperationGate(receptionist)).toMatchObject({
      mode: 'CLOSING',
      shiftStatus: 'PREPARANDO_ENTREGA',
    });
    await expect(assertReceptionOperationPermission(receptionist, 'cash.guarantee_out')).rejects.toThrow(/cierre/i);
    await expect(assertReceptionCashGuaranteeReturn(receptionist)).resolves.toBeUndefined();
  });

  it('sin turno no abre la excepción', async () => {
    await expect(assertReceptionCashGuaranteeReturn(receptionist)).rejects.toThrow(/iniciar tu turno/i);
  });

  it('la UI abre únicamente devolución y conserva una ruta de regreso al mismo cierre', () => {
    const gateUi = readFileSync('src/components/operational/reception-operation-gate.tsx', 'utf8');
    const caja = readFileSync('src/app/(app)/caja/page.tsx', 'utf8');
    const action = readFileSync('src/server/actions/live-cash.ts', 'utf8');
    const cashBox = readFileSync('src/components/operational/cash-box.tsx', 'utf8');
    const browser = readFileSync('scripts/ui/audit-cash-drafts-e2e.mjs', 'utf8');

    expect(gateUi).toContain("mode === 'CLOSING' && pathname === '/caja'");
    expect(caja).toContain("operationGate.shiftStatus === 'PREPARANDO_ENTREGA'");
    expect(caja).toContain('const canChargeGuarantee = canOperateCash');
    expect(caja).toContain('const canReturnGuarantee = (canOperateCash || canReturnDuringClosing)');
    expect(caja).toContain("returnCandidate.startsWith('/turno/entrega/')");
    expect(action.slice(action.indexOf('export async function returnCashGuaranteeAction'), action.indexOf('const chargeGuaranteeSchema'))).toContain('assertReceptionCashGuaranteeReturn(user)');
    expect(action.slice(action.indexOf('export async function chargeCashGuaranteeAction'))).toContain("requirePermission('cash.guarantee_out')");
    expect(cashBox).toContain('Devolver esta garantía en Caja');
    expect(browser).toContain('returnedGuaranteeDuringClosing:true');
    expect(browser).toContain('Charging a guarantee remains blocked during closing');
  });
});
