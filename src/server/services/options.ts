import 'server-only';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, ENTRY_TYPE_LABEL, TASK_OPEN_STATUSES } from '@/domain/labels';
import { listOperationalUsers } from './users';

export type Option = { value: string; label: string };

export type FormOptions = {
  users: Option[];
  departments: Option[];
  guests: Option[];
  reservations: Option[];
  openEntries: Option[];
  openTasks: Option[];
};

/**
 * Opciones para los formularios operativos.
 *
 * La lista de personas excluye al Administrador de sistema por construcción
 * (ver `listOperationalUsers`), de modo que no puede quedar como responsable.
 */
export async function getFormOptions(): Promise<FormOptions> {
  const [users, departments, guests, reservations, entries, tasks] = await Promise.all([
    listOperationalUsers(),
    prisma.department.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.guestReference.findMany({
      where: { deletedAt: null },
      orderBy: { fullName: 'asc' },
      select: { id: true, fullName: true, roomNumber: true, vip: true },
      take: 200,
    }),
    prisma.reservationReference.findMany({
      where: { deletedAt: null },
      orderBy: { checkIn: 'desc' },
      select: { id: true, code: true, roomNumber: true, guest: { select: { fullName: true } } },
      take: 200,
    }),
    prisma.operationalEntry.findMany({
      where: { deletedAt: null, status: { in: ENTRY_OPEN_STATUSES } },
      orderBy: { occurredAt: 'desc' },
      select: { id: true, seq: true, title: true, type: true },
      take: 100,
    }),
    prisma.task.findMany({
      where: { deletedAt: null, status: { in: TASK_OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, seq: true, title: true },
      take: 100,
    }),
  ]);

  return {
    users: users.map((u) => ({ value: u.id, label: `${u.name} · ${u.role.name}` })),
    departments: departments.map((d) => ({ value: d.id, label: d.name })),
    guests: guests.map((g) => ({
      value: g.id,
      label: `${g.fullName}${g.roomNumber ? ` · hab. ${g.roomNumber}` : ''}${g.vip ? ' · VIP' : ''}`,
    })),
    reservations: reservations.map((r) => ({
      value: r.id,
      label: `${r.code}${r.guest ? ` · ${r.guest.fullName}` : ''}${r.roomNumber ? ` · hab. ${r.roomNumber}` : ''}`,
    })),
    openEntries: entries.map((e) => ({
      value: e.id,
      label: `#${e.seq} · ${ENTRY_TYPE_LABEL[e.type]} · ${e.title}`,
    })),
    openTasks: tasks.map((t) => ({ value: t.id, label: `T#${t.seq} · ${t.title}` })),
  };
}
