import { z } from 'zod';
import {
  AlertLevel,
  AlertType,
  EntryStatus,
  EntryType,
  FollowUpStatus,
  GuaranteeStatus,
  Impact,
  Priority,
  ReservationStatus,
  Severity,
  ShiftType,
  TaskStatus,
} from '@prisma/client';
import {
  zCheckbox,
  zOptionalCuid,
  zOptionalDate,
  zOptionalString,
  zRequiredString,
  zTags,
} from '@/server/action';

/** Esquemas de validación de servidor. La interfaz nunca es la única barrera. */

export const entryCreateSchema = z.object({
  type: z.nativeEnum(EntryType),
  title: zRequiredString(200, 'El título'),
  description: z
    .string()
    .trim()
    .min(5, 'La descripción debe tener al menos 5 caracteres')
    .max(8000),
  category: zOptionalString,
  departmentId: zOptionalCuid,
  roomId: zOptionalCuid,
  priority: z.nativeEnum(Priority).default(Priority.MEDIA),
  ownerId: zOptionalCuid,
  occurredAt: zOptionalDate,
  dueAt: zOptionalDate,
  tags: zTags,
  requiresFollowUp: zCheckbox,
  guestId: zOptionalCuid,
  reservationId: zOptionalCuid,
  // Específicos de incidencia
  severity: z.nativeEnum(Severity).optional(),
  impact: z.nativeEnum(Impact).optional(),
  immediateAction: zOptionalString,
});

/**
 * Una incidencia sin contexto no sirve: nadie sabe dónde ir. Se exige
 * habitación o área, y la comprobación vive en el esquema para que valga tanto
 * en el formulario como en cualquier otra vía de creación.
 */
const REQUIRES_CONTEXT: EntryType[] = [EntryType.INCIDENCIA, EntryType.MANTENIMIENTO];

function hasContext(data: { type?: EntryType; roomId?: unknown; departmentId?: unknown }): boolean {
  if (!data.type || !REQUIRES_CONTEXT.includes(data.type)) return true;
  return Boolean(data.roomId) || Boolean(data.departmentId);
}

const CONTEXT_MESSAGE =
  'Indica la habitación o el área a la que corresponde: una incidencia sin contexto no puede atenderse.';

export const entryCreateWithContextSchema = entryCreateSchema.superRefine((data, ctx) => {
  if (hasContext(data)) return;
  for (const path of ['roomId', 'departmentId'] as const) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: CONTEXT_MESSAGE });
  }
});

export const entryUpdateSchema = entryCreateSchema.partial().extend({
  id: z.string().min(1),
  status: z.nativeEnum(EntryStatus).optional(),
  rootCause: zOptionalString,
  resolution: zOptionalString,
});

export const entryUpdateWithContextSchema = entryUpdateSchema.superRefine((data, ctx) => {
  // En la edición sólo se exige contexto si el tipo viene en el formulario.
  if (!data.type || hasContext(data)) return;
  for (const path of ['roomId', 'departmentId'] as const) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: CONTEXT_MESSAGE });
  }
});

export const entryStatusSchema = z.object({
  id: z.string().min(1),
  status: z.nativeEnum(EntryStatus),
  reason: zOptionalString,
  resolution: zOptionalString,
  rootCause: zOptionalString,
});

export const taskCreateSchema = z.object({
  title: zRequiredString(200, 'El título'),
  description: zOptionalString,
  assigneeId: zOptionalCuid,
  priority: z.nativeEnum(Priority).default(Priority.MEDIA),
  dueAt: zOptionalDate,
  departmentId: zOptionalCuid,
  entryId: zOptionalCuid,
  followUpId: zOptionalCuid,
  alertId: zOptionalCuid,
  handoverId: zOptionalCuid,
  tags: zTags,
  checklist: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (!v) return [] as string[];
      const raw = Array.isArray(v) ? v : v.split('\n');
      return raw.map((t) => t.trim()).filter((t) => t.length > 0).slice(0, 30);
    }),
});

export const taskUpdateSchema = taskCreateSchema.partial().extend({
  id: z.string().min(1),
  status: z.nativeEnum(TaskStatus).optional(),
  blockedReason: zOptionalString,
});

export const taskStatusSchema = z.object({
  id: z.string().min(1),
  status: z.nativeEnum(TaskStatus),
  blockedReason: zOptionalString,
  reason: zOptionalString,
});

export const taskAssignSchema = z.object({
  id: z.string().min(1),
  assigneeId: zOptionalCuid,
  reason: zOptionalString,
});

export const followUpCreateSchema = z.object({
  entryId: zOptionalCuid,
  taskId: zOptionalCuid,
  action: zRequiredString(300, 'La acción'),
  result: zOptionalString,
  nextAction: zOptionalString,
  scheduledAt: zOptionalDate,
  ownerId: zOptionalCuid,
  notes: zOptionalString,
});

export const followUpUpdateSchema = z.object({
  id: z.string().min(1),
  result: zOptionalString,
  nextAction: zOptionalString,
  scheduledAt: zOptionalDate,
  notes: zOptionalString,
  status: z.nativeEnum(FollowUpStatus).optional(),
  ownerId: zOptionalCuid,
});

export const commentSchema = z.object({
  body: z.string().trim().min(1, 'El comentario no puede estar vacío').max(4000),
  entryId: zOptionalCuid,
  taskId: zOptionalCuid,
  followUpId: zOptionalCuid,
  alertId: zOptionalCuid,
  handoverId: zOptionalCuid,
});

