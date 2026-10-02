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
  protectedOutput: z.boolean().optional().default(false), protectedInputs: z.array(z.string()).optional().default([]), requiredFields: z.array(z.string()).optional().default([]),
}).strict()).parse(actionCatalog);


type Handler = (state: ActionState | null, form: FormData) => Promise<ActionState>;
const handlers: Record<string, () => Promise<Handler>> = {
  runHelpActionAction: async () => (await import('@/server/actions/help')).runHelpActionAction,
  finishTutorialAction: async () => (await import('@/server/actions/tutorial')).finishTutorialAction,
  finishModuleTutorialAction: async () => (await import('@/server/actions/tutorial')).finishModuleTutorialAction,
  restartTutorialAction: async () => (await import('@/server/actions/tutorial')).restartTutorialAction,
  restartModuleTutorialAction: async () => (await import('@/server/actions/tutorial')).restartModuleTutorialAction,
  changePasswordAction: async () => (await import('@/server/actions/auth')).changePasswordAction,
  getUnreadCounts: async () => async () => {const result=await (await import('@/server/actions/notifications')).getUnreadCounts();return {ok:true,message:`${z.number().int().nonnegative().parse(result.notifications)} notificaciones y ${z.number().int().nonnegative().parse(result.alerts)} alertas propias sin leer.`};},
  logoutAction: async () => async () => {await (await import('@/server/actions/auth')).logoutAction();return {ok:true,message:'Sesión cerrada.'};},
  updateEntryAction: async () => (await import('@/server/actions/entries')).updateEntryAction,
  deleteEntryAction: async () => (await import('@/server/actions/entries')).deleteEntryAction,
  restoreEntryAction: async () => (await import('@/server/actions/entries')).restoreEntryAction,
  updateTaskAction: async () => (await import('@/server/actions/tasks')).updateTaskAction,
  assignTaskAction: async () => (await import('@/server/actions/tasks')).assignTaskAction,
  deleteTaskAction: async () => (await import('@/server/actions/tasks')).deleteTaskAction,
  restoreTaskAction: async () => (await import('@/server/actions/tasks')).restoreTaskAction,
  organizeLegacyHkWorkAction: async () => (await import('@/server/actions/housekeeping-work')).organizeLegacyHkWorkAction,
  changeShiftTypeAction: async () => (await import('@/server/actions/shifts')).changeShiftTypeAction,
  addHandoverNoteAction: async () => (await import('@/server/actions/shifts')).addHandoverNoteAction,
  removeHandoverNoteAction: async () => (await import('@/server/actions/shifts')).removeHandoverNoteAction,
  scheduleShiftAction: async () => (await import('@/server/actions/shifts')).scheduleShiftAction,
  cancelShiftAction: async () => (await import('@/server/actions/shifts')).cancelShiftAction,
  archiveShiftAction: async () => (await import('@/server/actions/shifts')).archiveShiftAction,
  unarchiveShiftAction: async () => (await import('@/server/actions/shifts')).unarchiveShiftAction,
  createGymPassAction: async () => (await import('@/server/actions/live-cash')).createGymPassAction,
  createParkingPassAction: async () => (await import('@/server/actions/live-cash')).createParkingPassAction,
  voidGymPassAction: async () => (await import('@/server/actions/live-cash')).voidGymPassAction,
  createCashDifferenceRegularizationAction: async () => (await import('@/server/actions/live-cash')).createCashDifferenceRegularizationAction,
  markCashMovementAsRegularizationAction: async () => (await import('@/server/actions/live-cash')).markCashMovementAsRegularizationAction,
  saveLiveCashAuditAction: async () => (await import('@/server/actions/live-cash')).saveLiveCashAuditAction,
  saveSupervisorKeyAction: async () => (await import('@/server/actions/key-staff')).saveSupervisorKeyAction,
  lendStaffKeysAction: async () => (await import('@/server/actions/key-staff')).lendStaffKeysAction,
  changeScheduleExtraAction: async () => (await import('@/server/actions/schedule')).changeScheduleExtraAction,
  saveScheduleTemplateAction: async () => (await import('@/server/actions/schedule')).saveScheduleTemplateAction,
  saveScheduleCoverageAction: async () => (await import('@/server/actions/schedule')).saveScheduleCoverageAction,
  saveScheduleGrantAction: async () => (await import('@/server/actions/schedule')).saveScheduleGrantAction,
  saveScheduleHolidayAction: async () => (await import('@/server/actions/schedule')).saveScheduleHolidayAction,
  reviewScheduleImportAction: async () => (await import('@/server/actions/schedule')).reviewScheduleImportAction,
  createUserAction: async () => (await import('@/server/actions/admin')).createUserAction,
  resetUserPasswordAction: async () => (await import('@/server/actions/admin')).resetUserPasswordAction,
  deleteUserAction: async () => (await import('@/server/actions/admin')).deleteUserAction,
  restoreUserAction: async () => (await import('@/server/actions/admin')).restoreUserAction,
  runMaintenanceAction: async () => (await import('@/server/actions/admin')).runMaintenanceAction,
  recordCashTransferAction: async () => (await import('@/server/actions/cash')).recordCashTransferAction,
  saveHandoverUsdRateAction: async () => (await import('@/server/actions/cash')).saveHandoverUsdRateAction,
  declareElementsAction: async () => (await import('@/server/actions/cash')).declareElementsAction,
  confirmElementsAction: async () => (await import('@/server/actions/cash')).confirmElementsAction,
  removeShiftFromOperationAction: async () => (await import('@/server/actions/admin-shifts')).removeShiftFromOperationAction,
  createAlertAction: async () => (await import('@/server/actions/alerts')).createAlertAction,
  acknowledgeAlertAction: async () => (await import('@/server/actions/alerts')).acknowledgeAlertAction,
  snoozeAlertAction: async () => (await import('@/server/actions/alerts')).snoozeAlertAction,
  resolveAlertAction: async () => (await import('@/server/actions/alerts')).resolveAlertAction,
  deleteAlertAction: async () => (await import('@/server/actions/alerts')).deleteAlertAction,
  restoreAlertAction: async () => (await import('@/server/actions/alerts')).restoreAlertAction,
  runAlertEngineAction: async () => (await import('@/server/actions/alerts')).runAlertEngineAction,
  createAnnouncementAction: async () => (await import('@/server/actions/announcements')).createAnnouncementAction,
  confirmAnnouncementAction: async () => (await import('@/server/actions/announcements')).confirmAnnouncementAction,
  closeAnnouncementAction: async () => (await import('@/server/actions/announcements')).closeAnnouncementAction,
  sendBookItemMailAction: async () => (await import('@/server/actions/book-mail')).sendBookItemMailAction,
  saveCashConfigurationAction: async () => (await import('@/server/actions/cash-config')).saveCashConfigurationAction,
  saveChecklistTemplateAction: async () => (await import('@/server/actions/checklists')).saveChecklistTemplateAction,
  deleteChecklistTemplateAction: async () => (await import('@/server/actions/checklists')).deleteChecklistTemplateAction,
  startChecklistRunAction: async () => (await import('@/server/actions/checklists')).startChecklistRunAction,
  markChecklistItemAction: async () => (await import('@/server/actions/checklists')).markChecklistItemAction,
  finishChecklistRunAction: async () => (await import('@/server/actions/checklists')).finishChecklistRunAction,
  addCommentAction: async () => (await import('@/server/actions/comments')).addCommentAction,
  deleteCommentAction: async () => (await import('@/server/actions/comments')).deleteCommentAction,
  resolveAllConflictsAction: async () => (await import('@/server/actions/conflicts')).resolveAllConflictsAction,
  repairDiagnosticsAction: async () => (await import('@/server/actions/diagnostics')).repairDiagnosticsAction,
  factoryResetAction: async () => (await import('@/server/actions/factory-reset')).factoryResetAction,
  createFineAction: async () => (await import('@/server/actions/fines')).createFineAction,
  changeFineStatusAction: async () => (await import('@/server/actions/fines')).changeFineStatusAction,
  deleteFineAction: async () => (await import('@/server/actions/fines')).deleteFineAction,
  createFollowUpAction: async () => (await import('@/server/actions/followups')).createFollowUpAction,
  updateFollowUpAction: async () => (await import('@/server/actions/followups')).updateFollowUpAction,
  deleteFollowUpAction: async () => (await import('@/server/actions/followups')).deleteFollowUpAction,
  restoreFollowUpAction: async () => (await import('@/server/actions/followups')).restoreFollowUpAction,
  saveFrontiSettingAction: async () => (await import('@/server/actions/fronti')).saveFrontiSettingAction,
  setFrontiUserAccessAction: async () => (await import('@/server/actions/fronti')).setFrontiUserAccessAction,
  resetFrontiSettingsAction: async () => (await import('@/server/actions/fronti')).resetFrontiSettingsAction,
  cleanupFrontiMemoryAction: async () => (await import('@/server/actions/fronti')).cleanupFrontiMemoryAction,
  saveFrontiProviderCredentialAction: async () => (await import('@/server/actions/fronti')).saveFrontiProviderCredentialAction,
  clearFrontiProviderCredentialAction: async () => (await import('@/server/actions/fronti')).clearFrontiProviderCredentialAction,
  testFrontiProviderAction: async () => (await import('@/server/actions/fronti')).testFrontiProviderAction,
  saveHandoverElementConfigurationAction: async () => (await import('@/server/actions/handover-element-config')).saveHandoverElementConfigurationAction,
  saveSingleHandoverNoteAction: async () => (await import('@/server/actions/handover-note')).saveSingleHandoverNoteAction,
  acceptTermsAction: async () => (await import('@/server/actions/legal')).acceptTermsAction,
  saveMailConfigAction: async () => (await import('@/server/actions/mail')).saveMailConfigAction,
  sendMailTestAction: async () => (await import('@/server/actions/mail')).sendMailTestAction,
  saveNotificationEmailPolicyAction: async () => (await import('@/server/actions/mail')).saveNotificationEmailPolicyAction,
  markNotificationsReadAction: async () => (await import('@/server/actions/notifications')).markNotificationsReadAction,
  createOperationalAlarmAction: async () => (await import('@/server/actions/operational-alarms')).createOperationalAlarmAction,
  updateOperationalAlarmAction: async () => (await import('@/server/actions/operational-alarms')).updateOperationalAlarmAction,
  cancelOperationalAlarmAction: async () => (await import('@/server/actions/operational-alarms')).cancelOperationalAlarmAction,
  updateMyEmailPreferencesAction: async () => (await import('@/server/actions/profile')).updateMyEmailPreferencesAction,
  createGuaranteeAction: async () => (await import('@/server/actions/references')).createGuaranteeAction,
  updateGuaranteeAction: async () => (await import('@/server/actions/references')).updateGuaranteeAction,
  changeGuaranteeStateAction: async () => (await import('@/server/actions/references')).changeGuaranteeStateAction,
  deleteGuaranteeAction: async () => (await import('@/server/actions/references')).deleteGuaranteeAction,
  returnKeyAction: async () => (await import('@/server/actions/rooms')).returnKeyAction,
  handMainKeyAction: async () => (await import('@/server/actions/rooms')).handMainKeyAction,
  giveExtraCopyAction: async () => (await import('@/server/actions/rooms')).giveExtraCopyAction,
  setKeyIncidentStatusAction: async () => (await import('@/server/actions/rooms')).setKeyIncidentStatusAction,
  reinstateKeyAction: async () => (await import('@/server/actions/rooms')).reinstateKeyAction,
  createKeyAction: async () => (await import('@/server/actions/rooms')).createKeyAction,
  reconcileKeysAction: async () => (await import('@/server/actions/rooms')).reconcileKeysAction,
  startSupervisionShiftAction: async () => (await import('@/server/actions/supervision-center')).startSupervisionShiftAction,
  completeSupervisionOpeningAction: async () => (await import('@/server/actions/supervision-center')).completeSupervisionOpeningAction,
  deliverSupervisionShiftAction: async () => (await import('@/server/actions/supervision-center')).deliverSupervisionShiftAction,
  finishSupervisionShiftAction: async () => (await import('@/server/actions/supervision-center')).finishSupervisionShiftAction,
  receiveSupervisionHandoverAction: async () => (await import('@/server/actions/supervision-center')).receiveSupervisionHandoverAction,
  followSupervisionSourceAction: async () => (await import('@/server/actions/supervision-center')).followSupervisionSourceAction,
  reviewSupervisionAuditItemAction: async () => (await import('@/server/actions/supervision-center')).reviewSupervisionAuditItemAction,
  updateSupervisionAuditDeparturesPendingAction: async () => (await import('@/server/actions/supervision-center')).updateSupervisionAuditDeparturesPendingAction,
  createSupervisionNoteAction: async () => (await import('@/server/actions/supervision-center')).createSupervisionNoteAction,
  deleteSupervisionNoteAction: async () => (await import('@/server/actions/supervision-center')).deleteSupervisionNoteAction,
  restoreSupervisionNoteAction: async () => (await import('@/server/actions/supervision-center')).restoreSupervisionNoteAction,
  restoreCorrectiveMeasureAction: async () => (await import('@/server/actions/supervision-center')).restoreCorrectiveMeasureAction,
  createCorrectiveMeasureAction: async () => (await import('@/server/actions/supervision-center')).createCorrectiveMeasureAction,
  changeCorrectiveMeasureStatusAction: async () => (await import('@/server/actions/supervision-center')).changeCorrectiveMeasureStatusAction,
  addPerformanceObservationAction: async () => (await import('@/server/actions/supervision-center')).addPerformanceObservationAction,
  sendSupervisorReportAction: async () => (await import('@/server/actions/supervisor-reports')).sendSupervisorReportAction,
  updateSupportRequestAction: async () => (await import('@/server/actions/support')).updateSupportRequestAction,
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
  for (const field of action.requiredFields) if (parsed[field] === undefined) throw new RuleError('El procedimiento requiere el estado completo: falta '+field+'.');
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
    const kind=z.enum(['PROCEDURE','ESCALATION','SUBSTITUTION']).parse(parsed.kind);
    const required=['name','departmentId','expiresAt',...(kind==='PROCEDURE'?['description','ownerId','priority','nextAction','evidenceRequired','checklist','startDate','localTime','deadlineHours','catchUpDays']:kind==='SUBSTITUTION'?['trigger','workKind','priority','receiptMinutes','mode','candidateIds','requirePublishedSchedule','nextAction']:['trigger','workKind','priority','receiptMinutes','recipientId'])];
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
export async function invokeNativeAction(step: FrontiStep, expectedRevision?: string | null, protectedForm?: FormData, receiveProtectedResult?: (result: ActionState) => void): Promise<ActionState> {
  const input = validateStep(step);
  const form = new FormData();
  const definition = actionDefinition(input.action);
  if(definition.protectedOutput && !receiveProtectedResult) throw new RuleError('Completa este paso en el formulario protegido para recibir las credenciales.');
  for (const field of definition.protectedInputs) {
    const value = protectedForm?.get(field);
    if (value === undefined || value === null) throw new RuleError('Completa los datos protegidos en el procedimiento. No los envíes al chat.');
    form.append(field, value);
  }
  if(input.action==='logoutAction')z.literal('CERRAR_MI_SESION').parse(protectedForm?.get('logoutAcknowledged'));
  if(expectedRevision) form.append('__frontiRevision',expectedRevision);
  for (const [key, value] of Object.entries(input.fields)) for (const item of Array.isArray(value) ? value : [value]) form.append(key, item);
  if (['declareElementsAction','confirmElementsAction'].includes(input.action)) {
    const marks=z.array(z.object({id:z.string().min(1).max(100),present:z.boolean()}).strict()).max(100).parse(JSON.parse(String(input.fields.elementMarksJson ?? '[]')));
    for(const mark of marks)form.set('e_'+mark.id,mark.present?'true':'false');
  }
  if(input.action==='lendStaffKeysAction') {
    const rows=z.array(z.object({keyId:z.string().min(1).max(100),source:z.enum(['public','private']),destinationId:z.string().min(1).max(100),destinationKind:z.enum(['ROOM','AREA'])}).strict()).min(1).max(100).parse(JSON.parse(String(input.fields.itemsJson??'[]')));
    rows.forEach((row,index)=>{const id=String(index);form.append('keySelection',id);form.set('key:'+id,row.keyId);form.set('source:'+id,row.source);form.set('destination:'+id,row.destinationId);form.set('kind:'+id,row.destinationKind);});
  }
  if(input.action==='saveHandoverElementConfigurationAction') {
    const rows=z.array(z.object({id:z.string().min(1).max(100),name:z.string().min(2).max(200),detail:z.string().max(1000),order:z.number().int().nonnegative(),active:z.boolean(),required:z.boolean()}).strict()).max(100).parse(JSON.parse(String(input.fields.elementsJson??'[]')));
    for(const row of rows){form.append('elementId',row.id);for(const field of ['name','detail','order','active','required'] as const)form.set(field+'_'+row.id,String(row[field]));}
  }
  if(input.action==='saveNotificationEmailPolicyAction') {
    const { NotificationType }=await import('@prisma/client');
    const { NOTIFICATION_EMAIL_MODES }=await import('@/server/services/notification-email-policy');
    const values=z.object(Object.fromEntries(Object.values(NotificationType).map(type=>[type,z.enum(NOTIFICATION_EMAIL_MODES)]))).strict().parse(JSON.parse(String(input.fields.policiesJson??'{}')));
    for(const [type,value] of Object.entries(values))form.set('policy_'+type,value);
  }
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
  if (definition.protectedOutput && result.ok && result.credentials) {
    const credentials = z.object({name:z.string(),username:z.string(),password:z.string(),recipient:z.string(),sent:z.boolean(),reason:z.string().nullable().optional()}).strict().parse(result.credentials);
    receiveProtectedResult?.({...result,credentials});
  }
  // Runtime output validation; never persist credentials or unexpected fields.
  return z.discriminatedUnion('ok', [
    z.object({ok:z.literal(true),message:z.string().max(6000),id:z.string().max(200).optional(),committedRevision:z.string().regex(/^[a-f0-9]{64}$/).optional()}),
    z.object({ok:z.literal(false),error:z.string().max(6000)}),
  ]).parse(result);
}
