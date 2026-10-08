import {assertReceptionOperationPermission} from './reception-operation-gate';
import {invalidateSimpleNoveltyDrafts} from './simple-novelty-drafts';
import { getSettingBool, assertSimpleNoveltiesEnabled, lockSimpleNoveltiesMode } from './settings';
import { isReceptionDeskRole } from '@/lib/permissions';
import { readEntries } from '@/server/services/entry-visibility';
import {alertReadWhere,followUpReadWhere} from './followup-access';
import {LIVE_ALERT_WHERE} from './alert-engine';
import {lockReceptionSummary} from './handover-snapshot';
import { receptionHandoverEntryWhere, entryReadWhere, housekeepingEntryReadWhere, canManageEntryVisibility, assertEntryOwnerVisibility, assertEntryLinkedWorkVisibility, type EntryReader } from './entry-visibility';
import {assertSubjectCanFinish} from './subject-completion';
import { assertAuthorizedRevision } from '@/server/security/authorized-revision';
import 'server-only';
import { publishHkMaintenanceUpdate } from './housekeeping-maintenance';
import {
  AuditAction,
  EntryStatus,
  EntryType,
  NotificationType,
  Severity,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { NotFoundError, RuleError } from '@/server/errors';
import { diffFields, recordAudit } from '@/server/audit';
import { notify } from '@/server/notifications';
import type { CurrentUser } from '@/server/auth/current-user';
import { ENTRY_OPEN_STATUSES, ENTRY_STATUS_LABEL, ENTRY_TYPE_LABEL } from '@/domain/labels';
import { normalizeTags } from '@/domain/tags';
import { getMyOpenShift } from './shifts';
import { ensureIncidentWorkflow } from './incident-workflow';
import { assertAssignable, listSupervisorIds } from './users';
import { finishSupervisionTrackingForSource } from './followups';
import {
  operationalDurationMs,
  recordOperationalEvent,
} from '@/server/observability/operational';
import {
  SUPERVISION_BACKUP_EMAIL,
  operationalMailTimestamp,
  queueOperationalMail,
} from '@/server/services/operational-mail';
import { scheduleFrontiProactiveSweep } from '@/server/ai/fronti-proactive-scheduler';

export const entryInclude = {
  hiddenFromDepartments: { select: { id: true, name:true, active:true } },
  housekeepingRequests: { where: { deletedAt: null }, orderBy: {createdAt:'desc'}, select: { humanId:true, departmentId:true, status:true, resolution:true, resolvedAt:true, isDemo:true, requiresInspection:true, inspectedAt:true, inspectedBy:{select:{name:true}} } },
  createdBy: { select: { id: true, name: true } },
  owner: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  department: { select: { id: true, name: true, key: true } },
  room: { select: { id: true, number: true, floor: true } },
  shift: { select: { id: true, type: true, date: true } },
  _count: { select: { comments: true, tasks: true, followUps: true, attachments: true } },
} satisfies Prisma.OperationalEntryInclude;

type NativeEntryWithRelations = Prisma.OperationalEntryGetPayload<{ include: typeof entryInclude }>;
export type EntryWithRelations = NativeEntryWithRelations & { housekeepingRequest: NativeEntryWithRelations['housekeepingRequests'][number] | null };

type EntryCreateInput = {
  hiddenDepartmentIds?: string[];
  includeInReceptionHandover?: boolean;
  type: EntryType;
  title: string;
  description: string;
  category?: string | null;
  departmentId?: string | null;
  /** Contexto operativo de habitación; no representa ocupación PMS. */
  roomId?: string | null;
  priority: Prisma.OperationalEntryCreateInput['priority'];
  ownerId?: string | null;
  occurredAt?: Date | null;
  dueAt?: Date | null;
  tags: string[];
  requiresFollowUp: boolean;
  /** Vínculos legados de contexto; no son requisito para la operación. */
  guestId?: string | null;
  reservationId?: string | null;
  stayId?: string | null;
  severity?: Severity | null;
  impact?: Prisma.OperationalEntryCreateInput['impact'];
  immediateAction?: string | null;
  workNextAction?: string | null;
  reservationReference?: string | null;
  receptionInternal?: boolean;
};

/**
 * Crea un registro del libro operativo.
 *
 * Las incidencias son el mismo modelo con campos adicionales (gravedad,
 * impacto, acción inmediata, causa y resolución): un único libro, sin módulos
 * duplicados. Se exige gravedad para que una incidencia nunca quede sin
 * clasificar.
 */
export async function createEntry(user: CurrentUser, input: EntryCreateInput, options:{incidentWorkflow?:boolean;simpleNovelty?:boolean}={}) {
  if (input.receptionInternal && !user.isSystemAdmin && user.roleKey!=='SUPERVISOR' && !isReceptionDeskRole(user.roleKey))throw new RuleError('Las operativas internas corresponden a Recepción.');
  if(input.ownerId && ['NOVEDAD','INCIDENCIA'].includes(input.type) && await getSettingBool('book.simpleNovelties',false))throw new RuleError('En novedades simples se elige el área relacionada; no se asignan personas.');
  if (input.ownerId) await assertAssignable(input.ownerId);

  if (input.type === EntryType.INCIDENCIA && !input.severity) {
    throw new RuleError('Una incidencia requiere indicar su gravedad.');
  }

  if (input.roomId) {
    const room = await prisma.room.findFirst({
      where: { id: input.roomId, active: true },
      select: { id: true },
    });
    if (!room) throw new RuleError('La habitación seleccionada no existe en el catálogo operativo.');
  }

  const shift = await getMyOpenShift(user.id);

  const entry = await prisma.$transaction(async (tx) => {
    const novelty=['NOVEDAD','INCIDENCIA'].includes(input.type);
    if(novelty)await lockReceptionSummary(tx);
    const simpleMode=novelty?await lockSimpleNoveltiesMode(tx):false;
    if(options.simpleNovelty&&!simpleMode)throw new RuleError('La prueba de novedades simples está apagada.');
    if(simpleMode&&input.ownerId&&['NOVEDAD','INCIDENCIA'].includes(input.type))throw new RuleError('En novedades simples se elige el área relacionada; no se asignan personas.');
    const hiddenIds = [...new Set(input.hiddenDepartmentIds ?? [])];
    if (hiddenIds.length > 100 || await tx.department.count({ where: { id: { in: hiddenIds }, active: true } }) !== hiddenIds.length) throw new RuleError('Selecciona áreas vigentes del catálogo.');
    if(simpleMode&&!input.receptionInternal&&await tx.department.count({where:{AND:[{id:{in:hiddenIds}},input.departmentId?{id:input.departmentId}:{key:'RECEPCION'}]}}))throw new RuleError('El área relacionada está oculta. Cambia su visibilidad antes de seleccionarla.');
    await assertEntryOwnerVisibility(tx,{ownerId:input.ownerId,createdById:user.id,hiddenDepartmentIds:hiddenIds,receptionInternal:input.receptionInternal});
    const created = await tx.operationalEntry.create({
      data: {
        includeInReceptionHandover: input.includeInReceptionHandover ?? true,
        hiddenFromDepartments: { connect: hiddenIds.map(id => ({ id })) },
        type: input.type,
        title: input.title,
        description: input.description,
        workNextAction: input.workNextAction ?? null,
        reservationReference: input.reservationReference ?? null,
        receptionInternal: input.receptionInternal ?? false,
        category: input.category ?? null,
        departmentId: input.departmentId ?? null,
        roomId: input.roomId ?? null,
        priority: input.priority,
        ownerId: input.ownerId ?? null,
        workAssignedAt: input.ownerId ? new Date() : null,
        shiftId: shift?.id ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        dueAt: input.dueAt ?? null,
        tags: normalizeTags(input.tags),
        requiresFollowUp: simpleMode ? false : input.requiresFollowUp,
        guestId: null,
        reservationId: null,
        stayId: null,
        severity: input.type === EntryType.INCIDENCIA ? (input.severity ?? null) : null,
        impact: input.type === EntryType.INCIDENCIA ? (input.impact ?? null) : null,
        immediateAction: input.immediateAction ?? null,
        createdById: user.id,
      },
      include: entryInclude,
    });

    const invalidatedDrafts=simpleMode?await invalidateSimpleNoveltyDrafts(tx,created):[];
    await recordAudit(
      {
        entity: 'OperationalEntry',
        entityId: created.id,
        action: AuditAction.CREAR,
        summary: `${ENTRY_TYPE_LABEL[created.type]} #${created.humanId}: ${created.title}`,
        user,
        after: {
          includeInReceptionHandover: created.includeInReceptionHandover,
          hiddenDepartmentIds: created.hiddenFromDepartments.map(d => d.id),
          type: created.type,
          title: created.title,
          priority: created.priority,
          severity: created.severity,
          status: created.status,
          ownerId: created.ownerId,
          departmentId: created.departmentId,
          category: created.category,
          roomId: created.roomId,
          roomNumber: created.room?.number ?? null,
          invalidatedDrafts,
        },
      },
      tx,
    );

    if(!simpleMode&&options.incidentWorkflow&&created.type===EntryType.INCIDENCIA)await ensureIncidentWorkflow(created.id,tx);

    if (created.ownerId && created.ownerId !== user.id) {
      await notify(
        {
          userId: created.ownerId,
          type: NotificationType.ACCION_REQUERIDA,
          title: `Te asignaron un registro: ${created.title}`,
          body: `${ENTRY_TYPE_LABEL[created.type]} #${created.humanId} creada por ${user.name}.`,
          link: `/libro/${created.id}`,
          entity: 'OperationalEntry',
          entityId: created.id,
        },
        tx,
      );
    }

    if (created.severity === Severity.CRITICA) {
      const supervisors = await listSupervisorIds();
      await notify(
        supervisors
          .filter((id) => id !== user.id)
          .map((id) => ({
            userId: id,
            type: NotificationType.INCIDENCIA_CRITICA,
            title: `Incidencia crítica #${created.humanId}: ${created.title}`,
            body: created.description.slice(0, 200),
            link: `/libro/${created.id}`,
            entity: 'OperationalEntry',
            entityId: created.id,
          })),
        tx,
      );
    }

    if (created.type === EntryType.NOVEDAD || created.type === EntryType.INCIDENCIA) {
      const label = created.type === EntryType.INCIDENCIA ? 'INCIDENCIA' : 'NOVEDAD';
      await queueOperationalMail(tx, {
        eventKey: `entry-created:${created.id}`,
        recipients: [SUPERVISION_BACKUP_EMAIL],
        subject: `[Libro Operativo] ${label} #${created.humanId} · ${created.title}`,
        text: [
          `${label} REGISTRADA`,
          `Referencia: #${created.humanId}`,
          `ID: ${created.id}`,
          `Título: ${created.title}`,
          `Fecha/hora: ${operationalMailTimestamp(created.occurredAt)}`,
          `Registrado por: ${user.name} (ID ${user.id})`,
          `Turno: ${created.shift ? `${created.shift.type} · ${created.shift.id}` : 'sin turno asociado'}`,
          `Estado: ${created.status}`,
          `Prioridad: ${created.priority}`,
          `Gravedad: ${created.severity ?? 'no aplica'}`,
          `Departamento: ${created.department?.name ?? 'sin departamento'}`,
          `Responsable: ${created.owner?.name ?? 'sin responsable'}`,
          `Categoría: ${created.category ?? 'sin categoría'}`,
          `Habitación: ${created.room?.number ?? 'sin habitación'}`,
          `Requiere seguimiento: ${created.requiresFollowUp ? 'sí' : 'no'}`,
          '',
          'Descripción:',
          created.description,
          ...(created.impact ? ['', `Impacto: ${created.impact}`] : []),
          ...(created.immediateAction ? ['', `Acción inmediata: ${created.immediateAction}`] : []),
          ...(created.tags.length > 0 ? ['', `Etiquetas: ${created.tags.join(', ')}`] : []),
        ].join('\n'),
      });
    }

    return created;
  });

  recordOperationalEvent({
    eventType: 'ENTRY_CREATED',
    userId: user.id,
    shiftId: entry.shiftId,
    entityType: 'OperationalEntry',
    entityId: entry.id,
    correlationId: `entry:${entry.id}`,
    completedAt: entry.createdAt,
    status: 'SUCCESS',
    metadata: { entryType: entry.type },
  });

  if (
    entry.type === EntryType.INCIDENCIA ||
    entry.priority === 'CRITICA' ||
    entry.priority === 'ALTA' ||
    entry.requiresFollowUp
  ) {
    scheduleFrontiProactiveSweep('entry-created');
  }

  return entry;
}

const EDITABLE_FIELDS = [
  'title',
  'description',
  'category',
  'departmentId',
  'roomId',
  'priority',
  'ownerId',
  'dueAt',
  'occurredAt',
  'requiresFollowUp',
  'severity',
  'impact',
  'immediateAction',
  'workNextAction',
  'reservationReference',
  'rootCause',
  'resolution',
  'tags',
] as const;

export async function getEntry(id: string, reader: EntryReader): Promise<EntryWithRelations> {
  const entry = await readEntries(prisma, reader).findUnique({
    where: { id },
    include: entryInclude,
  });
  if (!entry) throw new NotFoundError('El registro no existe.');
  return {...entry, housekeepingRequest:entry.housekeepingRequests[0]??null};
}

/** Modelo de lectura del asunto: mantiene la reserva histórica antes de proyectar contexto. */
export async function getSubjectEntry(user: EntryReader, id: string): Promise<EntryWithRelations> {
  const native = await readEntries(prisma, user).findFirst({ where: { id, AND: [entryReadWhere(user)] }, include: {...entryInclude,housekeepingRequests:{...entryInclude.housekeepingRequests,where:{deletedAt:null,AND:[housekeepingEntryReadWhere(user)]}}} });
  if (!native) throw new NotFoundError('El registro no está visible para tu área.');
  const entry = {...native, housekeepingRequest:native.housekeepingRequests[0]??null};
  const housekeepingRequests=entry.housekeepingRequests.filter(work=>!work.isDemo||user.isSystemAdmin);
  return { ...entry, housekeepingRequests, housekeepingRequest:housekeepingRequests[0]??null };
}

export async function updateEntry(
  user: CurrentUser,
  input: { id: string } & Partial<EntryCreateInput> & {
      rootCause?: string | null;
      resolution?: string | null;
    },
  expectedRevision?: string,
  options:{simpleNovelty?:boolean}={},
) {
  if ('hiddenDepartmentIds' in input || 'includeInReceptionHandover' in input) throw new RuleError('Cambia la visibilidad desde su acción dedicada.');
  const kind=await readEntries(prisma,user).findFirst({where:{id:input.id},select:{type:true}});
  const novelty=Boolean(kind&&['NOVEDAD','INCIDENCIA'].includes(kind.type));
  return prisma.$transaction(async (tx) => {
    if(novelty)await lockReceptionSummary(tx);
    const simpleMode=await lockSimpleNoveltiesMode(tx);
    if(simpleMode && !novelty)await assertReceptionOperationPermission(user,'entry.edit',tx);
    if(options.simpleNovelty&&!simpleMode)throw new RuleError('La prueba de novedades simples está apagada.');
    // The snapshot and the incident workflow belong to the same locked mutation.
    await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id" = ${input.id} FOR UPDATE`;
    const current = await readEntries(tx, user).findFirst({
      where: { id: input.id, deletedAt: null, AND: [entryReadWhere(user)] },
      include:{hiddenFromDepartments:{select:{id:true}}},
    });
    if (!current) throw new NotFoundError('El registro no existe o fue eliminado.');
    assertAuthorizedRevision(expectedRevision, {updatedAt:current.updatedAt,status:current.status,ownerId:current.ownerId,dueAt:current.dueAt});
    if (input.ownerId !== undefined && input.ownerId !== current.ownerId && ['NOVEDAD','INCIDENCIA'].includes(current.type) && simpleMode) throw new RuleError('En novedades simples se elige el área relacionada; no se asignan personas.');
    if(simpleMode&&['NOVEDAD','INCIDENCIA'].includes(current.type)&&'departmentId' in input&&input.departmentId!==current.departmentId&&!current.receptionInternal&&await tx.department.count({where:{AND:[{id:{in:current.hiddenFromDepartments.map(area=>area.id)}},input.departmentId?{id:input.departmentId}:{key:'RECEPCION'}]}}))throw new RuleError('El área relacionada está oculta. Cambia su visibilidad antes de seleccionarla.');
    if (current.status === EntryStatus.CERRADO && !user.permissions.includes('entry.reopen')) {
      throw new RuleError('El registro está cerrado. Reábrelo para poder editarlo.');
    }
    if (current.type === EntryType.INCIDENCIA && input.severity === null) {
      throw new RuleError('La incidencia requiere indicar su gravedad.');
    }
    if (input.ownerId) {
      await assertAssignable(input.ownerId);
      await assertEntryOwnerVisibility(tx,{ownerId:input.ownerId,createdById:current.createdById,hiddenDepartmentIds:current.hiddenFromDepartments.map(d=>d.id),receptionInternal:current.receptionInternal});
    }
    if (input.roomId) {
      const room = await prisma.room.findFirst({
        where: { id: input.roomId, active: true },
        select: { id: true },
      });
      if (!room) throw new RuleError('La habitación seleccionada no existe en el catálogo operativo.');
    }

    const data: Prisma.OperationalEntryUncheckedUpdateInput = {};
    const after: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (!(field in input)) continue;
      const raw = (input as Record<string, unknown>)[field];
      if (raw === undefined) continue;
      // An empty date means no correction, never erase/invent the recorded event time.
      if (field === 'occurredAt' && raw === null) continue;
      const value = field === 'tags' ? normalizeTags(raw as string[]) : raw;
      (data as Record<string, unknown>)[field] = value;
      after[field] = value;
    }

    const changes = diffFields(
      current as unknown as Record<string, unknown>,
      after,
      Object.keys(after),
    );
    if (changes.changed.length === 0) {
      if (simpleMode || current.type !== EntryType.INCIDENCIA) return current;
      await ensureIncidentWorkflow(current.id, tx);
      return readEntries(tx, user).findUniqueOrThrow({ where: { id: current.id }, include: entryInclude });
    }

    const updated = await tx.operationalEntry.update({
      where: { id: input.id, updatedAt: current.updatedAt },
      data: { ...data, updatedAt:new Date(Math.max(Date.now(),current.updatedAt.getTime()+1)), ...(changes.changed.includes('ownerId') ? { workAssignedAt: input.ownerId ? new Date() : null, workAcknowledgedAt: null, workAcknowledgedById: null, workStartedAt: null, workEscalatedAt: null, workRequestKey: null } : {}) },
      include: entryInclude,
    });

    const ownerChanged = changes.changed.includes('ownerId');
    const priorityChanged = changes.changed.includes('priority');

    const invalidatedDrafts=simpleMode?await invalidateSimpleNoveltyDrafts(tx,updated):[];

    await recordAudit(
      {
        entity: 'OperationalEntry',
        entityId: updated.id,
        action: ownerChanged
          ? AuditAction.CAMBIO_RESPONSABLE
          : priorityChanged
            ? AuditAction.CAMBIO_PRIORIDAD
            : AuditAction.EDITAR,
        summary: `Registro #${updated.humanId} actualizado (${changes.changed.join(', ')})`,
        user,
        before: changes.before,
        after: {...changes.after,...(invalidatedDrafts.length?{invalidatedDrafts}:{})},
      },
      tx,
    );

    if (ownerChanged && updated.ownerId && updated.ownerId !== user.id) {
      await notify(
        {
          userId: updated.ownerId,
          type: NotificationType.RESPONSABLE_CAMBIADO,
          title: `Ahora eres responsable de #${updated.humanId}`,
          body: updated.title,
          link: `/libro/${updated.id}`,
          entity: 'OperationalEntry',
          entityId: updated.id,
        },
        tx,
      );
    }

    await publishHkMaintenanceUpdate(tx, user, current, updated);
    if (!simpleMode && updated.type === EntryType.INCIDENCIA) {
      await ensureIncidentWorkflow(updated.id, tx);
      return readEntries(tx, user).findUniqueOrThrow({ where: { id: updated.id }, include: entryInclude });
    }
    return updated;
  });
}

