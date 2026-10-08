import 'server-only';
import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import type { Prisma, EntryStatus } from '@prisma/client';
import { isReceptionDeskRole } from '@/lib/permissions';
import { ForbiddenError, NotFoundError, RuleError } from '@/server/errors';
import { getSettingBool } from './settings';
import { readEntries, type EntryReader } from './entry-visibility';
import { createEntry, updateEntry, changeEntryStatus } from './entries';
import { operationalRecordRevision } from '@/server/security/authorized-revision';

export const SIMPLE_NOVELTIES_SETTING = 'book.simpleNovelties';
export const simpleNoveltiesEnabled = () => getSettingBool(SIMPLE_NOVELTIES_SETTING, false);

export function canResolveSimpleNovelty(user: EntryReader) {
  return Boolean(user.isSystemAdmin || user.roleKey === 'SUPERVISOR' || (user.roleKey && isReceptionDeskRole(user.roleKey)));
}

export async function simpleNoveltyAreaIds(user: EntryReader): Promise<string[] | null> {
  if (user.isSystemAdmin || user.roleKey === 'SUPERVISOR' || (user.roleKey && isReceptionDeskRole(user.roleKey))) return null;
  // Deactivating a catalog destination must not hide its existing work.
  const areas = await prisma.department.findMany({ where: { OR: [
    { users: { some: { id: user.id } } },
    { scheduleMemberships: { some: { active: true, collaborator: { active: true, userId: user.id } } } },
    ...(user.departmentId ? [{ id: user.departmentId }] : []),
  ] }, select: { id: true } });
  return areas.map(area => area.id);
}

export async function listSimpleNovelties(user: EntryReader, input: { area?: string; state?: string; q?: string; page?: number } = {}) {
  if (!await simpleNoveltiesEnabled()) throw new RuleError('La prueba de novedades simples está apagada.');
  const areaIds = await simpleNoveltyAreaIds(user);
  const query=input.q?.trim();
  const folio=query&&/^#?\d+$/.test(query)?Number(query.replace(/^#/,'')):null;
  const page = Math.max(1, Math.min(100000, Math.floor(input.page || 1)));
  const where: Prisma.OperationalEntryWhereInput = {
    deletedAt: null, isDemo: false, type: { in: ['NOVEDAD', 'INCIDENCIA'] },
    AND: [
      ...(areaIds ? [{ OR:[{departmentId:{in:areaIds}},{createdById:user.id}] }] : []),
      ...(input.area ? [{ departmentId: input.area }] : []),
      ...(input.state === 'resueltas' ? [{ status: { in: ['RESUELTO', 'CERRADO'] as EntryStatus[] } }] : input.state === 'todas' ? [] : [{ status: { notIn: ['RESUELTO', 'CERRADO'] as EntryStatus[] } }]),
      ...(query ? [{ OR: [...(folio!==null&&Number.isSafeInteger(folio)&&folio>0&&folio<=2147483647?[{humanId:folio}]:[]),{ title: { contains: query, mode: 'insensitive' as const } }, { description: { contains: query, mode: 'insensitive' as const } }, { workNextAction: { contains: query, mode: 'insensitive' as const } }, { room: { number: { contains: query, mode: 'insensitive' as const } } }, { reservationReference: { contains: query, mode: 'insensitive' as const } }, {reservation:{code:{contains:query,mode:'insensitive' as const}}}] }] : []),
    ],
  };
  const include = { createdBy: { select: { name: true } }, room: { select: { number: true } }, reservation: { select: { code: true } }, department: { select: { name: true } } };
  const generalWhere = { ...where, receptionInternal: false };
  const internalWhere = { ...where, receptionInternal: true };
  const [general, internal, total, internalTotal, departments] = await Promise.all([
    readEntries(prisma, user).findMany({ where: generalWhere, include, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 40, take: 40 }),
    readEntries(prisma, user).findMany({ where: internalWhere, include, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 40, take: 40 }),
    readEntries(prisma, user).count({ where: generalWhere }),
    readEntries(prisma, user).count({ where: internalWhere }),
    prisma.department.findMany({ where: { ...(areaIds ? { id: { in: areaIds } } : {}) }, select: { id: true, name: true, active: true }, orderBy: { order: 'asc' } }),
  ]);
  return { general, internal, total, internalTotal, page, departments };
}

export async function createSimpleNovelty(user: CurrentUser, input: { title: string; description: string; departmentId?: string | null; roomId?: string | null; reservationReference?: string | null; workNextAction?: string | null; internal?: boolean }) {
  if (!await simpleNoveltiesEnabled()) throw new RuleError('La prueba de novedades simples está apagada.');
  if (!user.permissions.includes('entry.create')) throw new ForbiddenError();
  if (input.internal && !canResolveSimpleNovelty(user)) throw new ForbiddenError();
  return createEntry(user, { ...input, type: 'NOVEDAD', priority: 'MEDIA', ownerId: null, requiresFollowUp: false, tags: [], receptionInternal: input.internal ?? false, workNextAction: input.workNextAction ?? null }, {simpleNovelty:true});
}

export async function resolveSimpleNovelty(user: CurrentUser, id: string, revision: string, resolution?: string) {
  if (!await simpleNoveltiesEnabled()) throw new RuleError('La prueba de novedades simples está apagada.');
  if (!canResolveSimpleNovelty(user)) throw new ForbiddenError();
  const entry = await readEntries(prisma, user).findFirst({ where: { id, deletedAt: null, type: { in: ['NOVEDAD', 'INCIDENCIA'] } } });
  if (!entry) throw new NotFoundError();
  if (revision !== operationalRecordRevision('entries', entry)) throw new RuleError('La novedad cambió. Vuelve a leerla.');
  return changeEntryStatus(user, { id, status: 'RESUELTO', resolution: resolution?.trim() || entry.resolution }, revision, {simpleNovelty:true});
}

export async function updateSimpleNovelty(user: CurrentUser, input: { id: string; title: string; description: string; departmentId: string | null; workNextAction: string | null;roomId?:string|null;reservationReference?:string|null }, revision: string) {
  if (!await simpleNoveltiesEnabled()) throw new RuleError('La prueba de novedades simples está apagada.');
  if (!user.permissions.includes('entry.edit')) throw new ForbiddenError();
  const current=await readEntries(prisma,user).findFirst({where:{id:input.id,deletedAt:null,type:{in:['NOVEDAD','INCIDENCIA']}}});
  if(!current)throw new NotFoundError();
  return updateEntry(user, input, revision, {simpleNovelty:true});
}
