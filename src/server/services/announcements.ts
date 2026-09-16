import 'server-only';
import { AnnouncementScope, AuditAction } from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { recordAudit } from '@/server/audit';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Comunicados obligatorios.
 *
 * Bloquean la interfaz de quien no los ha confirmado. Tres reglas sostienen el
 * módulo, y las tres son deliberadas:
 *
 *   1. **La confirmación pide texto.** Un botón solo se pulsa sin leer. Lo que
 *      la persona escribe se guarda, así que después se sabe no sólo quién
 *      confirmó sino qué entendió.
 *   2. **Quien lo emite queda confirmado desde el principio.** Si no, el
 *      Supervisor se bloquearía a sí mismo con su propio aviso y no podría ni
 *      corregirlo.
 *   3. **El bloqueo se calcula, no se guarda.** Es «comunicados activos menos
 *      los que esta persona confirmó», y se resuelve al leer. Una lista de
 *      pendientes almacenada se desincroniza en cuanto alguien confirma.
 */

type Client = Prisma.TransactionClient | typeof prisma;

export type PendingAnnouncement = {
  id: string;
  title: string;
  body: string;
  scope: AnnouncementScope;
  createdByName: string;
  createdAt: Date;
  personal: boolean;
};

/**
 * Comunicados que bloquean a este usuario ahora mismo.
 *
 * Se consulta en cada carga del área con sesión, así que es UNA consulta con
 * índice: `active`, sin eliminar, sin expirar, dirigidos a todos o a esta
 * persona, y sin confirmación suya.
 */
export async function getBlockingAnnouncements(
  userId: string,
  client: Client = prisma,
): Promise<PendingAnnouncement[]> {
  const now = new Date();
  const rows = await client.announcement.findMany({
    where: {
      active: true,
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [
        {
          OR: [
            { scope: AnnouncementScope.TODOS },
            { scope: AnnouncementScope.USUARIO, targetUserId: userId },
          ],
        },
        // Sin confirmación de esta persona: es lo que define «pendiente».
        { reads: { none: { userId } } },
      ],
    },
    include: { createdBy: { select: { name: true } } },
    // Lo personal primero: es lo que se le dijo a él, no al mesón entero.
    orderBy: [{ scope: 'desc' }, { createdAt: 'asc' }],
    take: 20,
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    scope: row.scope,
    createdByName: row.createdBy.name,
    createdAt: row.createdAt,
    personal: row.scope === AnnouncementScope.USUARIO,
  }));
}

export async function createAnnouncement(
  user: CurrentUser,
  input: {
    title: string;
    body: string;
    scope: AnnouncementScope;
    targetUserId?: string | null;
    expiresAt?: Date | null;
  },
) {
  if (input.scope === AnnouncementScope.USUARIO && !input.targetUserId) {
    throw new RuleError('Un comunicado dirigido a una persona necesita a quién.');
  }
  if (input.scope === AnnouncementScope.TODOS && input.targetUserId) {
    throw new RuleError('Un comunicado para todos no puede tener destinatario.');
  }
  if (input.targetUserId) {
    const target = await prisma.user.findFirst({
      where: { id: input.targetUserId, deletedAt: null, active: true },
      select: { id: true },
    });
    if (!target) throw new NotFoundError('La persona indicada no existe o está inactiva.');
  }
  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    throw new RuleError('La fecha de caducidad ya pasó: el comunicado no bloquearía a nadie.');
  }

  const announcement = await prisma.$transaction(async (tx) => {
    const created = await tx.announcement.create({
      data: {
        title: input.title,
        body: input.body,
        scope: input.scope,
        targetUserId: input.targetUserId ?? null,
        expiresAt: input.expiresAt ?? null,
        createdById: user.id,
      },
    });

    /*
      Quien lo emite queda confirmado de entrada. Si no, se bloquearía a sí
      mismo con su propio aviso y no podría ni corregirlo.
    */
    await tx.announcementRead.create({
      data: {
        announcementId: created.id,
        userId: user.id,
        confirmationText: 'Emitido por esta persona.',
      },
    });

    return created;
  });

  await recordAudit({
    entity: 'Announcement',
    entityId: announcement.id,
    action: AuditAction.CREAR,
    user,
    summary:
      `Comunicado obligatorio «${input.title}» emitido ` +
      (input.scope === AnnouncementScope.TODOS ? 'a todo el personal' : 'a una persona'),
  });

  return announcement;
}