export async function changeEntryStatus(
  user: CurrentUser,
  input: {
    id: string;
    status: EntryStatus;
    reason?: string | null;
    resolution?: string | null;
    rootCause?: string | null;
  },
  expectedRevision?: string,
  options:{simpleNovelty?:boolean}={},
) {
  const current = await readEntries(prisma, user).findFirst({
    where: { id: input.id, deletedAt: null, AND: [entryReadWhere(user)] },
  });
  if (!current) throw new NotFoundError('El registro no existe o fue eliminado.');
  assertAuthorizedRevision(expectedRevision, {updatedAt:current.updatedAt,status:current.status,ownerId:current.ownerId,dueAt:current.dueAt});
  if (current.status === input.status) return current;
  if (input.status === EntryStatus.EN_CURSO && !current.ownerId) throw new RuleError('Asigna una persona responsable antes de comenzar la atención.');

  const closing =
    input.status === EntryStatus.CERRADO || input.status === EntryStatus.RESUELTO;
  const reopening =
    (current.status === EntryStatus.CERRADO || current.status === EntryStatus.RESUELTO) &&
    ENTRY_OPEN_STATUSES.includes(input.status);

  if (closing) {
    const permission =
      current.type === EntryType.INCIDENCIA ? 'incident.close' : 'entry.close';
    const simpleReceptionClose = input.status===EntryStatus.RESUELTO && ['NOVEDAD','INCIDENCIA'].includes(current.type) && (user.isSystemAdmin || user.roleKey==='SUPERVISOR' || isReceptionDeskRole(user.roleKey)) && await getSettingBool('book.simpleNovelties',false);
    if (!simpleReceptionClose && !user.permissions.includes(permission) && !user.permissions.includes('entry.close')) {
      throw new RuleError('No tienes permiso para cerrar este registro.');
    }
    if (current.type === EntryType.INCIDENCIA) {
      const resolution = input.resolution ?? current.resolution;
      if (!resolution?.trim()) {
        throw new RuleError(
          'Para cerrar una incidencia debes registrar cómo se resolvió.',
        );
      }
    }

  }

  if (reopening && !user.permissions.includes('entry.reopen')) {
    throw new RuleError('No tienes permiso para reabrir registros.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const novelty=['NOVEDAD','INCIDENCIA'].includes(current.type);
    if(novelty)await lockReceptionSummary(tx);
    const simpleMode=await lockSimpleNoveltiesMode(tx);
    if(simpleMode && !(novelty && input.status===EntryStatus.RESUELTO))await assertReceptionOperationPermission(user,'entry.edit',tx);
    if(options.simpleNovelty || (closing && !user.permissions.includes('entry.close') && !user.permissions.includes('incident.close')))await assertSimpleNoveltiesEnabled(tx);
    await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id"=${current.id} FOR UPDATE`;
    if (closing) await assertSubjectCanFinish(tx,current.id);
    const now = new Date();
    const updated = await tx.operationalEntry.update({
      where: { id: input.id, updatedAt:current.updatedAt, ownerId:current.ownerId, status:current.status },
      data: {
        updatedAt: new Date(Math.max(Date.now(), current.updatedAt.getTime()+1)),
        status: input.status,
        ...(input.status === 'EN_CURSO' ? { workStartedAt: current.workStartedAt ?? now, ...(current.ownerId === user.id ? {workAcknowledgedAt: current.workAcknowledgedAt ?? now, workAcknowledgedById: user.id} : {}) } : {}),
        resolution: input.resolution ?? current.resolution,
        rootCause: input.rootCause ?? current.rootCause,
        resolvedAt: closing ? (current.resolvedAt ?? current.closedAt ?? now) : reopening ? null : current.resolvedAt,
        closedAt: input.status === EntryStatus.CERRADO ? now : null,
        closedById: input.status === EntryStatus.CERRADO ? user.id : null,
        reopenedAt: reopening ? now : current.reopenedAt,
      },
      include: entryInclude,
    });

    const invalidatedDrafts=simpleMode?await invalidateSimpleNoveltyDrafts(tx,updated):[];

    await recordAudit(
      {
        entity: 'OperationalEntry',
        entityId: updated.id,
        action:
          input.status === EntryStatus.CERRADO
            ? AuditAction.CERRAR
            : reopening
              ? AuditAction.REABRIR
              : AuditAction.CAMBIO_ESTADO,
        summary: `Registro #${updated.humanId}: ${ENTRY_STATUS_LABEL[current.status]} → ${ENTRY_STATUS_LABEL[input.status]}`,
        user,
        before: { status: current.status },
        after: { status: input.status, resolution: updated.resolution,...(invalidatedDrafts.length?{invalidatedDrafts}:{}) },
        reason: input.reason ?? null,
      },
      tx,
    );

    if (closing) {
      await finishSupervisionTrackingForSource(
        tx,
        user,
        'OperationalEntry',
        current.id,
        'RESUELTO',
      );
    }

    const interested = new Set<string>([current.createdById]);
    if (current.ownerId) interested.add(current.ownerId);
    interested.delete(user.id);
    await notify(
      Array.from(interested).map((userId) => ({
        userId,
        type: NotificationType.ACTUALIZACION_OPERATIVA,
        title: `#${updated.humanId} pasó a ${ENTRY_STATUS_LABEL[input.status]}`,
        body: updated.title,
        link: `/libro/${updated.id}`,
        entity: 'OperationalEntry',
        entityId: updated.id,
      })),
      tx,
    );

    await publishHkMaintenanceUpdate(tx, user, current, updated);
    return updated;
  });

  const completedAt = new Date();
  const correlationId = `entry:${current.id}`;
  if (input.status === EntryStatus.EN_CURSO && current.status !== EntryStatus.EN_CURSO) {
    recordOperationalEvent({
      eventType: 'ENTRY_TAKEN',
      userId: user.id,
      shiftId: updated.shiftId,
      entityType: 'OperationalEntry',
      entityId: updated.id,
      correlationId,
      startedAt: current.createdAt,
      completedAt,
      durationMs: operationalDurationMs(current.createdAt, completedAt),
      status: 'SUCCESS',
      metadata: { entryType: updated.type },
    });
  }

  const currentWasTerminal =
    current.status === EntryStatus.CERRADO || current.status === EntryStatus.RESUELTO;
  if (closing && !currentWasTerminal) {
    recordOperationalEvent({
      eventType: 'ENTRY_RESOLVED',
      userId: user.id,
      shiftId: updated.shiftId,
      entityType: 'OperationalEntry',
      entityId: updated.id,
      correlationId,
      startedAt: current.createdAt,
      completedAt,
      durationMs: operationalDurationMs(current.createdAt, completedAt),
      status: 'SUCCESS',
      metadata: { entryType: updated.type },
    });
  }

  return updated;
}

