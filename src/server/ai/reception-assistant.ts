import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { FollowUpStatus, Priority } from '@prisma/client';
import type { CurrentUser } from '@/server/auth/current-user';
import { env } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { ENTRY_OPEN_STATUSES, TASK_OPEN_STATUSES } from '@/domain/labels';
import {
  ASSISTANT_FAILURE_MESSAGE,
  ASSISTANT_TIMEOUT_MS,
  classifyAssistantFailure,
  type AssistantFailure,
} from '@/domain/assistant-status';
import {
  fineProblems,
  type FineDraft,
  type FineKindValue,
  type LinenKindValue,
} from '@/domain/fines';
import { getRoomDetail, confirmCheckOutBatch } from '@/server/services/rooms';
import { getDashboardData } from '@/server/services/dashboard';
import { fineContextForRoom, createFine } from '@/server/services/fines';
import { createTask } from '@/server/services/tasks';
import {
  frontiToolSettingForFunction,
  getFrontiConfig,
  type FrontiConfig,
} from './fronti-config';

export type AssistantMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AssistantConfirmation = {
  token: string;
  title: string;
  detail: string;
  risk: 'normal' | 'high';
};

export type AssistantResult = {
  reply: string;
  confirmations: AssistantConfirmation[];
};

type OpenAIOutputItem = {
  type?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  content?: Array<{ type?: string; text?: string }>;
  [key: string]: unknown;
};

type OpenAIResponse = {
  output?: OpenAIOutputItem[];
  error?: { message?: string };
};

type PendingAction =
  | {
      version: 1;
      userId: string;
      action: 'confirm_checkouts';
      expiresAt: number;
      args: { roomNumbers: string[]; note?: string | null };
    }
  | {
      version: 1;
      userId: string;
      action: 'create_reminder';
      expiresAt: number;
      args: {
        title: string;
        description?: string | null;
        dueAt: string;
        priority: 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
      };
    }
  | {
      version: 1;
      userId: string;
      action: 'create_fine';
      expiresAt: number;
      args: {
        roomNumber: string;
        kind: FineKindValue;
        linenKind?: LinenKindValue | null;
        itemDetail?: string | null;
        stainType?: string | null;
        reason: string;
        guestStatement?: string | null;
        amount?: number | null;
        currency?: string;
      };
    };

const MAX_TOOL_LOOPS = 5;
const CONFIRMATION_TTL_MS = 10 * 60 * 1000;

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'consultar_habitacion',
    description:
      'Consulta el estado operativo actual de una habitación, su salida, ocupante, entrada, llaves, incidencias y garantías. No modifica nada.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        roomNumber: { type: 'string', description: 'Número de habitación, por ejemplo 415.' },
      },
      required: ['roomNumber'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'consultar_prioridades',
    description:
      'Obtiene el panorama operativo para sugerir qué revisar primero: habitaciones que requieren acción, tareas vencidas, alertas, seguimientos e incidencias críticas. No modifica nada.',
    strict: true,
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function',
    name: 'consultar_vencimientos',
    description:
      'Lista próximos vencimientos de tareas, seguimientos y registros operativos. Úsala cuando pregunten qué vence pronto o qué está por vencer.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        hours: {
          type: 'integer',
          minimum: 1,
          maximum: 168,
          description: 'Horizonte en horas. Usa 24 si el usuario no especifica otro.',
        },
      },
      required: ['hours'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'proponer_checkouts',
    description:
      'Prepara la confirmación de salida de una o más habitaciones. Nunca afirmes que el check-out fue realizado hasta que el usuario confirme la tarjeta de acción.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        roomNumbers: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: { type: 'string' },
        },
        note: { type: ['string', 'null'] },
      },
      required: ['roomNumbers', 'note'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'proponer_recordatorio',
    description:
      'Prepara una tarea-recordatorio asignada al usuario actual con fecha y hora. Requiere confirmación antes de crearla.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 200 },
        description: { type: ['string', 'null'], maxLength: 2000 },
        dueAt: {
          type: 'string',
          description:
            'Fecha y hora ISO 8601 con zona horaria explícita, por ejemplo 2026-09-16T18:30:00-03:00.',
        },
        priority: { type: 'string', enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] },
      },
      required: ['title', 'description', 'dueAt', 'priority'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'proponer_multa',
    description:
      'Prepara una multa para una habitación usando el contexto real de la estadía. Requiere permiso de gestión de incidencias y confirmación. Nunca inventes monto, tipo de daño ni antecedentes.',
    strict: true,
    parameters: {
      type: 'object',
      properties: {
        roomNumber: { type: 'string' },
        kind: { type: 'string', enum: ['BLANCO', 'DANO', 'FALTANTE', 'OTRO'] },
        linenKind: {
          type: ['string', 'null'],
          enum: [
            'TOALLA_MANO',
            'TOALLA_CUERPO',
            'TOALLA_PISO',
            'SABANA',
            'FUNDA_ALMOHADA',
            'CUBRECAMA',
            'PROTECTOR_COLCHON',
            'BATA',
            'MANTEL',
            'CORTINA',
            'OTRO',
            null,
          ],
        },
        itemDetail: { type: ['string', 'null'] },
        stainType: { type: ['string', 'null'] },
        reason: { type: 'string', minLength: 3, maxLength: 2000 },
        guestStatement: { type: ['string', 'null'] },
        amount: {
          type: ['number', 'null'],
          description: 'Monto sólo si el usuario lo indicó. Si no lo indicó, null.',
        },
        currency: { type: 'string', enum: ['CLP', 'USD'] },
      },
      required: [
        'roomNumber',
        'kind',
        'linenKind',
        'itemDetail',
        'stainType',
        'reason',
        'guestStatement',
        'amount',
        'currency',
      ],
      additionalProperties: false,
    },
  },
] as const;

