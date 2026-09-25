import 'server-only';

import {
  FollowUpStatus,
  SupervisionVisibility,
} from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import { LIVE_ALERT_WHERE } from '@/server/services/alert-engine';
import { getShiftDesk } from '@/server/services/shifts';
import { listOpenGuarantees } from '@/server/services/guarantees';
import { getSupervisionData } from '@/server/services/supervision';
import { getSupervisionCenterSummary } from '@/server/services/supervision-center';
import { listOperationalUsers } from '@/server/services/users';
import { getAllSettings } from '@/server/services/settings';

const READ_TOOL_NAMES = new Set([
  'consultar_turnos',
  'consultar_novedades',
  'consultar_garantias',
  'consultar_tareas',
  'consultar_seguimientos',
  'consultar_supervision',
  'consultar_alertas',
  'consultar_auditoria',
  'consultar_usuarios',
  'consultar_configuracion_operativa',
]);

function hasPermission(user: CurrentUser, permission: string): boolean {
  return user.permissions.some((value) => value === permission);
}

function hasAnyPermission(user: CurrentUser, permissions: string[]): boolean {
  return permissions.some((permission) => hasPermission(user, permission));
}

function requireAnyPermission(
  user: CurrentUser,
  permissions: string[],
  message: string,
): void {
  if (!hasAnyPermission(user, permissions)) throw new Error(message);
}

function limitArg(
  args: Record<string, unknown>,
  key = 'limit',
  fallback = 20,
  max = 50,
): number {
  const requested = Number(args[key] ?? fallback);
  return Number.isFinite(requested)
    ? Math.min(max, Math.max(1, Math.round(requested)))
    : fallback;
}

async function shiftsTool(user: CurrentUser) {
  requireAnyPermission(
    user,
    ['shift.start', 'shift.receive', 'shift.handover', 'shift.close', 'shift.manage', 'metrics.view'],
    'No tienes permiso para consultar turnos.',
  );
  const desk = await getShiftDesk(user);

  const compactShift = (shift: typeof desk.current) =>
    shift
      ? {
          id: shift.id,
          date: shift.date,
          type: shift.type,
          status: shift.status,
          plannedStart: shift.plannedStart,
          plannedEnd: shift.plannedEnd,
          actualStart: shift.actualStart,
          actualEnd: shift.actualEnd,
          members: shift.assignments.map((assignment) => ({
            name: assignment.user.name,
            username: assignment.user.username,
            role: assignment.role,
            active: Boolean(assignment.activatedAt && !assignment.leftAt),
          })),
        }
      : null;

  return {
    current: compactShift(desk.current),
    iAmIn: desk.iAmIn,
    suggestedType: desk.suggestedType,
    suggestedWindow: desk.suggestedWindow,
    awaitingReceipt: desk.awaitingReceipt.map((shift) => compactShift(shift)),
    pendingHandover: desk.pending
      ? {
          id: desk.pending.id,
          fromShiftId: desk.pending.fromShiftId,
          issuedAt: desk.pending.issuedAt,
          issuedBy: desk.pending.issuedBy.name,
          itemCount: desk.pending.items.length,
        }
      : null,
    cashPending: desk.cashPending
      ? {
          id: desk.cashPending.id,
          fromShiftId: desk.cashPending.fromShiftId,
          issuedBy: desk.cashPending.issuedBy.name,
        }
      : null,
  };
}

async function entriesTool(user: CurrentUser, args: Record<string, unknown>) {
  requireAnyPermission(
    user,
    ['entry.create', 'entry.edit', 'entry.close', 'metrics.view', 'supervision.view'],
    'No tienes permiso para consultar el Libro operativo.',
  );
  const limit = limitArg(args);
  const onlyOpen = args.onlyOpen !== false;
  const rows = await prisma.operationalEntry.findMany({
    where: {
      deletedAt: null,
      ...(onlyOpen ? { status: { in: ENTRY_OPEN_STATUSES } } : {}),
    },
    select: {
      id: true,
      seq: true,
      type: true,
      title: true,
      description: true,
      category: true,
      priority: true,
      severity: true,
      status: true,
      occurredAt: true,
      dueAt: true,
      requiresFollowUp: true,
      room: { select: { number: true } },
      owner: { select: { name: true, username: true } },
      department: { select: { name: true } },
    },
    orderBy: [{ priority: 'desc' }, { occurredAt: 'desc' }],
    take: limit,
  });

  return {
    onlyOpen,
    items: rows.map((row) => ({
      ...row,
      ref: `#${row.seq}`,
      room: row.room?.number ?? null,
      owner: row.owner
        ? { name: row.owner.name, username: row.owner.username }
        : null,
      department: row.department?.name ?? null,
    })),
  };
}

