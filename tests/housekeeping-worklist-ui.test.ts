import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/app/(app)/housekeeping/page.tsx', 'utf8');
describe('bandeja contextual de Housekeeping sobre contratos nativos', () => {
  it('muestra material asignado desde Inventario sin copiar existencias', () => {
    expect(page).toContain('listAssignedInventoryMaterial');
    expect(page).toContain('Material asignado');
    expect(page).toContain('Verlo no reserva ni descuenta existencias');
    expect(page).toContain('href="/inventario"');
  });

  it('conserva guardia y lector del área antes de proyectar filas', () => {
    expect(page).toContain('await requireHousekeepingPageUser()');
    expect(page).toContain('await getHkWorkday(user,');
    expect(page).toContain('board.requests.map(r =>');
    expect(page).toContain('initialOpenId={focusedRequest ? listRowAnchor(\'housekeeping\', focusedRequest.id) : undefined}');
    expect(page).toContain('scope={user.id}');
  });
  it('mantiene identidad, versión, capacidades e impedimento técnico sin estados simulados', () => {
    expect(page).toContain('WorkActionCluster id={r.id} humanId={r.humanId} version={r.version} status={r.status}');
    expect(page).toContain('HK_WORK_ACTIONS.filter(action => allowed(action, r.assignedToId))');
    expect(page).toContain('assignedToId!==user.id');
    expect(page).toContain('maintenanceAllowsContinuation(r.maintenanceEntry)');
    expect(page).toContain('waitingMaintenance={waitingMaintenance}');
    expect(page).toContain('housekeepingSourceChanged(r)');
  });
  it('conserva origen, resultados, legado, auditoría y enlaces históricos', () => {
    for (const contract of ['data-housekeeping-detail={r.id}', 'id={`aviso-${r.humanId}`}', 'id={`resultado-${r.humanId}`}', 'r.sourceEntry?.description??r.description', 'r.events.map', 'OrganizeLegacyForm', 'ReleasePilotSourceForm']) expect(page).toContain(contract);
    expect(page).toContain('detailHrefWithReturnContext(`/libro/${r.sourceEntry.id}`, `${currentListHref}#${rowId}`)');
    expect(page).toContain('fragmentTargets: [`aviso-${r.humanId}`, `resultado-${r.humanId}`]');
    expect(page).toContain('data-worklist-anchor={`aviso-${r.humanId}`} tabIndex={-1}');
    expect(page).toContain('detailHrefWithReturnContext(`/libro/${r.maintenanceEntry.id}`, `${currentListHref}#${rowId}`)');
  });
  it('preserva rutinas, disponibilidad, relevos y delegaciones nativas', () => {
    for (const component of ['PrepareDayForm', 'RoutineForm', 'AvailabilityForm', 'HandoverForm', 'ReceiveHandoverForm', 'AcceptHandoverForm', 'DelegationForm', 'RevokeDelegationForm']) expect(page).toContain('<' + component);
    expect(page).toContain('No finaliza Housekeeping ni modifica la disponibilidad comercial');
  });
});