function enabledToolDefinitions(config: FrontiConfig) {
  return TOOL_DEFINITIONS.filter((definition) => {
    const key = frontiToolSettingForFunction(definition.name);
    return key ? config.tools[key] : false;
  });
}

function assertToolEnabled(config: FrontiConfig, functionName: string) {
  const key = frontiToolSettingForFunction(functionName);
  if (!key || !config.tools[key]) {
    throw new Error('Esta capacidad de Fronti está desactivada por el Administrador de sistema.');
  }
}

function hasPermission(user: CurrentUser, permission: string): boolean {
  return user.permissions.some((value) => value === permission);
}

function requireToolPermission(user: CurrentUser, permission: string) {
  if (!hasPermission(user, permission)) {
    throw new Error(`No tienes el permiso necesario (${permission}) para esa acción.`);
  }
}

function signAction(action: PendingAction): string {
  const body = Buffer.from(JSON.stringify(action)).toString('base64url');
  const signature = createHmac('sha256', env().AUTH_SECRET).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyAction(token: string, user: CurrentUser): PendingAction {
  const [body, signature] = token.split('.');
  if (!body || !signature) throw new Error('La confirmación no es válida.');

  const expected = createHmac('sha256', env().AUTH_SECRET).update(body).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    throw new Error('La confirmación no es válida.');
  }
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error('La confirmación no es válida.');
  }

  let parsed: PendingAction;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as PendingAction;
  } catch {
    throw new Error('La confirmación no es válida.');
  }
  if (parsed.version !== 1 || parsed.userId !== user.id) {
    throw new Error('Esta confirmación pertenece a otra sesión.');
  }
  if (parsed.expiresAt < Date.now()) {
    throw new Error('La confirmación venció. Vuelve a pedir la acción.');
  }
  return parsed;
}

function makeConfirmation(
  user: CurrentUser,
  action: 'confirm_checkouts' | 'create_reminder' | 'create_fine',
  args: PendingAction['args'],
  title: string,
  detail: string,
  risk: AssistantConfirmation['risk'],
): AssistantConfirmation {
  const payload = {
    version: 1,
    userId: user.id,
    expiresAt: Date.now() + CONFIRMATION_TTL_MS,
    action,
    args,
  } as PendingAction;
  return { token: signAction(payload), title, detail, risk };
}

function cleanRoomNumber(value: unknown): string {
  return String(value ?? '').trim();
}

function compactStay(stay: { id: string; reservationId: string; guestNames: string[] } | null) {
  return stay
    ? { stayId: stay.id, reservationId: stay.reservationId, guests: stay.guestNames }
    : null;
}

