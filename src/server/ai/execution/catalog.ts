import 'server-only';
import { z } from 'zod';
import type { ActionState } from '@/server/action';
import type { FrontiStep } from '@/domain/fronti-execution';
import { RuleError } from '@/server/errors';

export const FRONTI_ACTIONS = [
  {
    "module": "entries",
    "name": "createEntryAction",
    "label": "Crear novedad o incidencia",
    "fields": [
      "type",
      "title",
      "description",
      "category",
      "departmentId",
      "roomId",
      "priority",
      "ownerId",
      "occurredAt",
      "dueAt",
      "tags",
      "requiresFollowUp",
      "severity",
      "impact",
      "immediateAction"
    ],
    "permission": "entry.create",
    "risk": "normal",
    "physical": false
  },
  {
    "module": "tasks",
    "name": "createTaskAction",
    "label": "Crear tarea con lista de comprobación",
    "fields": [
      "title",
      "description",
      "assigneeId",
      "priority",
      "startsAt",
      "dueAt",
      "departmentId",
      "entryId",
      "followUpId",
      "fulfillmentCriteria",
      "evidenceRequired",
      "evidenceProvided",
      "targetType",
      "collaboratorIds",
      "targetShiftId",
      "roomId",
      "tags",
      "checklist"
    ],
    "permission": "task.create",
    "risk": "normal",
    "physical": false
  },
  {
    "module": "coordination",
    "name": "coordinateWorkAction",
    "label": "Asignar o recibir trabajo",
    "fields": [
      "kind",
      "id",
      "updatedAt",
      "requestKey",
      "action",
      "ownerId",
      "nextAction"
    ],
    "permission": "",
    "risk": "normal",
    "physical": false
  },
  {
    "module": "housekeeping",
    "name": "createHousekeepingAction",
    "label": "Crear solicitud de área",
    "fields": [
      "departmentId",
      "assignedToId",
      "requestKey",
      "title",
      "description",
      "sourceEntryId",
      "location",
      "priority",
      "dueAt"
    ],
    "permission": "",
    "risk": "normal",
    "physical": false
  },
  {
    "module": "housekeeping",
    "name": "changeHousekeepingAction",
    "label": "Gestionar solicitud de área",
    "fields": [
      "departmentId",
      "assignedToId",
      "id",
      "version",
      "action",
      "note",
      "dueAt"
    ],
    "permission": "",
    "risk": "normal",
    "physical": false
  },
  {
    "module": "housekeeping-work",
    "name": "createHkWorkAction",
    "label": "Crear trabajo de Housekeeping",
    "fields": [
      "departmentId",
      "requestKey",
      "title",
      "description",
      "workKind",
      "workDate",
      "roomId",
      "zoneId",
      "location",
      "priority",
      "dueAt",
      "effortMinutes",
      "requiresInspection",
      "assignedToId",
      "sourceEntryId"
    ],
    "permission": "",
    "risk": "normal",
    "physical": false
  },
  {
    "module": "housekeeping-work",
    "name": "changeHkWorkAction",
    "label": "Atender, inspeccionar o derivar a Mantenimiento",
    "fields": [
      "id",
      "version",
      "action",
      "severity",
      "note",
      "assignedToId",
      "dueAt"
    ],
    "permission": "",
    "risk": "normal",
    "physical": true
  },
  {
    "module": "housekeeping-work",
    "name": "saveHkRoutineAction",
    "label": "Guardar rutina",
    "fields": [
      "departmentId",
      "id",
      "version",
      "title",
      "description",
      "location",
      "effortMinutes",
      "requiresInspection",
      "active"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "housekeeping-work",
    "name": "prepareHkDayAction",
    "label": "Preparar rutinas del día",
    "fields": [
      "departmentId",
      "workDate"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "housekeeping-work",
    "name": "confirmHkAvailabilityAction",
    "label": "Registrar disponibilidad declarada",
    "fields": [
      "departmentId",
      "workDate",
      "userId",
      "available",
      "note"
    ],
    "permission": "",
    "risk": "normal",
    "physical": true
  },
  {
    "module": "housekeeping-work",
    "name": "saveHkHandoverAction",
    "label": "Preparar continuidad del área",
    "fields": [
      "departmentId",
      "requestKey",
      "workDate",
      "note"
    ],
    "permission": "",
    "risk": "normal",
    "physical": false
  },
  {
    "module": "housekeeping-work",
    "name": "receiveHkHandoverAction",
    "label": "Recibir continuidad del área",
    "fields": [
      "id"
    ],
    "permission": "",
    "risk": "normal",
    "physical": false
  },
  {
    "module": "housekeeping-work",
    "name": "acceptHkHandoverAction",
    "label": "Aceptar continuidad del área",
    "fields": [
      "id"
    ],
    "permission": "",
    "risk": "normal",
    "physical": false
  },
  {
    "module": "housekeeping-work",
    "name": "revokeHkDelegationAction",
    "label": "Revocar suplencia",
    "fields": [
      "id"
    ],
    "permission": "",
    "risk": "normal",
    "physical": false
  },
  {
    "module": "housekeeping-work",
    "name": "delegateHkAction",
    "label": "Delegar asignación o inspección temporal",
    "fields": [
      "departmentId",
      "userId",
      "permission",
      "startsAt",
      "endsAt",
      "reason"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "shifts",
    "name": "openShiftAction",
    "label": "Abrir turno",
    "fields": [
      "type",
      "continuity",
      "emergencyReason",
      "emergencyAccepted"
    ],
    "permission": "shift.start",
    "risk": "high",
    "physical": false
  },
  {
    "module": "shifts",
    "name": "addShiftMemberAction",
    "label": "Sumar participante",
    "fields": [
      "shiftId",
      "userId"
    ],
    "permission": "shift.assign",
    "risk": "high",
    "physical": true
  },
  {
    "module": "shifts",
    "name": "removeShiftMemberAction",
    "label": "Retirar participante",
    "fields": [
      "shiftId",
      "userId"
    ],
    "permission": "shift.assign",
    "risk": "high",
    "physical": true
  },
  {
    "module": "shifts",
    "name": "startReceptionShiftAction",
    "label": "Iniciar recepción de turno",
    "fields": [
      "handoverId",
      "type"
    ],
    "permission": "shift.receive",
    "risk": "high",
    "physical": true
  },
  {
    "module": "shifts",
    "name": "receiveHandoverAction",
    "label": "Recibir turno",
    "fields": [
      "handoverId",
      "observations"
    ],
    "permission": "shift.receive",
    "risk": "high",
    "physical": true
  },
  {
    "module": "shifts",
    "name": "prepareHandoverAction",
    "label": "Preparar entrega",
    "fields": [
      "shiftId"
    ],
    "permission": "shift.handover",
    "risk": "high",
    "physical": true
  },
  {
    "module": "shifts",
    "name": "confirmReceptionReviewStepAction",
    "label": "Registrar revisión de recepción",
    "fields": [
      "handoverId",
      "step",
      "urgentAcknowledged"
    ],
    "permission": "shift.receive",
    "risk": "high",
    "physical": true
  },
  {
    "module": "shifts",
    "name": "confirmHandoverReviewStepAction",
    "label": "Registrar revisión de entrega",
    "fields": [
      "handoverId",
      "step",
      "urgentAcknowledged"
    ],
    "permission": "shift.handover",
    "risk": "high",
    "physical": true
  },
  {
    "module": "shifts",
    "name": "sendHandoverAction",
    "label": "Enviar entrega",
    "fields": [
      "shiftId",
      "notes"
    ],
    "permission": "shift.handover",
    "risk": "high",
    "physical": true
  },
  {
    "module": "shifts",
    "name": "cancelHandoverPreparationAction",
    "label": "Cancelar pasos de entrega",
    "fields": [
      "shiftId"
    ],
    "permission": "shift.handover",
    "risk": "high",
    "physical": true
  },
  {
    "module": "shifts",
    "name": "closeShiftAction",
    "label": "Validar cierre",
    "fields": [
      "shiftId",
      "notes"
    ],
    "permission": "shift.close",
    "risk": "high",
    "physical": true
  },
  {
    "module": "cash-closure",
    "name": "closeShiftCashAction",
    "label": "Cerrar Caja",
    "fields": [
      "shiftId",
      "notes"
    ],
    "permission": "cash.close",
    "risk": "high",
    "physical": false
  },
  {
    "module": "cash-closure",
    "name": "reopenShiftCashAction",
    "label": "Reabrir Caja",
    "fields": [
      "shiftId",
      "reason"
    ],
    "permission": "cash.reopen",
    "risk": "high",
    "physical": false
  },
  {
    "module": "live-cash",
    "name": "createManualCashMovementAction",
    "label": "Registrar movimiento de Caja",
    "fields": [
      "direction",
      "currency",
      "amount",
      "reference",
      "effectiveAt",
      "notes",
      "effectiveDateConfirmed"
    ],
    "permission": "",
    "risk": "high",
    "physical": true
  },
  {
    "module": "live-cash",
    "name": "returnCashGuaranteeAction",
    "label": "Registrar devolución de garantía",
    "fields": [
      "guaranteeId",
      "confirmed"
    ],
    "permission": "cash.guarantee_out",
    "risk": "high",
    "physical": true
  },
  {
    "module": "live-cash",
    "name": "chargeCashGuaranteeAction",
    "label": "Aplicar garantía",
    "fields": [
      "guaranteeId",
      "concept",
      "notes",
      "confirmed"
    ],
    "permission": "",
    "risk": "high",
    "physical": true
  },
  {
    "module": "key-inventory",
    "name": "createPhysicalKeyAction",
    "label": "Registrar llave",
    "fields": [
      "code",
      "roomId",
      "type",
      "notes"
    ],
    "permission": "",
    "risk": "high",
    "physical": true
  },
  {
    "module": "key-inventory",
    "name": "assignPhysicalKeyAction",
    "label": "Registrar entrega de llave",
    "fields": [
      "keyId",
      "roomId",
      "note"
    ],
    "permission": "",
    "risk": "high",
    "physical": true
  },
  {
    "module": "key-inventory",
    "name": "returnPhysicalKeyAction",
    "label": "Registrar devolución de llave",
    "fields": [
      "keyId",
      "note"
    ],
    "permission": "",
    "risk": "high",
    "physical": true
  },
  {
    "module": "key-inventory",
    "name": "markPhysicalKeyIncidentAction",
    "label": "Informar problema de llave",
    "fields": [
      "keyId",
      "status",
      "reason"
    ],
    "permission": "",
    "risk": "high",
    "physical": true
  },
  {
    "module": "key-inventory",
    "name": "recoverPhysicalKeyAction",
    "label": "Registrar recuperación de llave",
    "fields": [
      "keyId",
      "note"
    ],
    "permission": "",
    "risk": "high",
    "physical": true
  },
  {
    "module": "key-inventory",
    "name": "retirePhysicalKeyAction",
    "label": "Dar de baja una llave",
    "fields": [
      "keyId",
      "reason"
    ],
    "permission": "",
    "risk": "high",
    "physical": true
  },
  {
    "module": "key-staff",
    "name": "returnStaffKeyAction",
    "label": "Registrar devolución del personal",
    "fields": [
      "itemId",
      "notes"
    ],
    "permission": "key.assign",
    "risk": "high",
    "physical": true
  },
  {
    "module": "key-staff",
    "name": "saveKeyAreaAction",
    "label": "Configurar área de llaves",
    "fields": [
      "id",
      "name",
      "active"
    ],
    "permission": "key.stock",
    "risk": "high",
    "physical": false
  },
  {
    "module": "key-staff",
    "name": "createAreaKeyAction",
    "label": "Registrar llave de área",
    "fields": [
      "areaId",
      "code"
    ],
    "permission": "key.stock",
    "risk": "normal",
    "physical": false
  },
  {
    "module": "schedule",
    "name": "createSchedulePlanAction",
    "label": "Crear malla",
    "fields": [
      "departmentId",
      "startDate",
      "endDate"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "schedule",
    "name": "addScheduleSlotAction",
    "label": "Agregar jornada",
    "fields": [
      "planId",
      "version",
      "requestKey",
      "reason",
      "collaboratorId",
      "templateId",
      "date",
      "kind",
      "extraKind",
      "extraMinutes",
      "note",
      "replaceSlotId"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "schedule",
    "name": "moveScheduleSlotAction",
    "label": "Mover jornada",
    "fields": [
      "planId",
      "version",
      "requestKey",
      "reason",
      "slotId",
      "targetCollaboratorId",
      "targetDate",
      "mode",
      "targetSlotId"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "schedule",
    "name": "cancelScheduleSlotAction",
    "label": "Cancelar jornada",
    "fields": [
      "planId",
      "version",
      "requestKey",
      "reason",
      "slotId"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "schedule",
    "name": "publishSchedulePlanAction",
    "label": "Publicar malla",
    "fields": [
      "planId",
      "version",
      "requestKey",
      "reason"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "schedule",
    "name": "acknowledgeScheduleAction",
    "label": "Confirmar recepción de horario",
    "fields": [
      "planId",
      "version"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "schedule",
    "name": "applyScheduleImportAction",
    "label": "Incorporar malla revisada",
    "fields": [
      "planId",
      "version",
      "requestKey",
      "reason",
      "importId"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "schedule",
    "name": "refreshScheduleImportAction",
    "label": "Revisar importación",
    "fields": [
      "importId"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "admin",
    "name": "saveDepartmentAction",
    "label": "Guardar área",
    "fields": [
      "id",
      "key",
      "name",
      "order",
      "active"
    ],
    "permission": "system.configure",
    "risk": "high",
    "physical": false
  },
  {
    "module": "admin",
    "name": "saveSettingAction",
    "label": "Guardar parámetro operativo",
    "fields": [
      "key",
      "value"
    ],
    "permission": "system.configure",
    "risk": "high",
    "physical": false
  },
  {
    "module": "admin",
    "name": "updateUserAction",
    "label": "Modificar usuario existente",
    "fields": [
      "id",
      "name",
      "email",
      "roleId",
      "departmentId",
      "phone",
      "emailNotificationsEnabled",
      "hiddenFromSelectors",
      "active"
    ],
    "permission": "user.manage",
    "risk": "high",
    "physical": false
  },
  {
    "module": "admin",
    "name": "updateRolePermissionsAction",
    "label": "Modificar permisos de un rol",
    "fields": [
      "roleId",
      "permissions",
      "approvalRequired"
    ],
    "permission": "role.manage",
    "risk": "high",
    "physical": false
  },
  {
    "module": "schedule",
    "name": "saveScheduleCollaboratorAction",
    "label": "Incorporar usuario a Equipo",
    "fields": [
      "id",
      "version",
      "userId",
      "employeeCode",
      "departmentIds",
      "functionName",
      "weeklyHours",
      "active"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "tasks",
    "name": "changeTaskStatusAction",
    "label": "Atender o resolver tarea",
    "fields": [
      "id",
      "status",
      "blockedReason",
      "reason",
      "evidenceProvided"
    ],
    "permission": "",
    "risk": "high",
    "physical": true
  },
  {
    "module": "tasks",
    "name": "toggleChecklistAction",
    "label": "Registrar punto de lista",
    "fields": [
      "itemId",
      "done"
    ],
    "permission": "",
    "risk": "high",
    "physical": true
  },
  {
    "module": "entries",
    "name": "changeEntryStatusAction",
    "label": "Resolver novedad o incidencia",
    "fields": [
      "id",
      "status",
      "reason",
      "resolution",
      "rootCause"
    ],
    "permission": "",
    "risk": "high",
    "physical": false
  },
  {
    "module": "cash",
    "name": "declareCashCountAction",
    "label": "Registrar conteo saliente",
    "fields": [
      "handoverId",
      "notes",
      "quantitiesJson",
      "guaranteeIds"
    ],
    "permission": "cash.count_declare",
    "risk": "high",
    "physical": true
  },
  {
    "module": "cash",
    "name": "confirmCashCountAction",
    "label": "Registrar conteo entrante",
    "fields": [
      "handoverId",
      "notes",
      "quantitiesJson",
      "guaranteeIds"
    ],
    "permission": "cash.count_receive",
    "risk": "high",
    "physical": true
  },
  {
    "module": "key-inventory",
    "name": "savePhysicalKeyCountAction",
    "label": "Registrar inventario físico",
    "fields": [
      "floor",
      "requestKey",
      "notes",
      "roomsJson",
      "areasJson"
    ],
    "permission": "",
    "risk": "high",
    "physical": true
  }
] as const;

type Handler = (state: ActionState | null, form: FormData) => Promise<ActionState>;
const handlers: Record<string, () => Promise<Handler>> = {
  createEntryAction: async () => (await import('@/server/actions/entries')).createEntryAction,
  createTaskAction: async () => (await import('@/server/actions/tasks')).createTaskAction,
  coordinateWorkAction: async () => (await import('@/server/actions/coordination')).coordinateWorkAction,
  createHousekeepingAction: async () => (await import('@/server/actions/housekeeping')).createHousekeepingAction,
  changeHousekeepingAction: async () => (await import('@/server/actions/housekeeping')).changeHousekeepingAction,
  createHkWorkAction: async () => (await import('@/server/actions/housekeeping-work')).createHkWorkAction,
  changeHkWorkAction: async () => (await import('@/server/actions/housekeeping-work')).changeHkWorkAction,
  saveHkRoutineAction: async () => (await import('@/server/actions/housekeeping-work')).saveHkRoutineAction,
  prepareHkDayAction: async () => (await import('@/server/actions/housekeeping-work')).prepareHkDayAction,
  confirmHkAvailabilityAction: async () => (await import('@/server/actions/housekeeping-work')).confirmHkAvailabilityAction,
  saveHkHandoverAction: async () => (await import('@/server/actions/housekeeping-work')).saveHkHandoverAction,
  receiveHkHandoverAction: async () => (await import('@/server/actions/housekeeping-work')).receiveHkHandoverAction,
  acceptHkHandoverAction: async () => (await import('@/server/actions/housekeeping-work')).acceptHkHandoverAction,
  revokeHkDelegationAction: async () => (await import('@/server/actions/housekeeping-work')).revokeHkDelegationAction,
  delegateHkAction: async () => (await import('@/server/actions/housekeeping-work')).delegateHkAction,
  openShiftAction: async () => (await import('@/server/actions/shifts')).openShiftAction,
  addShiftMemberAction: async () => (await import('@/server/actions/shifts')).addShiftMemberAction,
  removeShiftMemberAction: async () => (await import('@/server/actions/shifts')).removeShiftMemberAction,
  startReceptionShiftAction: async () => (await import('@/server/actions/shifts')).startReceptionShiftAction,
  receiveHandoverAction: async () => (await import('@/server/actions/shifts')).receiveHandoverAction,
  prepareHandoverAction: async () => (await import('@/server/actions/shifts')).prepareHandoverAction,
  confirmReceptionReviewStepAction: async () => (await import('@/server/actions/shifts')).confirmReceptionReviewStepAction,
  confirmHandoverReviewStepAction: async () => (await import('@/server/actions/shifts')).confirmHandoverReviewStepAction,
  sendHandoverAction: async () => (await import('@/server/actions/shifts')).sendHandoverAction,
  cancelHandoverPreparationAction: async () => (await import('@/server/actions/shifts')).cancelHandoverPreparationAction,
  closeShiftAction: async () => (await import('@/server/actions/shifts')).closeShiftAction,
  closeShiftCashAction: async () => (await import('@/server/actions/cash-closure')).closeShiftCashAction,
  reopenShiftCashAction: async () => (await import('@/server/actions/cash-closure')).reopenShiftCashAction,
  createManualCashMovementAction: async () => (await import('@/server/actions/live-cash')).createManualCashMovementAction,
  returnCashGuaranteeAction: async () => (await import('@/server/actions/live-cash')).returnCashGuaranteeAction,
  chargeCashGuaranteeAction: async () => (await import('@/server/actions/live-cash')).chargeCashGuaranteeAction,
  createPhysicalKeyAction: async () => (await import('@/server/actions/key-inventory')).createPhysicalKeyAction,
  assignPhysicalKeyAction: async () => (await import('@/server/actions/key-inventory')).assignPhysicalKeyAction,
  returnPhysicalKeyAction: async () => (await import('@/server/actions/key-inventory')).returnPhysicalKeyAction,
  markPhysicalKeyIncidentAction: async () => (await import('@/server/actions/key-inventory')).markPhysicalKeyIncidentAction,
  recoverPhysicalKeyAction: async () => (await import('@/server/actions/key-inventory')).recoverPhysicalKeyAction,
  retirePhysicalKeyAction: async () => (await import('@/server/actions/key-inventory')).retirePhysicalKeyAction,
  returnStaffKeyAction: async () => (await import('@/server/actions/key-staff')).returnStaffKeyAction,
  saveKeyAreaAction: async () => (await import('@/server/actions/key-staff')).saveKeyAreaAction,
  createAreaKeyAction: async () => (await import('@/server/actions/key-staff')).createAreaKeyAction,
  createSchedulePlanAction: async () => (await import('@/server/actions/schedule')).createSchedulePlanAction,
  addScheduleSlotAction: async () => (await import('@/server/actions/schedule')).addScheduleSlotAction,
  moveScheduleSlotAction: async () => (await import('@/server/actions/schedule')).moveScheduleSlotAction,
  cancelScheduleSlotAction: async () => (await import('@/server/actions/schedule')).cancelScheduleSlotAction,
  publishSchedulePlanAction: async () => (await import('@/server/actions/schedule')).publishSchedulePlanAction,
  acknowledgeScheduleAction: async () => (await import('@/server/actions/schedule')).acknowledgeScheduleAction,
  applyScheduleImportAction: async () => (await import('@/server/actions/schedule')).applyScheduleImportAction,
  refreshScheduleImportAction: async () => (await import('@/server/actions/schedule')).refreshScheduleImportAction,
  saveDepartmentAction: async () => (await import('@/server/actions/admin')).saveDepartmentAction,
  saveSettingAction: async () => (await import('@/server/actions/admin')).saveSettingAction,
  updateUserAction: async () => (await import('@/server/actions/admin')).updateUserAction,
  updateRolePermissionsAction: async () => (await import('@/server/actions/admin')).updateRolePermissionsAction,
  saveScheduleCollaboratorAction: async () => (await import('@/server/actions/schedule')).saveScheduleCollaboratorAction,
  changeTaskStatusAction: async () => (await import('@/server/actions/tasks')).changeTaskStatusAction,
  toggleChecklistAction: async () => (await import('@/server/actions/tasks')).toggleChecklistAction,
  changeEntryStatusAction: async () => (await import('@/server/actions/entries')).changeEntryStatusAction,
  declareCashCountAction: async () => (await import('@/server/actions/cash')).declareCashCountAction,
  confirmCashCountAction: async () => (await import('@/server/actions/cash')).confirmCashCountAction,
  savePhysicalKeyCountAction: async () => (await import('@/server/actions/key-inventory')).savePhysicalKeyCountAction,
};
export function actionDefinition(name: string) {
  const action = FRONTI_ACTIONS.find(a => a.name === name);
  if (!action) throw new RuleError('Este procedimiento todavía no tiene un adaptador registrado en Fronti. Usa su pantalla.');
  return action;
}
export function validateStep(step: FrontiStep): FrontiStep {
  const action = actionDefinition(step.action);
  const shape = Object.fromEntries(action.fields.map(field => [field, z.union([z.string().max(6000), z.array(z.string().max(1000)).max(100)]).optional()]));
  const parsed = z.object(shape).strict().parse(step.fields);
  // Credentials and identity of execution are never model-controlled fields.
  if (step.action === 'saveSettingAction' && /secret|password|token|key|credential/i.test(String(parsed.key))) throw new RuleError('Usa el formulario protegido para credenciales.');
  return { action: step.action, fields: Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)) };
}
export async function invokeNativeAction(step: FrontiStep): Promise<ActionState> {
  const input = validateStep(step);
  const form = new FormData();
  for (const [key, value] of Object.entries(input.fields)) for (const item of Array.isArray(value) ? value : [value]) form.append(key, item);
  if (['declareCashCountAction','confirmCashCountAction'].includes(input.action)) {
    const counts = z.array(z.object({ id: z.string().min(1).max(100), quantity: z.number().int().min(0).max(100000) }).strict()).max(100).parse(JSON.parse(String(input.fields.quantitiesJson ?? '[]')));
    for (const row of counts) form.append('d_' + row.id, String(row.quantity));
    for (const id of z.array(z.string().min(1).max(100)).max(100).parse(input.fields.guaranteeIds ?? [])) form.append('g_' + id, '1');
  }
  if (input.action === 'savePhysicalKeyCountAction') {
    const rows = z.array(z.object({ id: z.string().min(1).max(100), found: z.number().int().min(0), elsewhere: z.number().int().min(0), outOfService: z.number().int().min(0), notes: z.string().max(1000) }).strict()).max(100);
    for (const [field, name] of [['roomsJson','roomId'],['areasJson','areaId']] as const) for (const row of rows.parse(JSON.parse(String(input.fields[field] ?? '[]')))) {
      form.append(name, row.id);
      for (const k of ['found','elsewhere','outOfService','notes'] as const) form.append(k + ':' + row.id, String(row[k]));
    }
  }
  const handler = await handlers[input.action]!();
  const result = await handler(null, form);
  // Runtime output validation; never persist credentials or unexpected fields.
  return z.discriminatedUnion('ok', [
    z.object({ok:z.literal(true),message:z.string().max(6000),id:z.string().max(200).optional()}),
    z.object({ok:z.literal(false),error:z.string().max(6000)}),
  ]).parse(result);
}
