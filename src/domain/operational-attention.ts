import {
  ROOM_STATE_ACTIONS,
  ROOM_STATE_LABELS,
  type RoomState,
} from './rooms';

export type AttentionTone = 'critico' | 'atencion' | 'pendiente';

export type OperationalAttentionItem = {
  id: string;
  kind: 'room' | 'alert' | 'task' | 'entry' | 'followup';
  tone: AttentionTone;
  score: number;
  title: string;
  reason: string;
  action: string;
  href: string;
};

type AttentionInput = {
  rooms: Array<{
    number: string;
    state: RoomState;
    openIncidents: number;
    keysOut: number;
  }>;
  alerts: Array<{
    id: string;
    level: 'INFORMATIVA' | 'ATENCION' | 'CRITICA';
    title: string;
    message?: string | null;
  }>;
  overdueTasks: Array<{
    id: string;
    title: string;
    priority: 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
  }>;
  criticalEntries: Array<{
    id: string;
    seq: number;
    title: string;
    priority: 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
    overdue: boolean;
  }>;
  followUps: Array<{
    id: string;
    action: string;
    status: 'PENDIENTE' | 'VENCIDO' | string;
  }>;
};

const ROOM_SCORE: Partial<Record<RoomState, number>> = {
  PENDIENTE_LIBERACION: 100,
  CHECK_IN_EN_COLA: 96,
  CHECK_OUT_PENDIENTE: 92,
  CHECK_IN_LISTO: 72,
};

const PRIORITY_BONUS: Record<'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA', number> = {
  BAJA: 0,
  MEDIA: 1,
  ALTA: 4,
  CRITICA: 8,
};

function toneForScore(score: number): AttentionTone {
  if (score >= 90) return 'critico';
  if (score >= 75) return 'atencion';
  return 'pendiente';
}

/**
 * Proyecta el estado vivo a una bandeja única de atención.
 *
 * No usa IA. La prioridad debe seguir siendo explicable y estable aunque
 * OpenAI no responda. La IA puede resumir estos hechos, nunca inventarlos.
 */
export function buildOperationalAttention(
  input: AttentionInput,
  limit = 10,
): OperationalAttentionItem[] {
  const items: OperationalAttentionItem[] = [];

  for (const room of input.rooms) {
    const base = ROOM_SCORE[room.state] ?? 0;
    const score = Math.max(
      base,
      room.openIncidents > 0 ? 78 : 0,
      room.keysOut > 0 ? 68 : 0,
    );
    if (score === 0) continue;

    const extras = [
      room.openIncidents > 0 ? `${room.openIncidents} incidencia(s) abierta(s)` : null,
      room.keysOut > 0 ? `${room.keysOut} llave(s) fuera` : null,
    ].filter(Boolean);

    items.push({
      id: `room:${room.number}`,
      kind: 'room',
      tone: toneForScore(score),
      score,
      title: `Habitación ${room.number} · ${ROOM_STATE_LABELS[room.state]}`,
      reason: [
        ROOM_STATE_ACTIONS[room.state],
        ...extras,
      ].join(' · '),
      action: ROOM_STATE_ACTIONS[room.state],
      href: `/habitaciones/${room.number}`,
    });
  }

  for (const alert of input.alerts) {
    const score =
      alert.level === 'CRITICA' ? 98 : alert.level === 'ATENCION' ? 82 : 55;
    items.push({
      id: `alert:${alert.id}`,
      kind: 'alert',
      tone: toneForScore(score),
      score,
      title: alert.title,
      reason: alert.message?.trim() || 'Alerta activa del motor de reglas.',
      action: 'Revisar y resolver la alerta.',
      href: '/libro?clase=alert',
    });
  }

  for (const task of input.overdueTasks) {
    const score = 90 + PRIORITY_BONUS[task.priority];
    items.push({
      id: `task:${task.id}`,
      kind: 'task',
      tone: toneForScore(score),
      score,
      title: task.title,
      reason: 'Tarea vencida.',
      action: 'Resolver, reasignar o reprogramar.',
      href: `/tareas/${task.id}`,
    });
  }

  for (const entry of input.criticalEntries) {
    const score = (entry.overdue ? 91 : 84) + PRIORITY_BONUS[entry.priority];
    items.push({
      id: `entry:${entry.id}`,
      kind: 'entry',
      tone: toneForScore(score),
      score,
      title: `#${entry.seq} · ${entry.title}`,
      reason: entry.overdue
        ? 'Registro operativo vencido.'
        : `Prioridad ${entry.priority.toLowerCase()}.`,
      action: 'Revisar el registro y dejar una resolución o siguiente paso.',
      href: `/libro/${entry.id}`,
    });
  }

  for (const followUp of input.followUps) {
    const overdue = followUp.status === 'VENCIDO';
    const score = overdue ? 88 : 62;
    items.push({
      id: `followup:${followUp.id}`,
      kind: 'followup',
      tone: toneForScore(score),
      score,
      title: followUp.action,
      reason: overdue ? 'Seguimiento vencido.' : 'Seguimiento pendiente.',
      action: overdue ? 'Ejecutar o reprogramar el seguimiento.' : 'Preparar el siguiente contacto.',
      href: '/libro?clase=followup',
    });
  }

  return items
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'es'))
    .slice(0, Math.max(1, limit));
}