async function roomTool(user: CurrentUser, args: Record<string, unknown>) {
  requireToolPermission(user, 'room.view');
  const room = await getRoomDetail(cleanRoomNumber(args.roomNumber));
  return {
    room: room.number,
    state: room.snapshot.state,
    outgoing: compactStay(room.snapshot.outgoing),
    current: compactStay(room.snapshot.current),
    incoming: compactStay(room.snapshot.incoming),
    incomingState: room.snapshot.incomingState,
    openIncidents: room.openIncidents,
    keysOut: room.snapshot.keysOut.map((key) => ({ code: key.code, status: key.status })),
    reservations: room.reservations.map((reservation) => ({
      stayId: reservation.stayId,
      code: reservation.code,
      guestName: reservation.guestName,
      vip: reservation.vip,
      status: reservation.status,
      guaranteeSummary: reservation.guaranteeSummary,
      balanceDue: reservation.balanceDue,
      guarantees: reservation.guarantees.map((guarantee) => ({
        state: guarantee.state,
        kind: guarantee.kind,
        amount: guarantee.amount,
        currency: guarantee.currency,
      })),
    })),
  };
}

async function prioritiesTool(user: CurrentUser) {
  if (!hasPermission(user, 'metrics.view') && !hasPermission(user, 'room.view')) {
    throw new Error('No tienes permiso para consultar el panorama operativo.');
  }
  const data = await getDashboardData(user);
  return {
    counters: data.counters,
    rooms: data.roomsNeedingAction.map((room) => ({
      room: room.number,
      state: room.snapshot.state,
      openIncidents: room.openIncidents,
      keysOut: room.snapshot.keysOut.length,
    })),
    overdueTasks: data.overdueTasks.map((task) => ({
      id: task.id,
      title: task.title,
      priority: task.priority,
      dueAt: task.dueAt,
      assignee: task.assignee?.name ?? null,
    })),
    alerts: data.alerts.map((alert) => ({
      id: alert.id,
      level: alert.level,
      title: alert.title,
      message: alert.message,
      dueAt: alert.dueAt,
    })),
    followUps: data.followUps.map((followUp) => ({
      id: followUp.id,
      action: followUp.action,
      scheduledAt: followUp.scheduledAt,
      status: followUp.status,
      owner: followUp.owner?.name ?? null,
    })),
    criticalEntries: data.criticalEntries.map((entry) => ({
      seq: entry.seq,
      title: entry.title,
      priority: entry.priority,
      dueAt: entry.dueAt,
      owner: entry.owner?.name ?? null,
    })),
  };
}

