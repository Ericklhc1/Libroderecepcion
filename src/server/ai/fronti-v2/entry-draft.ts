import 'server-only';

import { prisma } from '@/lib/prisma';
import type { CurrentUser } from '@/server/auth/current-user';
import { listOperationalUsers } from '@/server/services/users';
import { parseFrontiDueAt } from '@/domain/fronti-due-date';
import { HOTEL_LOCALE, HOTEL_TIME_ZONE } from '@/domain/time';

type Level = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
const LEVEL_LABELS: Record<Level, string> = {
  BAJA: 'Baja', MEDIA: 'Media', ALTA: 'Alta', CRITICA: 'Crítica',
};

export type FrontiEntryDraft = {
  type: 'NOVEDAD' | 'INCIDENCIA';
  title: string;
  description: string;
  roomNumber: string | null;
  priority: Level;
  severity: Level | null;
  requiresFollowUp: boolean;
  // Opcionales para conservar las tarjetas v2 firmadas antes del despliegue.
  ownerId?: string | null;
  departmentId?: string | null;
  dueAt?: string | null;
};

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[.,;:]+$/g, '').replace(/\s+/g, ' ').trim();
}

function textField(value: unknown, field: string, maximum: number): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' || value.length > maximum) throw new Error(`${field}: revisa el texto indicado.`);
  return value.trim();
}

function level(value: unknown, fallback: Level | null): Level | null {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') throw new Error('Indica una prioridad o gravedad válida.');
  const result = normalize(value).toUpperCase();
  if (!['BAJA', 'MEDIA', 'ALTA', 'CRITICA'].includes(result)) {
    throw new Error('Elige baja, media, alta o crítica.');
  }
  return result as Level;
}

async function resolveResponsible(user: CurrentUser, value: unknown) {
  const departments = await prisma.department.findMany({
    where: { active: true },
    select: { id: true, name: true, key: true },
    orderBy: { order: 'asc' },
  });
  const fallback = departments.find((item) => item.id === user.departmentId) ?? null;
  const raw = textField(value, 'Responsable', 160);
  const normalized = normalize(raw);
  if (!normalized || /^(?:sin responsable|sin asignar|no aplica)$/.test(normalized)) {
    return { ownerId: null, departmentId: fallback?.id ?? null, ownerName: 'Sin persona asignada', departmentName: fallback?.name ?? 'Sin área' };
  }

  const areaOnly = /^(?:area|departamento|equipo)(?:\s+de)?\s+/.test(normalized);
  const query = normalized.replace(/^(?:area|departamento|equipo)(?:\s+de)?\s+/, '').replace(/^@/, '');
  const areaMatches = departments.filter((item) => normalize(item.name) === query || normalize(item.key) === query);
  const users = areaOnly ? [] : await listOperationalUsers();
  const self = /^(?:yo|a mi|mi usuario)$/.test(query);
  const exact = users.filter((item) => self ? item.id === user.id : normalize(item.name) === query || normalize(item.username) === query);
  const matches = exact.length || self ? exact : users.filter((item) => {
    const tokens = normalize(item.name).split(' ');
    return query.split(' ').every((token) => tokens.includes(token));
  });

  if (areaMatches.length === 1 && (areaOnly || matches.length === 0)) {
    const area = areaMatches[0]!;
    return { ownerId: null, departmentId: area.id, ownerName: 'Sin persona asignada', departmentName: area.name };
  }
  if (!areaOnly && matches.length === 1 && areaMatches.length === 0) {
    const person = matches[0]!;
    const area = departments.find((item) => item.id === person.department?.id) ?? fallback;
    return { ownerId: person.id, departmentId: area?.id ?? null, ownerName: person.name, departmentName: area?.name ?? 'Sin área' };
  }
  if (matches.length > 1 || areaMatches.length > 1 || (matches.length && areaMatches.length)) {
    throw new Error('Hay más de una coincidencia para el responsable. Indica el nombre completo, el usuario o el área.');
  }
  throw new Error('No encontré ese responsable entre las personas y áreas habilitadas para asignaciones. Indica su nombre o deja el registro sin persona asignada.');
}

export async function prepareFrontiEntryDraft(user: CurrentUser, args: Record<string, unknown>) {
  const type = args.type === 'INCIDENCIA' ? 'INCIDENCIA' : 'NOVEDAD';
  if (args.type && args.type !== 'INCIDENCIA' && args.type !== 'NOVEDAD') throw new Error('Indica si es una novedad o una incidencia.');
  const title = textField(args.title, 'Título', 200);
  if (title.length < 3) throw new Error('Indica brevemente qué ocurrió para preparar el registro.');
  // Una descripción breve aportada por el usuario basta; no pedirla dos veces.
  const description = textField(args.description, 'Descripción', 4000) || title;
  if (description.length < 3) throw new Error('La descripción debe explicar brevemente qué ocurrió.');
  const priority = level(args.priority, 'MEDIA')!;
  const severity = type === 'INCIDENCIA' ? level(args.severity, null) : null;
  if (type === 'INCIDENCIA' && !severity) throw new Error('Sólo falta indicar la gravedad de la incidencia: baja, media, alta o crítica.');
  const roomNumber = textField(args.roomNumber, 'Habitación', 20) || null;
  if (roomNumber) {
    const room = await prisma.room.findFirst({ where: { number: roomNumber, active: true }, select: { id: true } });
    if (!room) throw new Error(`La habitación ${roomNumber} no existe o está inactiva.`);
  }
  const dueAt = parseFrontiDueAt(args.dueAt);
  const responsible = await resolveResponsible(user, args.responsible);
  const draft: FrontiEntryDraft = {
    type, title, description, roomNumber, priority, severity,
    requiresFollowUp: type === 'INCIDENCIA' || args.requiresFollowUp === true,
    ownerId: responsible.ownerId,
    departmentId: responsible.departmentId,
    dueAt: dueAt?.toISOString() ?? null,
  };
  const dueAtLabel = dueAt?.toLocaleString(HOTEL_LOCALE, {
    timeZone: HOTEL_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const detail = [
    `Título: ${title}`,
    `Descripción: ${description}`,
    `Responsable: ${responsible.ownerName}`,
    `Área: ${responsible.departmentName}`,
    `Habitación: ${roomNumber ?? 'No aplica'}`,
    `Prioridad: ${LEVEL_LABELS[priority]}${args.priority == null ? ' (predeterminada)' : ''}`,
    ...(severity ? [`Gravedad: ${LEVEL_LABELS[severity]}`] : []),
    `Vencimiento: ${dueAtLabel ? dueAtLabel + ' · hora de Chile' : 'Sin vencimiento'}`,
    `Seguimiento: ${draft.requiresFollowUp ? 'Sí' : 'No'}`,
  ].join('\n');
  return { draft, detail };
}

/** Revalida al confirmar: el catálogo puede cambiar mientras la tarjeta está abierta. */
export async function validateFrontiEntryAssignment(draft: FrontiEntryDraft): Promise<void> {
  if (draft.ownerId) {
    const users = await listOperationalUsers();
    if (!users.some((item) => item.id === draft.ownerId)) {
      throw new Error('El responsable dejó de estar disponible para asignaciones. Vuelve a preparar el registro.');
    }
  }
  if (draft.departmentId) {
    const department = await prisma.department.findFirst({ where: { id: draft.departmentId, active: true }, select: { id: true } });
    if (!department) throw new Error('El área dejó de estar disponible. Vuelve a preparar el registro.');
  }
  if (draft.dueAt) parseFrontiDueAt(draft.dueAt);
}
