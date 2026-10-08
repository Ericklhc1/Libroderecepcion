import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * Antena operativa de una reserva.
 *
 * La reserva es el punto de encuentro entre los módulos, no una copia de ellos.
 * Cada módulo conserva su propia fuente de verdad y este lector sólo arma una
 * vista transversal para que Recepción pueda pasar de PMS a garantías, caja,
 * multas, libro, tareas, seguimientos, alertas y llaves sin perder el contexto.
 *
 * Nivel mínimo: la fotografía que entregó el informe de actividad vive en las
 * estadías (`guestCount`, importes, moneda, forma de pago, fechas, habitación y
 * estado PMS).
 *
 * Nivel máximo: se añaden los procesos operativos nacidos alrededor de esa
 * reserva, incluidos comentarios y responsables. No se persiste un resumen
 * duplicado: se calcula leyendo las fuentes originales para que no se desincronicen.
 */
export async function getReservationOperationalContext(id: string) {
  return prisma.reservationReference.findFirst({
    where: { id, deletedAt: null },
    include: {
      guest: true,
      guarantees: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: { select: { name: true } },
          returnedBy: { select: { name: true } },
        },
      },
      stays: {
        where: { deletedAt: null },
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          room: { select: { id: true, number: true } },
          keys: {
            select: {
              id: true,
              code: true,
              type: true,
              status: true,
              assignedAt: true,
              notes: true,
            },
          },
        },
      },
      fines: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          room: { select: { number: true } },
          createdBy: { select: { name: true } },
        },
      },
      cashMovements: {
        where: { voidedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { name: true } } },
      },
      entries: {
        where: { deletedAt: null },
        orderBy: { occurredAt: 'desc' },
        include: {
          room: { select: { number: true } },
          createdBy: { select: { name: true } },
          owner: { select: { name: true } },
          comments: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            include: { author: { select: { name: true } } },
          },
          tasks: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            include: {
              assignee: { select: { name: true } },
              comments: {
                where: { deletedAt: null },
                orderBy: { createdAt: 'asc' },
                include: { author: { select: { name: true } } },
              },
            },
          },
          followUps: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
            include: {
              owner: { select: { name: true } },
              createdBy: { select: { name: true } },
              comments: {
                where: { deletedAt: null },
                orderBy: { createdAt: 'asc' },
                include: { author: { select: { name: true } } },
              },
            },
          },
        },
      },
      alerts: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: {
          comments: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'asc' },
            include: { author: { select: { name: true } } },
          },
        },
      },
      gymPasses: true,
    },
  });
}

export async function getReservationOperationalContextByCode(code: string) {
  const reservation = await prisma.reservationReference.findFirst({
    where: { code, deletedAt: null },
    select: { id: true },
  });
  return reservation ? getReservationOperationalContext(reservation.id) : null;
}

export type ReservationOperationalContext = NonNullable<
  Awaited<ReturnType<typeof getReservationOperationalContext>>
>;

/**
 * Contadores que cualquier pantalla puede usar para anunciar qué otros módulos
 * conocen esta reserva. Esta es la parte "antena": no obliga a la interfaz a
 * entender las tablas internas de cada módulo.
 */
export function reservationModuleSignals(reservation: ReservationOperationalContext) {
  const comments =
    reservation.entries.reduce(
      (total, entry) =>
        total +
        entry.comments.length +
        entry.tasks.reduce((subtotal, task) => subtotal + task.comments.length, 0) +
        entry.followUps.reduce((subtotal, followUp) => subtotal + followUp.comments.length, 0),
      0,
    ) + reservation.alerts.reduce((total, alert) => total + alert.comments.length, 0);

  const tasks = reservation.entries.reduce((total, entry) => total + entry.tasks.length, 0);
  const followUps = reservation.entries.reduce((total, entry) => total + entry.followUps.length, 0);
  const keys = reservation.stays.reduce((total, stay) => total + stay.keys.length, 0);

  return {
    pms: reservation.stays.length,
    guarantees: reservation.guarantees.length,
    cash: reservation.cashMovements.length,
    fines: reservation.fines.length,
    book: reservation.entries.length,
    tasks,
    followUps,
    alerts: reservation.alerts.length,
    keys,
    gym: reservation.gymPasses.length,
    comments,
  };
}