/** Confirma la lectura. El texto es obligatorio y se conserva. */
export async function confirmAnnouncement(
  user: CurrentUser,
  input: { announcementId: string; text: string },
) {
  const announcement = await prisma.announcement.findFirst({
    where: { id: input.announcementId, deletedAt: null },
    select: { id: true, title: true, scope: true, targetUserId: true },
  });
  if (!announcement) throw new NotFoundError('Ese comunicado no existe.');

  // Nadie confirma un comunicado que no le tocaba.
  if (
    announcement.scope === AnnouncementScope.USUARIO &&
    announcement.targetUserId !== user.id
  ) {
    throw new RuleError('Ese comunicado no está dirigido a ti.');
  }

  const text = input.text.trim();
  if (text.length < 3) {
    throw new RuleError('Escribe tu confirmación: qué entendiste o qué vas a hacer.');
  }

  /*
    Idempotente: confirmar dos veces no crea dos filas ni pisa la primera. La
    primera confirmación es la que vale, porque es la que ocurrió.
  */
  await prisma.announcementRead.upsert({
    where: {
      announcementId_userId: { announcementId: announcement.id, userId: user.id },
    },
    create: {
      announcementId: announcement.id,
      userId: user.id,
      confirmationText: text,
    },
    update: {},
  });

  await recordAudit({
    entity: 'Announcement',
    entityId: announcement.id,
    action: AuditAction.COMENTAR,
    user,
    summary: `Lectura confirmada del comunicado «${announcement.title}»: ${text}`,
  });
}

export type AnnouncementWithReads = {
  id: string;
  title: string;
  body: string;
  scope: AnnouncementScope;
  targetName: string | null;
  createdByName: string;
  createdAt: Date;
  expiresAt: Date | null;
  active: boolean;
  /** Cuántas personas debían confirmarlo y cuántas lo hicieron. */
  confirmed: number;
  expected: number;
  reads: Array<{ name: string; text: string; at: Date }>;
};

/**
 * Comunicados vivos con su avance de lectura, para el Supervisor.
 *
 * `expected` es el personal operativo activo, que es a quién bloquea de
 * verdad: el Administrador de sistema no opera el mesón y un comunicado para
 * todos no debería contarlo como moroso.
 */
export async function listAnnouncements(limit = 30): Promise<AnnouncementWithReads[]> {
  const [rows, operationalCount] = await Promise.all([
    prisma.announcement.findMany({
      where: { deletedAt: null },
      include: {
        createdBy: { select: { name: true } },
        targetUser: { select: { name: true } },
        reads: {
          include: { user: { select: { name: true } } },
          orderBy: { confirmedAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    prisma.user.count({
      where: { deletedAt: null, active: true, role: { operational: true } },
    }),
  ]);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    scope: row.scope,
    targetName: row.targetUser?.name ?? null,
    createdByName: row.createdBy.name,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    active: row.active,
    confirmed: row.reads.length,
    expected: row.scope === AnnouncementScope.USUARIO ? 1 : Math.max(operationalCount, 1),
    reads: row.reads.map((read) => ({
      name: read.user.name,
      text: read.confirmationText,
      at: read.confirmedAt,
    })),
  }));
}

/** Retira un comunicado: deja de bloquear, sin perder quién lo confirmó. */
export async function closeAnnouncement(
  user: CurrentUser,
  input: { announcementId: string; reason: string },
) {
  const announcement = await prisma.announcement.findFirst({
    where: { id: input.announcementId, deletedAt: null },
    select: { id: true, title: true, active: true },
  });
  if (!announcement) throw new NotFoundError('Ese comunicado no existe.');

  await prisma.announcement.update({
    where: { id: announcement.id },
    data: {
      active: false,
      deletedAt: new Date(),
      deletedById: user.id,
      deletionReason: input.reason,
    },
  });

  await recordAudit({
    entity: 'Announcement',
    entityId: announcement.id,
    action: AuditAction.ELIMINAR,
    user,
    summary: `Comunicado «${announcement.title}» retirado: ${input.reason}`,
  });
}