export async function softDeleteEntry(
  user: CurrentUser,
  input: { id: string; reason: string },
  expectedRevision?: string,
) {
  const current = await readEntries(prisma, user).findFirst({
    where: { id: input.id, deletedAt: null, AND: [entryReadWhere(user)] },
  });
  if (!current) throw new NotFoundError('El registro no existe o ya fue eliminado.');
  assertAuthorizedRevision(expectedRevision, {updatedAt:current.updatedAt,status:current.status,ownerId:current.ownerId,dueAt:current.dueAt});

  return prisma.$transaction(async (tx) => {
    const novelty=['NOVEDAD','INCIDENCIA'].includes(current.type);
    if(novelty)await lockReceptionSummary(tx);
    const simpleMode=novelty?await lockSimpleNoveltiesMode(tx):false;
    const deleted = await tx.operationalEntry.update({
      where: { id: input.id, updatedAt: current.updatedAt },
      data: {
        deletedAt: new Date(),
        deletedById: user.id,
        deletionReason: input.reason,
      },
    });
    const invalidatedDrafts=simpleMode?await invalidateSimpleNoveltyDrafts(tx,deleted):[];
    await recordAudit(
      {
        entity: 'OperationalEntry',
        entityId: input.id,
        action: AuditAction.ELIMINAR,
        summary: `Eliminación lógica del registro #${current.humanId}: ${current.title}`,
        user,
        before: { deletedAt: null },
        after: { deletedAt: deleted.deletedAt,...(invalidatedDrafts.length?{invalidatedDrafts}:{}) },
        reason: input.reason,
      },
      tx,
    );
    await finishSupervisionTrackingForSource(
      tx,
      user,
      'OperationalEntry',
      input.id,
      'CANCELADO',
    );
    return deleted;
  });
}

