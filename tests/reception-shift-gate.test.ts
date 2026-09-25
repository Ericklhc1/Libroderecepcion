import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Recepción · gate obligatorio de turno', () => {
  it('bloquea la operación fuera de un turno ACTIVO', () => {
    const source = readFileSync(
      'src/server/services/reception-operation-gate.ts',
      'utf8',
    );

    expect(source).toContain("mode: 'NO_SHIFT'");
    expect(source).toContain("mode: 'RECEIVING'");
    expect(source).toContain("mode: 'CLOSING'");
    expect(source).toContain("mode: 'ACTIVE'");
    expect(source).toContain("permission === 'shift.start'");
    expect(source).toContain("'shift.receive'");
    expect(source).toContain("'cash.count_receive'");
    expect(source).toContain("'shift.close'");
    expect(source).toContain('isReceptionDeskRole(user.roleKey)');
    expect(source).not.toContain("'shift.start',\n  'shift.receive'");
  });

  it('el guard de permisos aplica el gate también en acciones por propiedad', () => {
    const guard = readFileSync('src/server/auth/guard.ts', 'utf8');
    expect(guard.match(/assertReceptionOperationPermission/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
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

  it('el informe imprimible identifica saliente, entrante y validación posterior', () => {
    const source = readFileSync(
      'src/app/(app)/turno/entrega/[id]/page.tsx',
      'utf8',
    );

    expect(source).toContain('Informe de Caja · entrega/recepción');
    expect(source).toContain('Recepcionista saliente');
    expect(source).toContain('Recepcionista entrante');
    expect(source).toContain('Validación / auditoría de cierre');
    expect(source).toContain('Erick Herrera o auditor designado');
    expect(source).toContain('Imprimir informe Caja entrega/recepción');
  });
});

describe('Novedades · vista operativa limpia', () => {
  it('muestra sólo novedades/incidencias abiertas creadas por Recepción', () => {
    const service = readFileSync('src/server/services/book.ts', 'utf8');
    const page = readFileSync('src/app/(app)/libro/page.tsx', 'utf8');

    expect(service).toContain('receptionEntriesOnly');
    expect(service).toContain('EntryType.NOVEDAD, EntryType.INCIDENCIA');
    expect(service).toContain('RECEPTION_DESK_ROLE_KEYS');
    expect(service).toContain('key: { in: [...RECEPTION_DESK_ROLE_KEYS] }');
    expect(service).toContain("startsWith: 'shift-validation:'");
    expect(page).toContain('Sólo aparecen novedades e incidencias creadas por Recepción');
    expect(page).toContain('Ver historial');
  });
});