async function deadlinesTool(user: CurrentUser, args: Record<string, unknown>) {
  if (!hasPermission(user, 'metrics.view') && !hasPermission(user, 'task.create')) {
    throw new Error('No tienes permiso para consultar vencimientos operativos.');
  }
  const requested = Number(args.hours ?? 24);
  const hours = Number.isFinite(requested)
    ? Math.min(168, Math.max(1, Math.round(requested)))
    : 24;
  const now = new Date();
  const until = new Date(now.getTime() + hours * 60 * 60 * 1000);

  const [tasks, followUps, entries] = await Promise.all([
    prisma.task.findMany({
      where: {
        deletedAt: null,
        status: { in: TASK_OPEN_STATUSES },
        dueAt: { not: null, lte: until },
      },
      select: {
        id: true,
        seq: true,
        title: true,
        priority: true,
        dueAt: true,
        assignee: { select: { name: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: 30,
    }),
    prisma.followUp.findMany({
      where: {
        deletedAt: null,
        status: { in: [FollowUpStatus.PENDIENTE, FollowUpStatus.VENCIDO] },
        scheduledAt: { lte: until },
      },
      select: {
        id: true,
        action: true,
        scheduledAt: true,
        status: true,
        owner: { select: { name: true } },
        entry: { select: { seq: true } },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 30,
    }),
    prisma.operationalEntry.findMany({
      where: {
        deletedAt: null,
        status: { in: ENTRY_OPEN_STATUSES },
        dueAt: { not: null, lte: until },
      },
      select: {
        id: true,
        seq: true,
        title: true,
        priority: true,
        dueAt: true,
        owner: { select: { name: true } },
      },
      orderBy: [{ dueAt: 'asc' }, { priority: 'desc' }],
      take: 30,
    }),
  ]);

  const items = [
    ...tasks.map((item) => ({
      type: 'tarea',
      id: item.id,
      ref: `T#${item.seq}`,
      title: item.title,
      priority: item.priority,
      at: item.dueAt,
      owner: item.assignee?.name ?? null,
    })),
    ...followUps.map((item) => ({
      type: 'seguimiento',
      id: item.id,
      ref: item.entry ? `#${item.entry.seq}` : null,
      title: item.action,
      priority: item.status === FollowUpStatus.VENCIDO ? 'CRITICA' : 'MEDIA',
      at: item.scheduledAt,
      owner: item.owner?.name ?? null,
    })),
    ...entries.map((item) => ({
      type: 'registro',
      id: item.id,
      ref: `#${item.seq}`,
      title: item.title,
      priority: item.priority,
      at: item.dueAt,
      owner: item.owner?.name ?? null,
    })),
  ]
    .filter((item) => item.at !== null)
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
    .slice(0, 40);

  return { now, until, hours, items };
}

async function checkoutsProposalTool(user: CurrentUser, args: Record<string, unknown>) {
  requireToolPermission(user, 'room.manage');
  const raw = Array.isArray(args.roomNumbers) ? args.roomNumbers : [];
  const roomNumbers = Array.from(new Set(raw.map(cleanRoomNumber).filter(Boolean))).slice(0, 20);
  if (!roomNumbers.length) throw new Error('Indica al menos una habitación.');

  const rooms = await Promise.all(roomNumbers.map((roomNumber) => getRoomDetail(roomNumber)));
  const invalid = rooms.filter((room) => !room.snapshot.outgoing);
  if (invalid.length) {
    return {
      status: 'needs_info',
      message: `No hay una salida pendiente para: ${invalid.map((room) => room.number).join(', ')}. No se preparó ningún check-out.`,
      rooms: rooms.map((room) => ({ room: room.number, state: room.snapshot.state })),
    };
  }

  const note = typeof args.note === 'string' && args.note.trim() ? args.note.trim() : null;
  const confirmation = makeConfirmation(
    user,
    'confirm_checkouts',
    { roomNumbers, note },
    `Confirmar ${roomNumbers.length === 1 ? 'check-out' : `${roomNumbers.length} check-outs`}`,
    `Habitaciones: ${roomNumbers.join(', ')}${note ? ` · Nota: ${note}` : ''}`,
    'high',
  );
  return {
    status: 'confirmation_required',
    message: 'La salida está preparada y todavía no se ha ejecutado.',
    confirmation,
  };
}

async function reminderProposalTool(user: CurrentUser, args: Record<string, unknown>) {
  requireToolPermission(user, 'task.create');
  const title = String(args.title ?? '').trim();
  const description =
    typeof args.description === 'string' && args.description.trim() ? args.description.trim() : null;
  const dueAt = String(args.dueAt ?? '').trim();
  const date = new Date(dueAt);
  if (title.length < 3) throw new Error('El recordatorio necesita un título.');
  if (!dueAt || Number.isNaN(date.getTime())) {
    throw new Error('No pude determinar una fecha y hora válida para el recordatorio.');
  }
  if (date.getTime() <= Date.now() - 60_000) {
    throw new Error('La hora del recordatorio ya pasó.');
  }
  const priority = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'].includes(String(args.priority))
    ? (String(args.priority) as 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA')
    : 'MEDIA';

  const confirmation = makeConfirmation(
    user,
    'create_reminder',
    { title, description, dueAt: date.toISOString(), priority },
    'Crear recordatorio',
    `${title} · ${date.toLocaleString('es-CL', { timeZone: env().HOTEL_TIMEZONE })}`,
    'normal',
  );
  return {
    status: 'confirmation_required',
    message: 'El recordatorio está preparado y todavía no se ha creado.',
    confirmation,
  };
}

async function fineProposalTool(user: CurrentUser, args: Record<string, unknown>) {
  requireToolPermission(user, 'incident.manage');
  const roomNumber = cleanRoomNumber(args.roomNumber);
  const context = await fineContextForRoom(roomNumber);
  const kind = String(args.kind ?? 'OTRO') as FineKindValue;
  const linenKind = (args.linenKind ?? null) as LinenKindValue | null;
  const itemDetail = typeof args.itemDetail === 'string' ? args.itemDetail.trim() || null : null;
  const stainType = typeof args.stainType === 'string' ? args.stainType.trim() || null : null;
  const reason = String(args.reason ?? '').trim();
  const guestStatement =
    typeof args.guestStatement === 'string' ? args.guestStatement.trim() || null : null;
  const amount = typeof args.amount === 'number' && Number.isFinite(args.amount) ? args.amount : null;
  const currency = args.currency === 'USD' ? 'USD' : 'CLP';

  const draft: FineDraft = {
    reservationCode: context.reservationCode,
    guestName: context.guestName,
    kind,
    linenKind,
    itemDetail,
    stainType,
    reason,
    guestStatement,
    amount,
  };
  const problems = fineProblems(draft);
  if (problems.length) {
    return {
      status: 'needs_info',
      roomNumber,
      context: {
        reservationCode: context.reservationCode || null,
        guestName: context.guestName || null,
      },
      missing: problems.map((problem) => ({ field: problem.field, message: problem.message })),
      instruction: 'Pide al usuario sólo los datos que faltan. No inventes ninguno.',
    };
  }

  const confirmation = makeConfirmation(
    user,
    'create_fine',
    {
      roomNumber,
      kind,
      linenKind,
      itemDetail,
      stainType,
      reason,
      guestStatement,
      amount,
      currency,
    },
    `Registrar multa · Hab. ${roomNumber}`,
    `${reason}${amount ? ` · ${currency} ${amount.toLocaleString('es-CL')}` : ' · Monto por definir'}`,
    'high',
  );
  return {
    status: 'confirmation_required',
    message: 'La multa está preparada y todavía no se ha registrado.',
    reservationCode: context.reservationCode,
    guestName: context.guestName,
    confirmation,
  };
}

async function executeTool(
  user: CurrentUser,
  name: string,
  args: Record<string, unknown>,
  config: FrontiConfig,
) {
  assertToolEnabled(config, name);
  switch (name) {
    case 'consultar_habitacion':
      return roomTool(user, args);
    case 'consultar_prioridades':
      return prioritiesTool(user);
    case 'consultar_vencimientos':
      return deadlinesTool(user, args);
    case 'proponer_checkouts':
      return checkoutsProposalTool(user, args);
    case 'proponer_recordatorio':
      return reminderProposalTool(user, args);
    case 'proponer_multa':
      return fineProposalTool(user, args);
    default:
      throw new Error('La herramienta solicitada no existe.');
  }
}

/**
 * Un fallo del asistente que ya sabe qué es y qué decirle al mesón.
 *
 * Lleva la causa además del texto para que el endpoint pueda elegir el estado
 * HTTP correcto y la pantalla pueda decidir si ofrece reintentar, sin volver a
 * adivinar leyendo el mensaje.
 */
export class AssistantError extends Error {
  readonly failure: AssistantFailure;

  constructor(failure: AssistantFailure, cause?: Error) {
    super(ASSISTANT_FAILURE_MESSAGE[failure]);
    this.name = 'AssistantError';
    this.failure = failure;
    // Se conserva el error original para el registro del servidor, no para la
    // pantalla: es donde vive el detalle técnico que el mesón no debe leer.
    if (cause) this.cause = cause;
  }
}

function responseText(response: OpenAIResponse): string {
  const chunks: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

async function callOpenAI(input: unknown[], config: FrontiConfig): Promise<OpenAIResponse> {
  const key = env().OPENAI_API_KEY;
  if (!key) {
    throw new AssistantError('SIN_CLAVE');
  }

  const tools = enabledToolDefinitions(config);
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    /*
      Sin plazo, una llamada colgada dejaba la pantalla del mesón esperando
      indefinidamente: no había timeout explícito y el `fetch` de Node no trae
      ninguno por omisión.
    */
    signal: AbortSignal.timeout(ASSISTANT_TIMEOUT_MS),
    body: JSON.stringify({
      model: config.model,
      store: false,
      reasoning: { effort: config.reasoningEffort },
      instructions:
        `Eres ${config.displayName}, el asistente operativo del Libro de Recepción del Hotel HW Libertad. ` +
        'Responde siempre en español claro, breve y operativo. Usa exclusivamente las herramientas disponibles para consultar o preparar acciones del Libro. ' +
        'Nunca inventes huéspedes, reservas, montos, habitaciones, fechas, pagos, garantías ni estados. ' +
        'Cuando una herramienta indique confirmation_required, la acción NO se ha ejecutado: explica que está preparada y que debe confirmarse en pantalla. ' +
        'Cuando indique needs_info, pide sólo lo que falta. Si falta un permiso, dilo sin sugerir cómo saltarlo. ' +
        `Zona horaria: ${env().HOTEL_TIMEZONE}. Hora de referencia: ${new Date().toLocaleString('es-CL', { timeZone: env().HOTEL_TIMEZONE })}. ` +
        'Para prioridades, usa los datos de las herramientas: vencido/crítico y bloqueos operativos primero. ' +
        'Para recordatorios con fechas relativas, conviértelas a ISO 8601 con la zona horaria del hotel. ' +
        `Instrucciones adicionales del Administrador de sistema: ${config.extraInstructions}`,
      input,
      tools: tools.length ? tools : undefined,
      tool_choice: tools.length ? 'auto' : undefined,
      parallel_tool_calls: false,
    }),
    cache: 'no-store',
    });
  } catch (error) {
    /*
      Acá sólo caen los fallos de transporte: plazo agotado o sin red. Un
      estado HTTP de error NO lanza, se comprueba más abajo.
    */
    const aborted = error instanceof Error && error.name === 'TimeoutError';
    throw new AssistantError(
      classifyAssistantFailure({ aborted, network: !aborted }),
      error instanceof Error ? error : undefined,
    );
  }

  /*
    El cuerpo puede no ser JSON —una pasarela caída devuelve HTML— así que
    parsear no puede tumbar la clasificación del fallo.
  */
  let payload: OpenAIResponse | null = null;
  try {
    payload = (await response.json()) as OpenAIResponse;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const apiError = payload?.error as
      | { message?: string; code?: string; type?: string }
      | undefined;
    throw new AssistantError(
      classifyAssistantFailure({
        status: response.status,
        code: apiError?.code ?? apiError?.type ?? null,
        message: apiError?.message ?? null,
      }),
    );
  }

  if (!payload) throw new AssistantError('CAIDO');
  return payload;
}

/**
 * Convierte el historial en la entrada que espera la API de respuestas.
 *
 * El tipo de la parte de contenido DEPENDE DEL ROL, y ahí estaba el fallo:
 * todos los mensajes salían como `input_text`, también los del asistente, y
 * para ésos la API sólo acepta `output_text`. La respuesta era un 400 con
 * «Invalid value: 'input_text'. Supported values are: 'output_text' and
 * 'refusal'.», que el pop-up pintaba tal cual en el chat del mesón.
 *
 * No era un caso raro: el saludo de Fronti es un mensaje de asistente y viaja
 * en el historial, así que la conversación fallaba desde la PRIMERA pregunta.
 * Fronti nunca contestó nada en producción.
 *
 * `responseText` ya leía `output_text` al interpretar la respuesta, de modo que
 * el archivo conocía la regla en un sentido y no en el otro.
 */
function messagesAsInput(messages: AssistantMessage[], limit: number): unknown[] {
  return messages.slice(-limit).map((message) => ({
    role: message.role,
    content: [
      {
        type: message.role === 'assistant' ? 'output_text' : 'input_text',
        text: message.content,
      },
    ],
  }));
}

export async function runReceptionAssistant(
  user: CurrentUser,
  messages: AssistantMessage[],
): Promise<AssistantResult> {
  const config = await getFrontiConfig();
  if (!config.enabled) {
    throw new AssistantError('DESACTIVADO');
  }

  let input = messagesAsInput(messages, config.modelHistoryLimit + 3);
  const confirmations: AssistantConfirmation[] = [];

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
    const response = await callOpenAI(input, config);
    const calls = (response.output ?? []).filter(
      (item): item is OpenAIOutputItem & { call_id: string; name: string; arguments: string } =>
        item.type === 'function_call' &&
        typeof item.call_id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.arguments === 'string',
    );

    if (!calls.length) {
      return {
        reply: responseText(response) || 'No pude formular una respuesta. Intenta decirlo de otra forma.',
        confirmations,
      };
    }

    const toolOutputs: Array<Record<string, unknown>> = [];
    for (const call of calls) {
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(call.arguments) as Record<string, unknown>;
      } catch {
        toolOutputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify({ ok: false, error: 'Los parámetros no eran JSON válido.' }),
        });
        continue;
      }

      try {
        const result = await executeTool(user, call.name, args, config);
        let modelResult: unknown = result;
        if (
          result &&
          typeof result === 'object' &&
          'confirmation' in result &&
          (result as { confirmation?: AssistantConfirmation }).confirmation
        ) {
          const card = (result as { confirmation: AssistantConfirmation }).confirmation;
          confirmations.push(card);
          modelResult = {
            ...(result as Record<string, unknown>),
            confirmation: { title: card.title, detail: card.detail, risk: card.risk },
          };
        }
        toolOutputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify({ ok: true, result: modelResult }),
        });
      } catch (error) {
        toolOutputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : 'La operación no pudo completarse.',
          }),
        });
      }
    }

    input = [...input, ...calls, ...toolOutputs];
  }

  return {
    reply: 'La solicitud requiere demasiados pasos automáticos. Divídela en dos instrucciones para evitar una ejecución ambigua.',
    confirmations,
  };
}

