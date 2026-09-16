import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  EntryType,
  GuaranteeStatus,
  HandoverLevel,
  Priority,
  ReservationStatus,
  Severity,
  ShiftType,
} from '@prisma/client';
import {
  ROLE_KEYS,
  createShift,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
  openShiftAs,
} from './helpers';
import { buildHandoverSnapshot } from '@/server/services/handover-snapshot';
import { runAlertEngine } from '@/server/services/alert-engine';
import { createEntry } from '@/server/services/entries';
import { createTask } from '@/server/services/tasks';
import { createFollowUp } from '@/server/services/followups';
import {
  prepareHandover,
  receiveHandover,
  sendHandover,
} from '@/server/services/shifts';
import type { CurrentUser } from '@/server/auth/current-user';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000);

describe('resumen automático de la entrega', () => {
  let user: CurrentUser;

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    user = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
  });

  it('agrupa cada asunto en su sección y lo clasifica por urgencia', async () => {
    await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Tarjeta rechazada en la 215',
      description: 'Pre-autorización rechazada; cargos bloqueados.',
      priority: Priority.CRITICA,
      severity: Severity.CRITICA,
      tags: [],
      requiresFollowUp: false,
    });
    await createEntry(user, {
      type: EntryType.MANTENIMIENTO,
      title: 'Filtración en el baño de la 107',
      description: 'Paños absorbentes colocados.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });
    await createEntry(user, {
      type: EntryType.HUESPED,
      title: 'Aniversario de bodas en la 402',
      description: 'Coordinar decoración y espumante.',
      priority: Priority.ALTA,
      tags: [],
      requiresFollowUp: false,
    });
    await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Ocupación proyectada del 78%',
      description: 'Catorce llegadas y nueve salidas.',
      priority: Priority.BAJA,
      tags: [],
      requiresFollowUp: false,
    });
    await createTask(user, {
      title: 'Confirmar traslado al aeropuerto',
      priority: Priority.ALTA,
      tags: [],
      checklist: [],
      dueAt: hoursAgo(2),
    });

    const snapshot = await buildHandoverSnapshot();
    const sections = new Set(snapshot.map((item) => item.section));

    expect(sections).toContain('Incidencias abiertas');
    expect(sections).toContain('Mantenimiento');
    expect(sections).toContain('Solicitudes de huéspedes');
    expect(sections).toContain('Novedades activas');
    expect(sections).toContain('Tareas pendientes');

    // La incidencia crítica y la tarea vencida son urgentes.
    const urgentes = snapshot.filter((item) => item.level === HandoverLevel.URGENTE);
    expect(urgentes.map((i) => i.title).join(' ')).toContain('Tarjeta rechazada');
    expect(urgentes.map((i) => i.title).join(' ')).toContain('Confirmar traslado');

    // La novedad informativa no se marca como urgente.
    const ocupacion = snapshot.find((item) => item.title.includes('Ocupación'));
    expect(ocupacion?.level).toBe(HandoverLevel.INFORMATIVO);
  });

  it('incluye cobros, garantías y reservas que requieren acción', async () => {
    const guest = await prisma.guestReference.create({
      data: { fullName: 'Andrés Bustamante', roomNumber: '215' },
    });
    await prisma.reservationReference.create({
      data: {
        code: 'RES-70001',
        guestId: guest.id,
        status: ReservationStatus.EN_CASA,
        guaranteeStatus: GuaranteeStatus.RECHAZADA,
        balanceDue: 184500,
        requiresAction: true,
        actionNote: 'Solicitar medio de pago alternativo.',
      },
    });

    const snapshot = await buildHandoverSnapshot();
    const sections = snapshot.map((item) => item.section);

    expect(sections).toContain('Cobros pendientes');
    expect(sections).toContain('Garantías pendientes');
    expect(sections).toContain('Reservas que requieren acción');

    const cobro = snapshot.find((item) => item.section === 'Cobros pendientes');
    expect(cobro?.level).toBe(HandoverLevel.URGENTE);
    expect(cobro?.title).toContain('184500');
  });

  it('no repite un asunto que ya aparece en otra sección', async () => {
    // Una tarea vencida genera alerta automática: la entrega debe mencionarla
    // una sola vez, en "Tareas pendientes", sin duplicarla en "Alertas".
    const task = await createTask(user, {
      title: 'Revisar comprobantes de caja',
      priority: Priority.MEDIA,
      tags: [],
      checklist: [],
      dueAt: hoursAgo(4),
    });
    const incident = await createEntry(user, {
      type: EntryType.INCIDENCIA,
      title: 'Corte de energía en el ala sur',
      description: 'Generador en funcionamiento.',
      priority: Priority.CRITICA,
      severity: Severity.CRITICA,
      tags: [],
      requiresFollowUp: false,
    });
    await runAlertEngine();

    const snapshot = await buildHandoverSnapshot();
    const alertItems = snapshot.filter((item) => item.section === 'Alertas activas');

    expect(alertItems.some((item) => item.title.includes('Revisar comprobantes'))).toBe(false);
    expect(alertItems.some((item) => item.title.includes('Corte de energía'))).toBe(false);

    // Y cada asunto sigue estando presente exactamente una vez.
    expect(snapshot.filter((item) => item.refId === task.id)).toHaveLength(1);
    expect(snapshot.filter((item) => item.refId === incident.id)).toHaveLength(1);
  });

  it('conserva las alertas que aportan información propia', async () => {
    await prisma.alert.create({
      data: {
        type: 'SALIDA_ANTICIPADA',
        level: 'ATENCION',
        title: 'Salida anticipada del grupo a las 06:00',
        message: 'Cuentas cerradas la noche anterior.',
        auto: false,
      },
    });

    const snapshot = await buildHandoverSnapshot();
    const alertItems = snapshot.filter((item) => item.section === 'Alertas activas');
    expect(alertItems.some((item) => item.title.includes('Salida anticipada'))).toBe(true);
  });

  it('incluye los seguimientos próximos y los vencidos', async () => {
    const entry = await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Registro con dos seguimientos',
      description: 'Uno vencido y otro próximo.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });
    await createFollowUp(user, {
      entryId: entry.id,
      action: 'Seguimiento vencido',
      scheduledAt: hoursAgo(6),
    });
    await createFollowUp(user, {
      entryId: entry.id,
      action: 'Seguimiento de mañana',
      scheduledAt: new Date(Date.now() + 6 * 3600_000),
    });
    await runAlertEngine();

    const snapshot = await buildHandoverSnapshot();
    const seguimientos = snapshot.filter((item) => item.section === 'Seguimientos próximos');

    expect(seguimientos).toHaveLength(2);
    const vencido = seguimientos.find((item) => item.title === 'Seguimiento vencido');
    expect(vencido?.level).toBe(HandoverLevel.URGENTE);
    expect(vencido?.detail).toContain('VENCIDO');
  });

  it('la entrega enviada guarda una fotografía inmutable de lo entregado', async () => {
    const shiftA = await createShift({ userId: user.id, type: ShiftType.DIA });
    const entry = await createEntry(user, {
      type: EntryType.NOVEDAD,
      title: 'Registro presente al momento de la entrega',
      description: 'Debe quedar en el snapshot aunque después cambie.',
      priority: Priority.MEDIA,
      tags: [],
      requiresFollowUp: false,
    });

    await openShiftAs(user, shiftA);
    await receiveHandover(user, { shiftId: shiftA.id });
    await prepareHandover(user, shiftA.id);
    const sent = await sendHandover(user, { shiftId: shiftA.id });

    const snapshot = sent.snapshot as {
      items: Array<{ title: string; refId: string | null }>;
      counts: Record<string, number>;
    };
    expect(snapshot.items.some((item) => item.refId === entry.id)).toBe(true);
    expect(Object.keys(snapshot.counts)).toEqual(['urgente', 'importante', 'informativo']);

    // Cambiar el registro después no altera lo ya entregado.
    await prisma.operationalEntry.update({
      where: { id: entry.id },
      data: { title: 'Título cambiado después de la entrega' },
    });

    const stored = await prisma.shiftHandover.findUniqueOrThrow({ where: { id: sent.id } });
    const storedSnapshot = stored.snapshot as { items: Array<{ title: string }> };
    expect(
      storedSnapshot.items.some((item) =>
        item.title.includes('Registro presente al momento de la entrega'),
      ),
    ).toBe(true);
  });

  it('el resumen queda vacío cuando no hay nada pendiente', async () => {
    const snapshot = await buildHandoverSnapshot();
    expect(snapshot).toHaveLength(0);
  });
});