async function guaranteesTool(user: CurrentUser, args: Record<string, unknown>) {
  requireAnyPermission(
    user,
    ['cash.view', 'cash.guarantee_in', 'cash.guarantee_out', 'room.view'],
    'No tienes permiso para consultar garantías.',
  );
  const limit = limitArg(args);
  const guarantees = await listOpenGuarantees(limit);

  return {
    items: guarantees.map((row) => ({
      id: row.id,
      reference: row.reference,
      roomNumber: row.roomNumber,
      guestName: row.guestName,
      kind: row.kind,
      state: row.state,
      amount: Number(row.amount),
      appliedAmount: Number(row.appliedAmount ?? 0),
      penaltyAmount: Number(row.penaltyAmount ?? 0),
      currency: row.currency,
      dueAt: row.dueAt,
      notes: row.notes,
      createdAt: row.createdAt,
    })),
  };
}

async function tasksTool(user: CurrentUser, args: Record<string, unknown>) {
  requireAnyPermission(
    user,
    ['task.create', 'task.assign', 'task.edit', 'task.close', 'metrics.view'],
    'No tienes permiso para consultar tareas.',
  );
  const limit = limitArg(args);
  const requestedScope = args.scope === 'mias' ? 'mias' : 'abiertas';
  const canSeeAll =
    hasAnyPermission(user, ['task.assign', 'metrics.view']) || user.isSystemAdmin;
  const scope = requestedScope === 'abiertas' && canSeeAll ? 'abiertas' : 'mias';

  const rows = await prisma.task.findMany({
    where: {
      deletedAt: null,
      status: { in: TASK_OPEN_STATUSES },
      ...(scope === 'mias'
        ? {
            OR: [
              { assigneeId: user.id },
              { participants: { some: { userId: user.id, removedAt: null } } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      seq: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      dueAt: true,
      blockedReason: true,
      targetType: true,
      assignee: { select: { name: true, username: true } },
      department: { select: { name: true } },
      entry: { select: { id: true, seq: true, title: true } },
      room: { select: { number: true } },
      participants: {
        where: { removedAt: null },
        select: { role: true, user: { select: { name: true, username: true } } },
      },
    },
    orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return {
    scope,
    items: rows.map((row) => ({
      ...row,
      ref: `T#${row.seq}`,
      room: row.room?.number ?? null,
      department: row.department?.name ?? null,
      assignee: row.assignee
        ? { name: row.assignee.name, username: row.assignee.username }
        : null,
    })),
  };
}

async function followUpsTool(user: CurrentUser, args: Record<string, unknown>) {
  requireAnyPermission(
    user,
    ['followup.create', 'followup.manage', 'metrics.view'],
    'No tienes permiso para consultar seguimientos.',
  );
  const limit = limitArg(args);
  const onlyOpen = args.onlyOpen !== false;
  const canSeeSupervision = hasAnyPermission(user, [
    'supervision.view',
    'supervision.center.view',
    'supervision.followup.manage',
  ]);

  const visibility = canSeeSupervision
    ? {
        OR: [
          { visibility: SupervisionVisibility.OPERATIVO },
          { visibility: SupervisionVisibility.SUPERVISION },
          { visibility: SupervisionVisibility.PRIVADO, createdById: user.id },
          { visibility: SupervisionVisibility.PRIVADO, ownerId: user.id },
        ],
      }
    : {
        OR: [
          { visibility: SupervisionVisibility.OPERATIVO },
          { visibility: SupervisionVisibility.PRIVADO, createdById: user.id },
          { visibility: SupervisionVisibility.PRIVADO, ownerId: user.id },
        ],
      };

  const rows = await prisma.followUp.findMany({
    where: {
      deletedAt: null,
      ...(onlyOpen
        ? { status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] } }
        : {}),
      ...visibility,
    },
    select: {
      id: true,
      action: true,
      description: true,
      status: true,
      priority: true,
      visibility: true,
      scheduledAt: true,
      nextAction: true,
      result: true,
      owner: { select: { name: true, username: true } },
      entry: { select: { id: true, seq: true, title: true } },
      task: { select: { id: true, seq: true, title: true } },
    },
    orderBy: [{ scheduledAt: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  return { onlyOpen, items: rows };
}

async function supervisionTool(user: CurrentUser) {
  if (hasPermission(user, 'supervision.center.view')) {
    const data = await getSupervisionCenterSummary(user);
    return {
      mode: 'center',
      currentShift: data.currentShift,
      lastClosedShift: data.lastClosedShift,
      sinceLastShift: data.sinceLastShift,
      changesSinceLastShift: data.changesSinceLastShift,
      myTasks: data.myTasks,
      myFollowUps: data.myFollowUps,
      tasks: data.tasks,
      followUps: data.followUps,
      notes: data.notes,
      audits: data.audits,
      measures: data.measures,
    };
  }

  requireAnyPermission(
    user,
    ['supervision.view'],
    'No tienes permiso para consultar Supervisión.',
  );
  const data = await getSupervisionData();
  return {
    mode: 'overview',
    generatedAt: data.now,
    total: data.total,
    blocks: data.blocks,
  };
}

async function alertsTool(user: CurrentUser, args: Record<string, unknown>) {
  requireAnyPermission(
    user,
    ['alert.manage', 'metrics.view'],
    'No tienes permiso para consultar alertas.',
  );
  const limit = limitArg(args);
  const now = new Date();
  const rows = await prisma.alert.findMany({
    where: LIVE_ALERT_WHERE(now),
    select: {
      id: true,
      type: true,
      level: true,
      title: true,
      message: true,
      status: true,
      dueAt: true,
      snoozedUntil: true,
      auto: true,
      createdAt: true,
      entry: { select: { id: true, seq: true, title: true } },
      task: { select: { id: true, seq: true, title: true } },
      followUp: { select: { id: true, action: true } },
      department: { select: { name: true } },
    },
    orderBy: [{ level: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });
  return { generatedAt: now, items: rows };
}

async function auditTool(user: CurrentUser, args: Record<string, unknown>) {
  if (!hasPermission(user, 'audit.view')) {
    throw new Error('No tienes permiso para consultar Auditoría.');
  }
  const limit = limitArg(args, 'limit', 20, 50);
  const entity =
    typeof args.entity === 'string' && args.entity.trim()
      ? args.entity.trim().slice(0, 100)
      : null;

  const rows = await prisma.auditLog.findMany({
    where: entity ? { entity } : {},
    select: {
      id: true,
      entity: true,
      entityId: true,
      action: true,
      summary: true,
      reason: true,
      createdAt: true,
      user: { select: { name: true, username: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  return { entity, items: rows };
}

async function usersTool(user: CurrentUser, args: Record<string, unknown>) {
  requireAnyPermission(
    user,
    ['user.manage', 'task.assign', 'shift.manage'],
    'No tienes permiso para consultar usuarios operativos.',
  );

  const includeInactive = args.includeInactive === true && hasPermission(user, 'user.manage');
  if (!includeInactive) {
    return {
      scope: 'operational-active',
      items: await listOperationalUsers(),
    };
  }

  const rows = await prisma.user.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      username: true,
      active: true,
      role: { select: { key: true, name: true, operational: true } },
      department: { select: { name: true } },
      lastLoginAt: true,
    },
    orderBy: [{ role: { level: 'desc' } }, { name: 'asc' }],
  });
  return { scope: 'all', items: rows };
}

async function settingsTool(user: CurrentUser, args: Record<string, unknown>) {
  if (!hasPermission(user, 'system.configure')) {
    throw new Error('No tienes permiso para consultar la configuración técnica del sistema.');
  }
  const category =
    typeof args.category === 'string' && args.category.trim()
      ? args.category.trim().toLocaleLowerCase('es-CL')
      : null;
  const settings = await getAllSettings();

  return {
    category,
    items: settings
      .filter((setting) => !category || setting.category.toLocaleLowerCase('es-CL') === category)
      .map((setting) => ({
        key: setting.key,
        category: setting.category,
        value: setting.value,
        description: setting.description,
        overridden: setting.overridden,
        updatedAt: setting.updatedAt,
      })),
    note:
      'Las credenciales de proveedores no viven en SystemSetting y no se exponen mediante esta herramienta.',
  };
}

export async function executeFrontiV2ReadTool(
  user: CurrentUser,
  name: string,
  args: Record<string, unknown>,
): Promise<{ handled: boolean; result?: unknown }> {
  if (!READ_TOOL_NAMES.has(name)) return { handled: false };

  switch (name) {
    case 'consultar_turnos':
      return { handled: true, result: await shiftsTool(user) };
    case 'consultar_novedades':
      return { handled: true, result: await entriesTool(user, args) };
    case 'consultar_garantias':
      return { handled: true, result: await guaranteesTool(user, args) };
    case 'consultar_tareas':
      return { handled: true, result: await tasksTool(user, args) };
    case 'consultar_seguimientos':
      return { handled: true, result: await followUpsTool(user, args) };
    case 'consultar_supervision':
      return { handled: true, result: await supervisionTool(user) };
    case 'consultar_alertas':
      return { handled: true, result: await alertsTool(user, args) };
    case 'consultar_auditoria':
      return { handled: true, result: await auditTool(user, args) };
    case 'consultar_usuarios':
      return { handled: true, result: await usersTool(user, args) };
    case 'consultar_configuracion_operativa':
      return { handled: true, result: await settingsTool(user, args) };
    default:
      return { handled: false };
  }
}
