import 'server-only';
import { KeyStatus, KeyType, type Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { ROLE_KEYS } from '@/lib/permissions';
import { hasAnyPermission, hasPermission, type CurrentUser } from '@/server/auth/current-user';
import { ForbiddenError, RuleError } from '@/server/errors';

type Tx = Prisma.TransactionClient;
function stockAccess(user: CurrentUser) {
  if (user.roleKey !== ROLE_KEYS.SUPERVISOR) throw new ForbiddenError('El stock privado pertenece exclusivamente a Supervisión.');
}
function publicAccess(user: CurrentUser, write = false) {
  if (write ? !hasPermission(user, 'key.assign') : !hasAnyPermission(user, ['key.assign', 'key.inventory', 'key.stock'])) throw new ForbiddenError('No tienes permiso para gestionar entregas de llaves.');
}
function text(value: string, label: string, max = 180) {
  const clean = value.trim();
  if (!clean || clean.length > max) throw new RuleError(`${label} es obligatorio y admite hasta ${max} caracteres.`);
  return clean;
}
export async function listSupervisorKeys(user: CurrentUser) {
  stockAccess(user);
  return prisma.supervisorKey.findMany({ where: { ownerId: user.id }, orderBy: { code: 'asc' }, include: { movements: { orderBy: { at: 'desc' }, take: 10 } } });
}
export async function saveSupervisorKey(user: CurrentUser, input: { id?: string; version?: number; code: string; destination: string; notes?: string; status?: KeyStatus; retired?: boolean }) {
  stockAccess(user);
  const code = text(input.code, 'Código', 60).toUpperCase();
  const destination = text(input.destination, 'Destino');
  const notes = input.notes?.trim() || null;
  if (notes && notes.length > 300) throw new RuleError('La observación admite hasta 300 caracteres.');
  const status = input.status ?? KeyStatus.DISPONIBLE;
  const editableStatuses: KeyStatus[] = [KeyStatus.DISPONIBLE, KeyStatus.EXTRAVIADA, KeyStatus.FUERA_DE_SERVICIO];
  if (!editableStatuses.includes(status)) throw new RuleError('Estado de stock inválido.');
  return prisma.$transaction(async tx => {
    const existing = input.id ? await tx.supervisorKey.findFirst({ where: { id: input.id, ownerId: user.id } }) : null;
    if (input.id && !existing) throw new ForbiddenError('La llave no pertenece a tu stock.');
    if (existing && (existing.status === KeyStatus.ENTREGADA_PERSONAL || existing.retired)) throw new RuleError('Recibe la llave antes de modificarla. Las bajas conservan su historial.');
    if (await tx.supervisorKey.findFirst({ where: { ownerId: user.id, code, ...(existing ? { id: { not: existing.id } } : {}) } })) throw new RuleError('Ya tienes una llave con ese código.');
    const data = { code, destination, notes, status: input.retired ? KeyStatus.FUERA_DE_SERVICIO : status, retired: input.retired ?? false };
    let key;
    if (existing) {
      const changed = await tx.supervisorKey.updateMany({ where: { id: existing.id, ownerId: user.id, version: input.version, status: existing.status, retired: false }, data: { ...data, version: { increment: 1 } } });
      if (changed.count !== 1 || input.version !== existing.version) throw new RuleError('El stock cambió. Recarga antes de editar.');
      key = await tx.supervisorKey.findUniqueOrThrow({ where: { id: existing.id } });
    } else key = await tx.supervisorKey.create({ data: { ...data, ownerId: user.id } });
    await tx.supervisorKeyMovement.create({ data: { keyId: key.id, actorId: user.id, action: existing ? input.retired ? 'BAJA' : 'AJUSTE' : 'INGRESO', detail: { before: existing ? { code: existing.code, destination: existing.destination, status: existing.status } : null, after: data } } });
    return key;
  });
}
export async function saveKeyArea(user: CurrentUser, input: { id?: string; name: string; active: boolean }) {
  if (!hasPermission(user, 'key.stock')) throw new ForbiddenError('No tienes permiso para gestionar áreas.');
  const name = text(input.name, 'Nombre del área', 80);
  return prisma.$transaction(async tx => {
    if (input.id && !await tx.keyArea.findUnique({ where: { id: input.id } })) throw new RuleError('El área no existe.');
    if (await tx.keyArea.findFirst({ where: { name: { equals: name, mode: 'insensitive' }, ...(input.id ? { id: { not: input.id } } : {}) } })) throw new RuleError('Ya existe un área con ese nombre.');
    if (input.id && !input.active && await tx.keyStaffLoanItem.count({ where: { destinationId: input.id, destinationKind: 'AREA', returnedAt: null } })) throw new RuleError('Recibe las llaves entregadas antes de desactivar el área.');
    const area = input.id ? await tx.keyArea.update({ where: { id: input.id }, data: { name, active: input.active } }) : await tx.keyArea.create({ data: { name, active: input.active } });
    await tx.auditLog.create({ data: { entity: 'KeyArea', entityId: area.id, action: input.id ? 'EDITAR' : 'CREAR', userId: user.id, sessionId: user.sessionId, summary: `Área de llaves: ${name}` } });
    return area;
  });
}
export async function createAreaKey(user: CurrentUser, input: { areaId: string; code: string }) {
  if (!hasPermission(user, 'key.stock')) throw new ForbiddenError('No tienes permiso para agregar llaves.');
  const code = text(input.code, 'Código', 60).toUpperCase();
  return prisma.$transaction(async tx => {
    const area = await tx.keyArea.findFirst({ where: { id: input.areaId, active: true } });
    if (!area) throw new RuleError('Selecciona un área activa.');
    if (await tx.roomKey.findUnique({ where: { code } })) throw new RuleError('Ya existe una llave con ese código.');
    const key = await tx.roomKey.create({ data: { code, type: KeyType.COPIA, areaId: area.id } });
    await tx.keyMovement.create({ data: { keyId: key.id, action: 'INGRESO_INVENTARIO', toStatus: 'DISPONIBLE', userId: user.id, note: `Área: ${area.name}` } });
    return key;
  });
}
export async function listStaffLoans(user: CurrentUser, tx: Tx = prisma) {
  publicAccess(user);
  // La entrega es pública; la reserva y sus movimientos permanecen privados.
  return tx.keyStaffLoan.findMany({ where: { items: { some: { returnedAt: null } } }, orderBy: { createdAt: 'desc' }, include: { items: true } });
}
export type StaffLoanInput = { requestKey: string; departmentId: string; collaboratorId?: string; authorizedById: string; notes?: string; items: { keyId: string; source: 'public' | 'private'; destinationId: string; destinationKind: 'ROOM' | 'AREA' }[] };
export async function lendStaffKeys(user: CurrentUser, input: StaffLoanInput) {
  publicAccess(user, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestKey)) throw new RuleError('Referencia de entrega inválida.');
  if (!input.items.length || input.items.length > 100 || new Set(input.items.map(i => `${i.source}:${i.keyId}`)).size !== input.items.length) throw new RuleError('Selecciona entre una y cien llaves diferentes.');
  if (input.notes && input.notes.length > 300) throw new RuleError('La observación admite hasta 300 caracteres.');
  if (input.items.some(i => i.source === 'private')) stockAccess(user);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.requestKey}))::text`;
    const prior = await tx.keyStaffLoan.findUnique({ where: { requestKey: input.requestKey }, include: { items: true } });
    if (prior) {
      const same = prior.createdById === user.id && prior.departmentId === input.departmentId && prior.collaboratorId === (input.collaboratorId || null) && prior.authorizedById === input.authorizedById && prior.notes === (input.notes?.trim() || null) && prior.items.length === input.items.length && input.items.every(i => prior.items.some(p => p.destinationId === i.destinationId && p.destinationKind === i.destinationKind && (i.source === 'private' ? p.supervisorKeyId : p.roomKeyId) === i.keyId));
      if (!same) throw new RuleError('La referencia ya se utilizó para otra entrega.');
      return prior;
    }
    const department = await tx.department.findFirst({ where: { id: input.departmentId, active: true } });
    if (!department) throw new RuleError('Selecciona el área receptora.');
    const authorizer = await tx.user.findFirst({ where: { id: input.authorizedById, active: true, deletedAt: null, role: { level: { gte: 60 } } }, include: { role: true } });
    if (!authorizer) throw new RuleError('La persona que autorizó debe estar activa y tener rol de Supervisor o superior.');
    const collaborator = input.collaboratorId ? await tx.user.findFirst({ where: { id: input.collaboratorId, active: true, deletedAt: null, OR: [{departmentId: department.id},{scheduleCollaborator: {active:true,memberships:{some:{departmentId:department.id,active:true}}}}] } }) : null;
    if (input.collaboratorId && !collaborator) throw new RuleError('El colaborador debe pertenecer al área receptora.');
    const loan = await tx.keyStaffLoan.create({ data: { requestKey: input.requestKey, departmentId: department.id, departmentName: department.name, collaboratorId: collaborator?.id, collaboratorName: collaborator?.name, authorizedById: authorizer.id, authorizedByName: authorizer.name, createdById: user.id, createdByName: user.name, notes: input.notes?.trim() || null } });
    for (const item of [...input.items].sort((a,b) => a.keyId.localeCompare(b.keyId))) {
      if (!['ROOM', 'AREA'].includes(item.destinationKind) || !['public', 'private'].includes(item.source)) throw new RuleError('Selección de llave inválida.');
      const destination = item.destinationKind === 'ROOM' ? await tx.room.findFirst({ where: { id: item.destinationId, active: true } }) : await tx.keyArea.findFirst({ where: { id: item.destinationId, active: true } });
      if (!destination) throw new RuleError('El destino no existe o está inactivo.');
      const destinationName = 'number' in destination ? `Habitación ${destination.number}` : destination.name;
      let code: string;
      if (item.source === 'public') {
        const key = await tx.roomKey.findUnique({ where: { id: item.keyId } });
        const poolKey = key && !key.roomId && !key.areaId && key.type !== KeyType.PRINCIPAL;
        if (!key || key.status !== KeyStatus.DISPONIBLE || (!poolKey && (item.destinationKind === 'ROOM' ? key.roomId !== destination.id || key.areaId !== null : key.areaId !== destination.id || key.roomId !== null))) throw new RuleError('La llave debe estar disponible y pertenecer al destino seleccionado.');
        const changed = await tx.roomKey.updateMany({ where: { id: key.id, status: 'DISPONIBLE' }, data: { status: 'ENTREGADA_PERSONAL', assignedAt: new Date(), assignedById: user.id, stayId: null } });
        if (changed.count !== 1) throw new RuleError('Otra entrega acaba de ocupar la llave.');
        code = key.code;
        await tx.keyMovement.create({ data: { keyId: key.id, action: 'ASIGNADA', fromStatus: 'DISPONIBLE', toStatus: 'ENTREGADA_PERSONAL', roomId: item.destinationKind === 'ROOM' ? destination.id : null, userId: user.id, note: `Entrega #${loan.humanId} · ${department.name} · ${collaborator?.name ?? 'personal del área'} · Autorizó: ${authorizer.name}` } });
      } else {
        const key = await tx.supervisorKey.findFirst({ where: { id: item.keyId, ownerId: user.id, retired: false, status: 'DISPONIBLE' } });
        if (!key) throw new RuleError('La llave no está disponible en tu stock.');
        if ((await tx.supervisorKey.updateMany({ where: { id: key.id, ownerId: user.id, status: 'DISPONIBLE', retired: false, version: key.version }, data: { status: 'ENTREGADA_PERSONAL', version: { increment: 1 } } })).count !== 1) throw new RuleError('Otra entrega acaba de ocupar la llave.');
        code = key.code;
        await tx.supervisorKeyMovement.create({ data: { keyId: key.id, actorId: user.id, action: 'ENTREGA', detail: { loanId: loan.id, destinationName } } });
      }
      await tx.keyStaffLoanItem.create({ data: { loanId: loan.id, roomKeyId: item.source === 'public' ? item.keyId : null, supervisorKeyId: item.source === 'private' ? item.keyId : null, keyCode: code, destinationId: destination.id, destinationName, destinationKind: item.destinationKind } });
    }
    await tx.auditLog.create({ data: { entity: 'KeyStaffLoan', entityId: loan.id, action: 'CREAR', userId: user.id, sessionId: user.sessionId, summary: `Entrega a personal #${loan.humanId} · ${department.name} · ${input.items.length} llave(s) · Autorizó: ${authorizer.name}` } });
    return loan;
  });
}
export async function returnStaffKey(user: CurrentUser, itemId: string, note: string) {
  publicAccess(user, true);
  const clean = text(note, 'Observación de recepción');
  return prisma.$transaction(async tx => {
    const item = await tx.keyStaffLoanItem.findUnique({ where: { id: itemId }, include: { loan: true, supervisorKey: true } });
    if (!item) throw new RuleError('La entrega no existe.');
    if (item.supervisorKey && (user.roleKey !== ROLE_KEYS.SUPERVISOR || item.supervisorKey.ownerId !== user.id)) throw new ForbiddenError('Solo el propietario puede recibir la llave de su stock privado.');
    if (item.returnedAt) return item;
    const updated = await tx.keyStaffLoanItem.updateMany({ where: { id: item.id, returnedAt: null }, data: { returnedAt: new Date(), returnedById: user.id, returnNote: clean } });
    if (!updated.count) return item;
    if (item.roomKeyId) {
      if ((await tx.roomKey.updateMany({ where: { id: item.roomKeyId, status: 'ENTREGADA_PERSONAL' }, data: { status: 'DISPONIBLE', assignedAt: null, assignedById: null, stayId: null } })).count !== 1) throw new RuleError('El estado de la llave cambió; revisa su historial.');
      await tx.keyMovement.create({ data: { keyId: item.roomKeyId, action: 'DEVUELTA', fromStatus: 'ENTREGADA_PERSONAL', toStatus: 'DISPONIBLE', userId: user.id, note: `Devolución entrega #${item.loan.humanId}: ${clean}` } });
    } else if (item.supervisorKeyId) {
      await tx.supervisorKey.update({ where: { id: item.supervisorKeyId }, data: { status: 'DISPONIBLE', version: { increment: 1 } } });
      await tx.supervisorKeyMovement.create({ data: { keyId: item.supervisorKeyId, actorId: user.id, action: 'DEVOLUCION', detail: { loanId: item.loanId, note: clean } } });
    }
    await tx.auditLog.create({ data: { entity: 'KeyStaffLoan', entityId: item.loanId, action: 'EDITAR', userId: user.id, sessionId: user.sessionId, summary: `Recepción de llave de entrega #${item.loan.humanId} · ${item.destinationName}` } });
    return item;
  });
}