export async function executeReceptionConfirmation(
  user: CurrentUser,
  token: string,
): Promise<{ reply: string }> {
  const config = await getFrontiConfig();
  if (!config.enabled) {
    throw new AssistantError('DESACTIVADO');
  }

  const pending = verifyAction(token, user);

  if (pending.action === 'create_reminder') {
    assertToolEnabled(config, 'proponer_recordatorio');
    requireToolPermission(user, 'task.create');
    const dueAt = new Date(pending.args.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      throw new Error('La fecha del recordatorio dejó de ser válida.');
    }
    const task = await createTask(user, {
      title: pending.args.title,
      description: pending.args.description ?? null,
      assigneeId: user.id,
      priority: Priority[pending.args.priority],
      dueAt,
      departmentId: null,
      entryId: null,
      followUpId: null,
      alertId: null,
      handoverId: null,
      tags: ['recordatorio', 'fronti'],
      checklist: [],
    });
    return {
      reply: `Recordatorio creado: ${task.title} · ${dueAt.toLocaleString('es-CL', { timeZone: env().HOTEL_TIMEZONE })}.`,
    };
  }

  if (pending.action === 'create_fine') {
    assertToolEnabled(config, 'proponer_multa');
    requireToolPermission(user, 'incident.manage');
    const context = await fineContextForRoom(pending.args.roomNumber);
    const fine = await createFine(user, {
      roomNumber: pending.args.roomNumber,
      reservationCode: context.reservationCode,
      guestName: context.guestName,
      stayId: context.stayId,
      reservationReferenceId: context.reservationReferenceId,
      kind: pending.args.kind,
      linenKind: pending.args.linenKind ?? null,
      itemDetail: pending.args.itemDetail ?? null,
      stainType: pending.args.stainType ?? null,
      reason: pending.args.reason,
      guestStatement: pending.args.guestStatement ?? null,
      amount: pending.args.amount ?? null,
      currency: pending.args.currency ?? 'CLP',
    });
    return { reply: `Multa registrada para la habitación ${pending.args.roomNumber}. ID ${fine.id}.` };
  }

  assertToolEnabled(config, 'proponer_checkouts');
  requireToolPermission(user, 'room.manage');
  const validated: Array<{ roomNumber: string; stayId: string }> = [];
  for (const roomNumber of pending.args.roomNumbers) {
    const room = await getRoomDetail(roomNumber);
    if (!room.snapshot.outgoing) {
      throw new Error(`La habitación ${roomNumber} ya no tiene una salida pendiente. No se ejecutó el lote.`);
    }
    validated.push({ roomNumber, stayId: room.snapshot.outgoing.id });
  }

  await confirmCheckOutBatch(user, {
    items: validated.map((item) => ({
      stayId: item.stayId,
      note: pending.args.note ?? null,
    })),
  });
  return { reply: `Check-out confirmado: ${validated.map((item) => item.roomNumber).join(', ')}.` };
}
