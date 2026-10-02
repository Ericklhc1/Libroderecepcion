import 'server-only';
import { z } from 'zod';
import actionCatalog from '@/domain/fronti-action-catalog.json';
import type { ActionState } from '@/server/action';
import type { FrontiStep } from '@/domain/fronti-execution';
import { RuleError } from '@/server/errors';

// One canonical catalog also consumed by the action-matrix generator.
export const FRONTI_ACTIONS = z.array(z.object({
  module: z.string().min(1), name: z.string().min(1), label: z.string().min(1),
  fields: z.array(z.string().min(1)), permission: z.string(),
  risk: z.enum(['normal','high']), physical: z.boolean(),
}).strict()).parse(actionCatalog);


type Handler = (state: ActionState | null, form: FormData) => Promise<ActionState>;
const handlers: Record<string, () => Promise<Handler>> = {
  saveAutomationAction: async () => (await import('@/server/actions/operational-automation')).saveAutomationAction,
  simulateAutomationAction: async () => (await import('@/server/actions/operational-automation')).simulateAutomationAction,
  setAutomationStateAction: async () => (await import('@/server/actions/operational-automation')).setAutomationStateAction,

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
// Fail closed if metadata advertises an unimplemented action or hides an implementation.
if (new Set(FRONTI_ACTIONS.map(action => action.name)).size !== FRONTI_ACTIONS.length
  || Object.keys(handlers).length !== FRONTI_ACTIONS.length
  || FRONTI_ACTIONS.some(action => !Object.hasOwn(handlers, action.name) || new Set(action.fields).size !== action.fields.length)) {
  throw new Error('El catálogo Fronti y sus adaptadores nativos no coinciden.');
}
export function actionDefinition(name: string) {
  const action = FRONTI_ACTIONS.find(a => a.name === name);
  if (!action) throw new RuleError('Este procedimiento todavía no tiene un adaptador registrado en Fronti. Usa su pantalla.');
  return action;
}
export function validateStep(step: FrontiStep): FrontiStep {
  const action = actionDefinition(step.action);
  const shape = Object.fromEntries(action.fields.map(field => [field, z.union([z.string().max(6000), z.array(z.string().max(1000)).max(100)]).optional()]));
  const parsed = z.object(shape).strict().parse(step.fields);
  if (['saveDepartmentAction','saveKeyAreaAction','saveHkRoutineAction','saveScheduleCollaboratorAction'].includes(step.action) && parsed.id) {
    for (const field of action.fields) if (parsed[field] === undefined) throw new RuleError('La edición requiere el estado completo: falta ' + field + '. No se reemplazan campos omitidos.');
  }
  if (step.action === 'updateUserAction') {
    for (const field of action.fields) if (typeof parsed[field] !== 'string') throw new RuleError('La edición de usuario requiere su estado completo: falta ' + field + '. No se aplican cambios parciales implícitos.');
    for (const field of ['active','emailNotificationsEnabled','hiddenFromSelectors']) z.enum(['true','false']).parse(parsed[field]);
  }
  if (step.action === 'updateRolePermissionsAction') {
    z.literal('REEMPLAZAR_MATRIZ_COMPLETA').parse(parsed.replacementAcknowledged);
    for (const field of ['permissions','approvalRequired','permissionsBefore','approvalRequiredBefore']) z.array(z.string().min(1)).parse(parsed[field]);
    z.string().min(1).parse(parsed.roleId);
  }
  if (step.action === 'saveAutomationAction') {
    const kind=z.enum(['PROCEDURE','ESCALATION']).parse(parsed.kind);
    const required=['name','departmentId','expiresAt',...(kind==='PROCEDURE'?['description','ownerId','priority','nextAction','evidenceRequired','checklist','startDate','localTime','deadlineHours','catchUpDays']:['trigger','workKind','priority','receiptMinutes','recipientId'])];
    if(parsed.id)required.push('id','version');
    for(const field of required)if(typeof parsed[field]!=='string')throw new RuleError('La política requiere campos completos: falta '+field+'.');
    if(kind==='PROCEDURE')z.array(z.string().regex(/^[0-6]$/)).min(1).max(7).parse(parsed.weekdays);
  }
  if(step.action==='setAutomationStateAction') {
    z.string().min(1).parse(parsed.id);z.string().regex(/^[1-9][0-9]*$/).parse(parsed.version);z.enum(['pause','enable','revoke']).parse(parsed.state);
  }
  if(step.action==='simulateAutomationAction')z.string().min(1).parse(parsed.id);
  // Credentials and identity of execution are never model-controlled fields.
  if (step.action === 'saveSettingAction' && /secret|password|token|key|credential/i.test(String(parsed.key))) throw new RuleError('Usa el formulario protegido para credenciales.');
  return { action: step.action, fields: Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)) };
}
export async function invokeNativeAction(step: FrontiStep, expectedRevision?: string | null): Promise<ActionState> {
  const input = validateStep(step);
  const form = new FormData();
  if(expectedRevision) form.append('__frontiRevision',expectedRevision);
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
