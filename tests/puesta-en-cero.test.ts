import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { EntryType, Priority, ShiftType } from '@prisma/client';
import {
  RESET_PHRASE,
  getResetPreview,
  runFactoryReset,
} from '@/server/services/factory-reset';
import { openShift } from '@/server/services/shifts';
import { createEntry } from '@/server/services/entries';
import { RuleError } from '@/server/errors';
import {
  ROLE_KEYS,
  closeAllShifts,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';

/**
 * La puesta en cero: lo único del sistema que borra de verdad.
 *
 * En todo lo demás la eliminación es lógica y el administrador restaura. Esto
 * es un gesto de INSTALACIÓN —se ejecuta una vez, antes de que haya datos
 * reales— y por eso hay que probarlo con más cuidado que nada, no con menos:
 * un error acá no se deshace.
 *
 * Lo que se protege, en orden de gravedad:
 *
 * 1. **No borra sin la frase.** Un botón se pulsa por error; escribir no.
 * 2. **No borra el catálogo.** Habitaciones, llaves, roles y parámetros son la
 *    instalación del hotel: si se fueran, habría que instalar de nuevo.
 * 3. **No borra a quien lo ejecuta.** Si lo hiciera, el hotel se quedaría sin
 *    forma de entrar a su propio sistema, sin arreglo posible desde dentro.
 * 4. **Deja constancia.** Borra la auditoría de las pruebas, pero la entrada
 *    que cuenta esta misma operación sobrevive.
 */
describe('dejar el sistema en cero', () => {
  let admin: Awaited<ReturnType<typeof createUser>>;

  /** Deja datos operativos de varios tipos, como los que dejan las pruebas. */
  async function conDatosDePrueba() {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Camila Prueba',
    });

    const { shift } = await openShift(receptionist, { type: ShiftType.DIA });
    const room = await prisma.room.findFirstOrThrow({ where: { number: '404' } });
    await createEntry(receptionist, {
      type: EntryType.NOVEDAD,
      title: 'Novedad de prueba',
      description: 'Se escribió probando el sistema.',
      priority: Priority.MEDIA,
      roomId: room.id,
      tags: [],
      requiresFollowUp: false,
    });

    await prisma.guestReference.create({
      data: { fullName: 'Huésped De Prueba' },
    });

    return { receptionist, shift };
  }

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
    await closeAllShifts();
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Ana Sistema' });
  });

  /* ------------------------------ La frase ------------------------------ */

  it('sin la frase exacta no borra nada', async () => {
    await conDatosDePrueba();
    const antes = await getResetPreview();
    expect(antes.entries).toBeGreaterThan(0);

    for (const intento of ['', 'dejar en 0', 'BORRAR TODO', 'DEJAR EN CEROO']) {
      await expect(
        runFactoryReset(admin, {
          phrase: intento,
          scope: { includeStays: true, includeUsers: true },
        }),
      ).rejects.toThrow(RuleError);
    }

    // Nada se movió.
    const despues = await getResetPreview();
    expect(despues.entries).toBe(antes.entries);
    expect(despues.shifts).toBe(antes.shifts);
  });

  it('acepta la frase sin distinguir mayúsculas ni espacios de sobra', async () => {
    await conDatosDePrueba();
    await expect(
      runFactoryReset(admin, {
        phrase: '  dejar en cero  ',
        scope: { includeStays: true, includeUsers: false },
      }),
    ).resolves.toMatchObject({ total: expect.any(Number) });
  });

  /* ---------------------------- Lo que borra ---------------------------- */

  it('deja el libro operativo, los turnos y los huéspedes en cero', async () => {
    await conDatosDePrueba();

    const summary = await runFactoryReset(admin, {
      phrase: RESET_PHRASE,
      scope: { includeStays: true, includeUsers: true },
    });

    expect(summary.total).toBeGreaterThan(0);

    const despues = await getResetPreview();
    expect(despues.entries).toBe(0);
    expect(despues.tasks).toBe(0);
    expect(despues.followUps).toBe(0);
    expect(despues.alerts).toBe(0);
    expect(despues.shifts).toBe(0);
    expect(despues.handovers).toBe(0);
    expect(despues.guests).toBe(0);
    expect(despues.notifications).toBe(0);
  });

  /* --------------------------- Lo que conserva --------------------------- */

  /*
    El catálogo es la instalación del hotel. Si se fuera, «dejar en cero» se
    convertiría en «desinstalar», que no es lo que nadie pide.
  */
  it('conserva el catálogo: habitaciones, llaves, roles, áreas y parámetros', async () => {
    await conDatosDePrueba();

    const antes = {
      rooms: await prisma.room.count(),
      keys: await prisma.roomKey.count(),
      roles: await prisma.role.count(),
      permissions: await prisma.permission.count(),
      departments: await prisma.department.count(),
      denominations: await prisma.cashDenomination.count(),
    };
    expect(antes.rooms).toBeGreaterThan(0);
    expect(antes.keys).toBeGreaterThan(0);

    await runFactoryReset(admin, {
      phrase: RESET_PHRASE,
      scope: { includeStays: true, includeUsers: true },
    });

    expect(await prisma.room.count()).toBe(antes.rooms);
    expect(await prisma.roomKey.count()).toBe(antes.keys);
    expect(await prisma.role.count()).toBe(antes.roles);
    expect(await prisma.permission.count()).toBe(antes.permissions);
    expect(await prisma.department.count()).toBe(antes.departments);
    expect(await prisma.cashDenomination.count()).toBe(antes.denominations);
  });

  it('las llaves vuelven al inventario en lugar de borrarse', async () => {
    const { receptionist } = await conDatosDePrueba();

    // Se entrega una llave para que quede ligada a algo.
    const room = await prisma.room.findFirstOrThrow({ where: { number: '404' } });
    const key = await prisma.roomKey.findFirstOrThrow({ where: { roomId: room.id } });
    await prisma.roomKey.update({
      where: { id: key.id },
      data: { status: 'ASIGNADA', assignedAt: new Date(), assignedById: receptionist.id },
    });

    await runFactoryReset(admin, {
      phrase: RESET_PHRASE,
      scope: { includeStays: true, includeUsers: true },
    });

    const despues = await prisma.roomKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(despues.status).toBe('DISPONIBLE');
    expect(despues.stayId).toBeNull();
    expect(despues.assignedById).toBeNull();
    // Sigue siendo la misma llave, con su código: está numerada y cuesta dinero.
    expect(despues.code).toBe(key.code);
  });

  /*
    La prueba que impide el peor error posible: quedarse fuera del sistema.
  */
  it('NUNCA borra la cuenta que ejecuta la puesta en cero', async () => {
    await conDatosDePrueba();

    await runFactoryReset(admin, {
      phrase: RESET_PHRASE,
      scope: { includeStays: true, includeUsers: true },
    });

    const quedan = await prisma.user.findMany();
    expect(quedan).toHaveLength(1);
    expect(quedan[0]!.id).toBe(admin.id);
  });

  it('sin marcar «borrar cuentas», el equipo se conserva', async () => {
    await conDatosDePrueba();
    const antes = await prisma.user.count();
    expect(antes).toBeGreaterThan(1);

    await runFactoryReset(admin, {
      phrase: RESET_PHRASE,
      scope: { includeStays: true, includeUsers: false },
    });

    expect(await prisma.user.count()).toBe(antes);
  });

  it('conserva usuarios pero borra memoria, conversaciones y confirmaciones de Fronti', async () => {
    const receptionist = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción con memoria',
    });
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.ai_conversation.create({
      data: {
        id: 'conv-reset-fronti',
        user_id: receptionist.id,
        session_id: 'session-reset-fronti',
        expires_at: expiresAt,
      },
    });
    await prisma.ai_message.create({
      data: {
        id: 'msg-reset-fronti',
        conversation_id: 'conv-reset-fronti',
        role: 'user',
        content: 'dato de prueba que debe desaparecer',
        expires_at: expiresAt,
      },
    });
    await prisma.ai_memory.create({
      data: {
        id: 'mem-reset-fronti',
        user_id: receptionist.id,
        conversation_id: 'conv-reset-fronti',
        scope: 'PERSONAL',
        summary: 'memoria de prueba que debe desaparecer',
        expires_at: expiresAt,
      },
    });
    await prisma.assistantActionReceipt.create({
      data: {
        nonce: 'nonce-reset-fronti',
        userId: receptionist.id,
        action: 'create_reminder',
      },
    });

    const usersBefore = await prisma.user.count();

    await runFactoryReset(admin, {
      phrase: RESET_PHRASE,
      scope: { includeStays: true, includeUsers: false },
    });

    expect(await prisma.user.count()).toBe(usersBefore);
    expect(await prisma.ai_message.count()).toBe(0);
    expect(await prisma.ai_memory.count()).toBe(0);
    expect(await prisma.ai_conversation.count()).toBe(0);
    expect(await prisma.assistantActionReceipt.count()).toBe(0);
  });

  it('sin marcar «borrar estadías», el tablero de habitaciones se conserva', async () => {
    await conDatosDePrueba();
    const room = await prisma.room.findFirstOrThrow({ where: { number: '404' } });
    await prisma.roomStay.create({
      data: {
        room: { connect: { id: room.id } },
        reservationId: '9999999',
        guestNames: ['Huésped Que Sigue'],
        status: 'IN_HOUSE',
        stage: 'CONFIRMADO',
        businessDate: new Date(),
        sourceReport: 'IN_HOUSE',
      },
    });

    await runFactoryReset(admin, {
      phrase: RESET_PHRASE,
      scope: { includeStays: false, includeUsers: false },
    });

    expect(await prisma.roomStay.count()).toBe(1);
  });

  /* ---------------------------- La constancia ---------------------------- */

  it('borra la auditoría de las pruebas pero deja constancia de sí misma', async () => {
    await conDatosDePrueba();
    expect(await prisma.auditLog.count()).toBeGreaterThan(0);

    await runFactoryReset(admin, {
      phrase: RESET_PHRASE,
      scope: { includeStays: true, includeUsers: false },
    });

    const logs = await prisma.auditLog.findMany();
    // Exactamente una: la que cuenta esta operación.
    expect(logs).toHaveLength(1);
    expect(logs[0]!.summary).toContain('Sistema dejado en cero');
    expect(logs[0]!.userId).toBe(admin.id);
  });

  it('sobre un sistema ya en cero no falla: informa que no había nada', async () => {
    const summary = await runFactoryReset(admin, {
      phrase: RESET_PHRASE,
      scope: { includeStays: true, includeUsers: false },
    });
    // Puede haber borrado la auditoría de crear al admin, pero no revienta.
    expect(summary.total).toBeGreaterThanOrEqual(0);
    expect(summary.keptUser).toBe('Ana Sistema');
  });

  /* ------------------------------- El cierre ------------------------------ */

  it('sólo el Administrador de sistema puede ejecutarla', () => {
    /*
      La comprobación vive en la acción, que es la puerta real. Se verifica
      sobre el código porque el permiso `system.configure` lo podría tener otro
      rol si alguien lo ajustara a mano desde /admin/roles, y entonces el
      permiso solo no bastaría.
    */
    const source = readFileSync(
      'src/server/actions/factory-reset.ts',
      'utf-8',
    );
    expect(source).toContain("requirePermission('system.configure')");
    expect(source).toContain('user.isSystemAdmin');
  });
});