export const alertCreateSchema = z.object({
  type: z.nativeEnum(AlertType),
  level: z.nativeEnum(AlertLevel).default(AlertLevel.ATENCION),
  title: zRequiredString(200, 'El título'),
  message: zOptionalString,
  dueAt: zOptionalDate,
  entryId: zOptionalCuid,
  taskId: zOptionalCuid,
  reservationId: zOptionalCuid,
  guestId: zOptionalCuid,
  departmentId: zOptionalCuid,
});

export const alertActionSchema = z.object({
  id: z.string().min(1),
  note: zOptionalString,
  snoozeMinutes: z.coerce.number().int().min(5).max(1440).optional(),
});

export const softDeleteSchema = z.object({
  id: z.string().min(1),
  reason: z
    .string()
    .trim()
    .min(5, 'Indica el motivo de la eliminación (mínimo 5 caracteres)')
    .max(500),
});

export const restoreSchema = z.object({
  id: z.string().min(1),
  reason: zOptionalString,
});

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Ingresa un correo válido'),
  password: z.string().min(1, 'Ingresa tu contraseña'),
});

export const guestSchema = z.object({
  id: zOptionalCuid,
  fullName: zRequiredString(150, 'El nombre'),
  roomNumber: zOptionalString,
  documentId: zOptionalString,
  email: zOptionalString,
  phone: zOptionalString,
  language: zOptionalString,
  vip: zCheckbox,
  notes: zOptionalString,
});

export const reservationSchema = z.object({
  id: zOptionalCuid,
  code: z.string().trim().min(2, 'El código es obligatorio').max(40),
  guestId: zOptionalCuid,
  roomNumber: zOptionalString,
  checkIn: zOptionalDate,
  checkOut: zOptionalDate,
  channel: zOptionalString,
  status: z.nativeEnum(ReservationStatus).default(ReservationStatus.PENDIENTE),
  guaranteeStatus: z.nativeEnum(GuaranteeStatus).default(GuaranteeStatus.NO_REQUIERE),
  balanceDue: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === '' || v === undefined || v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }),
  requiresAction: zCheckbox,
  actionNote: zOptionalString,
  notes: zOptionalString,
});

/* --------------------------------- Garantías -------------------------------- */

const zMoney = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value : Number(value.replace(/[^\d.-]/g, ''))))
  .refine((value) => Number.isFinite(value) && value >= 0, 'Monto inválido');

export const guaranteeCreateSchema = z.object({
  reservationReferenceId: z.string().min(1, 'Selecciona la reserva'),
  kind: z.enum(['TARJETA', 'EFECTIVO', 'TRANSFERENCIA', 'VOUCHER', 'CARTA_EMPRESA', 'OTRO']),
  amount: zMoney.refine((value) => value > 0, 'El monto debe ser mayor que cero'),
  /** Código ISO de tres letras. La operación es en CLP, pero no sólo. */
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .default('CLP')
    .refine((value) => /^[A-Z]{3}$/.test(value), 'Usa el código de tres letras, como CLP o USD'),
  state: z.enum(['PENDIENTE', 'VIGENTE']).optional(),
  notes: zOptionalString,
});

export const guaranteeStateSchema = z.object({
  id: z.string().min(1),
  state: z.enum(['PENDIENTE', 'VIGENTE', 'DEVUELTA', 'APLICADA_PARCIALMENTE', 'MULTA', 'CERRADA']),
  appliedAmount: zMoney.optional(),
  applicationReason: zOptionalString,
  penaltyAmount: zMoney.optional(),
  notes: zOptionalString,
});

export const guaranteeDeleteSchema = z.object({
  id: z.string().min(1),
  reason: zRequiredString(500, 'El motivo'),
});

export const userCreateSchema = z.object({
  name: zRequiredString(120, 'El nombre'),
  email: z.string().trim().toLowerCase().email('Correo inválido'),
  /**
   * Opcional: si no se escribe, el sistema lo propone a partir del nombre
   * (inicial más apellido, del estilo EHerrera).
   */
  username: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@+/, '').replace(/\s+/g, ''))
    .refine(
      (value) => value === '' || /^[A-Za-z][A-Za-z0-9._-]{2,29}$/.test(value),
      'El usuario empieza con letra y usa entre 3 y 30 caracteres, sin espacios',
    )
    .optional(),
  roleId: z.string().min(1, 'Selecciona un rol'),
  departmentId: zOptionalCuid,
  phone: zOptionalString,
});

export const userUpdateSchema = z.object({
  id: z.string().min(1),
  name: zRequiredString(120, 'El nombre'),
  email: z.string().trim().toLowerCase().email('Correo inválido'),
  roleId: z.string().min(1),
  departmentId: zOptionalCuid,
  phone: zOptionalString,
  active: zCheckbox,
});

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, 'Ingresa tu contraseña actual'),
    newPassword: z.string().min(1),
    confirmPassword: z.string().min(1),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword'],
  });

export const shiftScheduleSchema = z.object({
  date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha inválida'),
  type: z.nativeEnum(ShiftType),
  userIds: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]).filter((x) => x.length > 0)),
  notes: zOptionalString,
});

export const departmentSchema = z.object({
  id: zOptionalCuid,
  key: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Usa mayúsculas, números y guion bajo'),
  name: zRequiredString(80, 'El nombre'),
  order: z.coerce.number().int().min(0).max(999).default(0),
  active: zCheckbox,
});

export const rolePermissionsSchema = z.object({
  roleId: z.string().min(1),
  permissions: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v ? (Array.isArray(v) ? v : [v]) : [])),
});

export const settingSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
});
