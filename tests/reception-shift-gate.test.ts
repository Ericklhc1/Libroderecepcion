import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Recepción · gate obligatorio de turno', () => {
  it('bloquea la operación fuera de un turno ACTIVO', () => {
    const source = readFileSync(
      'src/server/services/reception-operation-gate.ts',
      'utf8',
    );

    expect(source).toContain("mode: 'NO_SHIFT'");
    expect(source).toContain("mode: 'HANDOVER_PENDING'");
    expect(source).toContain("mode: 'RECEIVING'");
    expect(source).toContain("mode: 'CLOSING'");
    expect(source).toContain("mode: 'ACTIVE'");
    expect(source).toContain("permission === 'shift.start'");
    expect(source).toContain("'shift.receive'");
    expect(source).toContain("'cash.count_receive'");
    expect(source).toContain('HandoverStatus.ENVIADA');
    expect(source).toContain("gate.mode === 'HANDOVER_PENDING' || gate.mode === 'RECEIVING'");
    expect(source).toContain("'shift.close'");
    expect(source).toContain('isReceptionDeskRole(user.roleKey)');
    expect(source).not.toContain("'shift.start',\n  'shift.receive'");
  });

  it('ofrece la entrega cerrada aunque el mismo usuario continúe en el turno siguiente', () => {
    const source = readFileSync(
      'src/server/services/reception-operation-gate.ts',
      'utf8',
    );

    expect(source).not.toContain('none: { userId: user.id }');
    expect(source).toContain('La participación');
    expect(source).toContain('anterior ya terminó con el cierre');
  });

  it('el gate reconoce la misma entrega que la pantalla permite recibir', () => {
    const gate = readFileSync(
      'src/server/services/reception-operation-gate.ts',
      'utf8',
    );
    const pendingStart = gate.indexOf('const pendingHandover');
    const pendingEnd = gate.indexOf('if (pendingHandover)', pendingStart);
    const pendingQuery = gate.slice(pendingStart, pendingEnd);

    expect(pendingQuery).toContain('status: HandoverStatus.ENVIADA');
    expect(pendingQuery).toContain('receivedAt: null');
    expect(pendingQuery).toContain('toShiftId: null');
    expect(pendingQuery).toContain('status: ShiftStatus.CERRADO');
    expect(pendingQuery).not.toContain('archivedAt: null');
    expect(gate).toContain('handoverId: pendingHandover.id');
  });

  it('durante el relevo muestra el recorrido de cinco pasos y dirige al recuento correcto', () => {
    const gateUi = readFileSync(
      'src/components/operational/reception-operation-gate.tsx',
      'utf8',
    );
    const handover = readFileSync(
      'src/app/(app)/turno/entrega/[id]/page.tsx',
      'utf8',
    );
    const cashBox = readFileSync(
      'src/components/operational/cash-box.tsx',
      'utf8',
    );

    expect(gateUi).toContain('#recuento-caja');
    expect(gateUi).toContain('no en la Caja general');
    expect(handover).toContain('Recepción de turno · paso');
    expect(handover).toContain("['1', 'Entrega']");
    expect(handover).toContain("['2', 'Caja']");
    expect(handover).toContain("['3', 'Custodia']");
    expect(handover).toContain("['4', 'Revisión']");
    expect(handover).toContain("['5', 'Activar']");
    expect(handover).toContain('id="confirmar-recepcion"');
    expect(cashBox).toContain("'recuento-caja'");
    expect(cashBox).not.toContain('ReturnCashGuaranteeForm');
  });

  it('el cierre saliente guía una pantalla a la vez y confirma cancelación/envío', () => {
    const page = readFileSync('src/app/(app)/turno/entrega/[id]/page.tsx', 'utf8');
    const actions = readFileSync('src/components/operational/shift-actions.tsx', 'utf8');

    expect(page).toContain('Cierre guiado · paso');
    expect(page).toContain("query.paso ?? '1'");
    expect(page).toContain('Caja y custodia');
    expect(page).toContain('Pendientes');
    expect(page).toContain('Revisión final');
    expect(page).toContain('Enviar entrega');
    expect(page).toContain('SIGUIENTE →');
    expect(page).toContain('← ANTERIOR');
    expect(actions).toContain('¿Estás seguro/a de que quieres cancelar el cierre?');
    expect(actions).toContain('¿Estás seguro/a de que quieres enviar la entrega?');
    expect(actions).toContain('Ningún ingreso, egreso, garantía, devolución o transferencia ya realizada será borrado.');
  });

  it('permite iniciar la recepción con shift.receive sin habilitar un turno ACTIVO por atajo', () => {
    const source = readFileSync(
      'src/server/services/reception-operation-gate.ts',
      'utf8',
    );

    const pendingBranch = source.slice(
      source.indexOf("if (gate.mode === 'HANDOVER_PENDING'"),
      source.indexOf("if (CLOSING_PERMISSIONS.has(permission))"),
    );

    expect(pendingBranch).toContain('RECEIVE_ONLY_PERMISSIONS.has(permission)');
    expect(pendingBranch).not.toContain("permission === 'shift.start'");

    const shifts = readFileSync('src/server/services/shifts.ts', 'utf8');
    expect(shifts).toContain('export async function startReceptionShift');
    expect(shifts).toContain('status: ShiftStatus.INICIADO');
    expect(shifts).toContain('receiverFinalReviewAt');
    expect(shifts).toContain('data: { status: ShiftStatus.ACTIVO }');
  });

  it('el guard de permisos aplica el gate también en acciones por propiedad', () => {
    const guard = readFileSync('src/server/auth/guard.ts', 'utf8');
    expect(guard.match(/assertReceptionOperationPermission/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('el cierre usa shift.close y no vuelve a bloquear al dueño con shift.manage', () => {
    const actions = readFileSync('src/server/actions/shifts.ts', 'utf8');
    const start = actions.indexOf('export async function closeShiftAction');
    const end = actions.indexOf('const handoverNoteSchema', start);
    const closeAction = actions.slice(start, end);

    expect(closeAction).toContain("requirePermissionOrOwner('shift.close'");
    expect(closeAction).not.toContain("requirePermissionOrOwner('shift.manage'");

    const form = readFileSync('src/components/ui/form.tsx', 'utf8');
    expect(form).toContain('onError?: (state: Extract<ActionState, { ok: false }>) => void');
  });

  it('el cierre mantiene formulario y error dentro del diálogo al rechazar', () => {
    const shiftActions = readFileSync('src/components/operational/shift-actions.tsx', 'utf8');
    const closeForm = shiftActions.slice(
      shiftActions.indexOf('export function CloseShiftForm'),
      shiftActions.indexOf('export function CancelPreparationForm'),
    );
    const dialog = readFileSync('src/components/operational/shift-action-dialog.tsx', 'utf8');
    const form = readFileSync('src/components/ui/form.tsx', 'utf8');

    expect(closeForm).toContain('<ShiftActionDialog');
    expect(closeForm).toContain('useShiftReturnNavigation(closeShiftAction, shiftId)');
    expect(closeForm).toContain('action={closeShift}');
    expect(closeForm).not.toContain('onError={() => setOpen(false)}');
    expect(dialog.indexOf('<ActionForm')).toBeGreaterThan(dialog.indexOf('<Dialog'));
    expect(dialog.indexOf('</ActionForm>')).toBeLessThan(dialog.indexOf('</Dialog>'));
    expect(dialog).toContain('onSubmitCapture=');
    expect(dialog).toContain('event.preventDefault()');
    expect(dialog).toContain('submittedRef.current = false');
    expect(form).toContain('role="alert"');
    // scripts/ui/shift-dialog-repro.cjs verifica rechazo, foco y error interno
    // con el renderer real, además de este contrato de composición.
  });

  it('las acciones operativas con guard propio también pasan por el gate', () => {
    const keyInventory = readFileSync('src/server/actions/key-inventory.ts', 'utf8');
    const comments = readFileSync('src/server/actions/comments.ts', 'utf8');
    const bookMail = readFileSync('src/server/actions/book-mail.ts', 'utf8');

    expect(keyInventory).toContain(
      "await assertReceptionOperationPermission(user, 'key.inventory')",
    );
    expect(comments.match(/assertReceptionOperationPermission/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(bookMail).toContain(
      "await assertReceptionOperationPermission(user, 'entry.edit')",
    );
  });

  it('Fronti no puede saltarse el gate operativo', () => {
    const source = readFileSync('src/server/ai/reception-assistant.ts', 'utf8');
    expect(source).toContain('getReceptionOperationGate(user)');
    expect(source).toContain('isReceptionDeskRole(user.roleKey)');
    expect(source).toContain('await assertReceptionOperationPermission(user, pendingPermission)');
    expect(source).toContain('Completa Caja, entrega y cierre');
  });
});

describe('Recepción · relevo secuencial', () => {
  it('enviar la entrega no termina la participación del saliente', () => {
    const source = readFileSync('src/server/services/shifts.ts', 'utf8');
    const sendStart = source.indexOf('export async function sendHandover');
    const closeStart = source.indexOf('export async function closeShift', sendStart);
    const send = source.slice(sendStart, closeStart);

    expect(send).not.toContain('await endShiftParticipation');
    expect(send).toContain('ENTREGA_ENVIADA');
    expect(source).toContain('El turno saliente todavía no está cerrado');
  });

  it('el informe imprimible identifica saliente, receptor y validación posterior', () => {
    const source = readFileSync(
      'src/app/(app)/turno/entrega/[id]/page.tsx',
      'utf8',
    );

    expect(source).toContain('Informe de Caja · entrega/recepción');
    expect(source).toContain('Recepcionista saliente');
    expect(source).toContain('Receptor de la entrega');
    expect(source).toContain('Validación / auditoría de cierre');
    expect(source).toContain('Supervisión / Administrador de sistema');
    expect(source).not.toContain('Erick Herrera o auditor designado');
    expect(source).toContain('Imprimir informe de turno');
  });
});

describe('Novedades · vista operativa limpia', () => {
  it('muestra novedades/incidencias abiertas sin excluir al Supervisor por autor', () => {
    const service = readFileSync('src/server/services/book.ts', 'utf8');
    const page = readFileSync('src/app/(app)/libro/page.tsx', 'utf8');

    expect(service).toContain('receptionEntriesOnly');
    expect(service).toContain('EntryType.NOVEDAD, EntryType.INCIDENCIA');
    expect(service).not.toContain('key: { in: [...RECEPTION_DESK_ROLE_KEYS] }');
    expect(service).toContain('status: { in: ENTRY_OPEN_STATUSES }');
    expect(service).toContain("startsWith: 'shift-validation:'");
    expect(page).toContain('Aparecen novedades e incidencias que siguen en gestión');
    expect(page).toContain('Ver historial');
  });
});
