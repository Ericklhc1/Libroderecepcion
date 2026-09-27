import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EntryType,
  GuaranteeKind,
  GuaranteeState,
  OperationalMailStatus,
  Priority,
  Severity,
} from '@prisma/client';
import { createEntry } from '@/server/services/entries';
import { createGuarantee } from '@/server/services/guarantees';
import {
  SUPERVISION_BACKUP_EMAIL,
  queueOperationalMail,
} from '@/server/services/operational-mail';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';

describe('respaldo operativo por correo', () => {
  beforeAll(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  it('encola una novedad con detalle para Supervisión', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción correo',
    });

    const entry = await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Late checkout autorizado',
      description: 'Habitación 507 autorizada hasta las 14:00.',
      priority: Priority.MEDIA,
      tags: ['habitacion-507'],
      requiresFollowUp: false,
    });

    const row = await prisma.operationalMailOutbox.findUniqueOrThrow({
      where: { eventKey: `entry-created:${entry.id}` },
    });

    expect(row.status).toBe(OperationalMailStatus.PENDIENTE);
    expect(row.recipients).toEqual([SUPERVISION_BACKUP_EMAIL]);
    expect(row.subject).toContain('NOVEDAD');
    expect(row.text).toContain('Late checkout autorizado');
    expect(row.text).toContain('Habitación 507 autorizada hasta las 14:00.');
    expect(row.text).toContain(user.name);
  });

  it('encola una incidencia con gravedad y trazabilidad', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción incidente',
    });

    const entry = await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Falla de cerradura',
      description: 'La cerradura no responde.',
      priority: Priority.ALTA,
      severity: Severity.ALTA,
      impact: 'Huésped sin acceso normal.',
      immediateAction: 'Se entregó llave de respaldo.',
      tags: ['cerradura'],
      requiresFollowUp: true,
    });

    const row = await prisma.operationalMailOutbox.findUniqueOrThrow({
      where: { eventKey: `entry-created:${entry.id}` },
    });
    expect(row.subject).toContain('INCIDENCIA');
    expect(row.text).toContain('Gravedad: ALTA');
    expect(row.text).toContain('Huésped sin acceso normal.');
    expect(row.text).toContain('Se entregó llave de respaldo.');
  });

  it('encola el registro de una garantía con contexto operativo', async () => {
    const user = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Recepción garantía',
    });

    const guarantee = await createGuarantee(user, {
      kind: GuaranteeKind.EFECTIVO,
      amount: 80_000,
      currency: 'CLP',
      state: GuaranteeState.PENDIENTE,
      guestName: 'Huésped Prueba',
      roomNumber: '507',
      reference: 'GAR-TEST',
      notes: 'Depósito pendiente de activación.',
    });

    const row = await prisma.operationalMailOutbox.findUniqueOrThrow({
      where: { eventKey: `guarantee-created:${guarantee.id}` },
    });
    expect(row.recipients).toEqual([SUPERVISION_BACKUP_EMAIL]);
    expect(row.subject).toContain('GARANTÍA');
    expect(row.text).toContain('Huésped Prueba');
    expect(row.text).toContain('507');
    expect(row.text).toContain('80000');
  });

  it('eventKey hace idempotente la cola', async () => {
    await queueOperationalMail(prisma, {
      eventKey: 'test:idempotente',
      recipients: [SUPERVISION_BACKUP_EMAIL],
      subject: 'Primero',
      text: 'Primer cuerpo',
    });
    await queueOperationalMail(prisma, {
      eventKey: 'test:idempotente',
      recipients: [SUPERVISION_BACKUP_EMAIL],
      subject: 'Segundo',
      text: 'Segundo cuerpo',
    });

    expect(
      await prisma.operationalMailOutbox.count({ where: { eventKey: 'test:idempotente' } }),
    ).toBe(1);
    const row = await prisma.operationalMailOutbox.findUniqueOrThrow({
      where: { eventKey: 'test:idempotente' },
    });
    expect(row.subject).toBe('Primero');
  });
});