export async function restoreEntry(
  user: CurrentUser,
  input: { id: string; reason?: string | null },
  expectedRevision?: string,
) {
  const current = await readEntries(prisma, user).findFirst({
    where: { id: input.id, NOT: { deletedAt: null } },
  });
  if (!current) throw new NotFoundError('El registro no está eliminado.');
  assertAuthorizedRevision(expectedRevision, {updatedAt:current.updatedAt,status:current.status,ownerId:current.ownerId,dueAt:current.dueAt});

  return prisma.$transaction(async (tx) => {
    const novelty=['NOVEDAD','INCIDENCIA'].includes(current.type);
    if(novelty)await lockReceptionSummary(tx);
    const simpleMode=novelty?await lockSimpleNoveltiesMode(tx):false;
    const restored = await tx.operationalEntry.update({
      where: { id: input.id, updatedAt: current.updatedAt },
      data: { deletedAt: null, deletedById: null, deletionReason: null },
    });
    const invalidatedDrafts=simpleMode?await invalidateSimpleNoveltyDrafts(tx,restored):[];
    await recordAudit(
      {
        entity: 'OperationalEntry',
        entityId: input.id,
        action: AuditAction.RESTAURAR,
        summary: `Registro #${current.humanId} restaurado`,
        user,
        before: { deletedAt: current.deletedAt, deletionReason: current.deletionReason },
        after: { deletedAt: null,...(invalidatedDrafts.length?{invalidatedDrafts}:{}) },
        reason: input.reason ?? null,
      },
      tx,
    );
    return restored;
  });
}

/** Creator or supervisor, independent of content/assignment editing grants. */
export async function updateEntryVisibility(user: CurrentUser, input: { id: string; revision: string; hiddenDepartmentIds: string[]; includeInReceptionHandover: boolean }) {
  return prisma.$transaction(async tx => {
    await lockReceptionSummary(tx);
    const simpleMode=await lockSimpleNoveltiesMode(tx);
    await tx.$queryRaw`SELECT "id" FROM "OperationalEntry" WHERE "id" = ${input.id} FOR UPDATE`;
    const current = await readEntries(tx, user).findFirst({ where: { id: input.id, deletedAt: null }, include: { hiddenFromDepartments: { select: { id: true } } } });
    if (!current) throw new NotFoundError('La novedad no existe.');
    if (!canManageEntryVisibility(user, current.createdById)) throw new RuleError('Sólo quien creó la novedad o Supervisión puede cambiar su visibilidad.');
    if (current.updatedAt.toISOString() !== input.revision) throw new RuleError('La novedad cambió. Actualiza antes de guardar.');
    const ids = [...new Set(input.hiddenDepartmentIds)];
    if(simpleMode && !current.receptionInternal && (current.type===EntryType.NOVEDAD||current.type===EntryType.INCIDENCIA) && await tx.department.count({where:{AND:[{id:{in:ids}},current.departmentId?{id:current.departmentId}:{key:"RECEPCION"}]}}))throw new RuleError("El área relacionada debe poder ver la novedad.");
    if (ids.length > 100 || await tx.department.count({ where: { id: { in: ids }, OR:[{active:true},{id:{in:current.hiddenFromDepartments.map(d=>d.id)}}] } }) !== ids.length) throw new RuleError('Selecciona áreas vigentes del catálogo.');
    await assertEntryOwnerVisibility(tx,{ownerId:current.ownerId,createdById:current.createdById,hiddenDepartmentIds:ids});
    await assertEntryLinkedWorkVisibility(tx,{id:current.id,createdById:current.createdById,hiddenDepartmentIds:ids});
    // All area changes can alter a receiver's actual projection, even when the
    // reception checkbox stays unchanged (secondary area memberships apply).
    const selectable=!current.isDemo&&(current.type===EntryType.NOVEDAD||current.type===EntryType.INCIDENCIA)&&(ENTRY_OPEN_STATUSES.includes(current.status)||current.status===EntryStatus.RESUELTO||current.status===EntryStatus.CERRADO);
    const drafts=await tx.shiftHandover.findMany({where:{status:'BORRADOR'},select:{id:true,fromShiftId:true,receptionSummaryRevision:true,receptionSummaryPreparedRevision:true,pendingsReviewedAt:true,finalReviewAt:true,urgentAcknowledgedAt:true,issuedBy:{select:{id:true,departmentId:true,role:{select:{key:true}}}}}});
    const readable=async(d:typeof drafts[number])=>{
      const reader:EntryReader={id:d.issuedBy.id,departmentId:d.issuedBy.departmentId,roleKey:d.issuedBy.role.key as CurrentUser['roleKey'],isSystemAdmin:d.issuedBy.role.key==='ADMINISTRADOR_SISTEMA',permissions:[]};
      const direct=selectable&&(ENTRY_OPEN_STATUSES.includes(current.status)||current.shiftId===d.fromShiftId);
      const now=new Date();
      const counts=await Promise.all([
        direct?readEntries(tx, reader).count({where:{id:current.id,AND:[receptionHandoverEntryWhere,entryReadWhere(reader)]}}):Promise.resolve(0),
        tx.alert.count({where:{...LIVE_ALERT_WHERE(now),taskId:null,sourceEntries:{some:{entryId:current.id}},AND:[alertReadWhere(reader,true)]}}),
        tx.followUp.count({where:{deletedAt:null,status:{in:['PENDIENTE','VENCIDO']},sourceEntries:{some:{entryId:current.id}},AND:[followUpReadWhere(reader,false,true),{OR:[{scheduledAt:null},{scheduledAt:{lte:new Date(now.getTime()+24*3600_000)}}]}]}}),
      ]);
      return counts.some(count=>count>0);
    };
    const beforeReadable=await Promise.all(drafts.map(readable));
    const updated = await tx.operationalEntry.update({ where: { id: input.id }, data: {
      includeInReceptionHandover: input.includeInReceptionHandover,
      hiddenFromDepartments: { set: ids.map(id => ({ id })) },
    }, include: entryInclude });
    const afterReadable=await Promise.all(drafts.map(readable));
    const invalidatedDrafts=drafts.filter((_,i)=>beforeReadable[i]!==afterReadable[i]).map(d=>({id:d.id,receptionSummaryRevision:d.receptionSummaryRevision,receptionSummaryPreparedRevision:d.receptionSummaryPreparedRevision,pendingsReviewedAt:d.pendingsReviewedAt?.toISOString()??null,finalReviewAt:d.finalReviewAt?.toISOString()??null,urgentAcknowledgedAt:d.urgentAcknowledgedAt?.toISOString()??null}));
    if(invalidatedDrafts.length)await tx.shiftHandover.updateMany({where:{id:{in:invalidatedDrafts.map(d=>d.id)},status:'BORRADOR'},data:{receptionSummaryRevision:{increment:1},pendingsReviewedAt:null,finalReviewAt:null,urgentAcknowledgedAt:null}});
    await tx.auditLog.create({ data: {
      entity: 'OperationalEntry', entityId: current.id, action: AuditAction.EDITAR,
      summary: `Visibilidad de la novedad #${current.humanId} cambiada por ${user.name}`,
      userId: user.id, sessionId: user.sessionId, isDemo: current.isDemo,
      before: { hiddenDepartmentIds: current.hiddenFromDepartments.map(d => d.id), includeInReceptionHandover: current.includeInReceptionHandover,...(invalidatedDrafts.length?{receptionDrafts:invalidatedDrafts}:{}) },
      after: { hiddenDepartmentIds: ids, includeInReceptionHandover: updated.includeInReceptionHandover,...(invalidatedDrafts.length?{receptionDrafts:invalidatedDrafts.map(d=>({...d,receptionSummaryRevision:d.receptionSummaryRevision+1,pendingsReviewedAt:null,finalReviewAt:null,urgentAcknowledgedAt:null}))}:{}) },
    } });
    return updated;
  });
}
