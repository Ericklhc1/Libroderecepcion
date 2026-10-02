# Matriz completa de Server Actions · Etapa 2

Inventario reproducible: `python scripts/etapa2/matrix.py`. Incluye las acciones nativas detectadas y el catálogo conectado; **conexión no equivale a acreditación**. No se declara cobertura general. Consultas existentes de Fronti conservan sus lectores y permisos; el inventario de endpoints GET, exportaciones, archivos binarios y acciones de perfil requiere revisión adicional.

## Controles comunes a los adaptadores conectados

- Identidad: sesión autenticada en servidor y permisos renovados para cada paso. El modelo no suministra rol ni identidad ejecutora.
- Entrada: acción/campos admitidos + validación del formulario original. Los campos de destinatario son objetivos, nunca la identidad ejecutora.
- Confirmación: propuesta IA muestra efecto/campos y requiere autorización privada; `/ejecutar [...]` es autorización exacta del usuario. Se preservan controles y aprobaciones nativos. Declarar un hecho físico no equivale a realizarlo; nunca se aporta otra identidad.
- Efecto/servicio: se invoca la Server Action indicada, que conserva el servicio original. No hay escrituras arbitrarias elegidas por el modelo.
- Reintento: plan/posición persistidos, reclamación atómica y huella de mensaje; éxito no se repite. Resultado incierto detiene los pasos pendientes para intervención. No hay transacción global entre distintas Server Actions.
- Reversibilidad: no existe deshacer genérico. Cancelar afecta pasos pendientes; corregir una acción completada exige su procedimiento nativo y conserva auditoría.
- Pruebas comunes: `etapa2-domain.test.ts` (contrato/identidad/límites); `etapa2-execution.test.ts` (PostgreSQL, permisos/revocación, privacidad del plan, concurrencia, cancelación y ejecución parcial). Estos casos **no acreditan todos los procedimientos individuales**.
- Cambios posteriores: revisión de tareas, novedades, llaves, garantías, usuarios/permisos y configuración; HK/Coordinación/Equipo retienen versiones nativas. Falta acreditar atomicidad y cobertura de revisión de todos los procedimientos antes de publicación.

## Inventario

| Acción | Adaptador/servicio de entrada existente | Permiso explícito en la acción | Datos del adaptador (obligatoriedad en esquema nativo) | Cobertura |
|---|---|---|---|---|
| `removeShiftFromOperationAction` | `src/server/actions/admin-shifts.ts` | shift.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createUserAction` | `src/server/actions/admin.ts` | user.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `updateUserAction` | `src/server/actions/admin.ts` | role.manage, user.manage | id, name, email, roleId, departmentId, phone, emailNotificationsEnabled, hiddenFromSelectors, active | Conectado; acreditación individual pendiente |
| `resetUserPasswordAction` | `src/server/actions/admin.ts` | user.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `deleteUserAction` | `src/server/actions/admin.ts` | user.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `restoreUserAction` | `src/server/actions/admin.ts` | user.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `updateRolePermissionsAction` | `src/server/actions/admin.ts` | role.manage | roleId, permissions, approvalRequired | Conectado; acreditación individual pendiente |
| `saveDepartmentAction` | `src/server/actions/admin.ts` | system.configure | id, key, name, order, active | Conectado; acreditación individual pendiente |
| `saveSettingAction` | `src/server/actions/admin.ts` | system.configure | key, value | Conectado; acreditación individual pendiente |
| `runMaintenanceAction` | `src/server/actions/admin.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createAlertAction` | `src/server/actions/alerts.ts` | alert.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `acknowledgeAlertAction` | `src/server/actions/alerts.ts` | alert.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `snoozeAlertAction` | `src/server/actions/alerts.ts` | alert.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `resolveAlertAction` | `src/server/actions/alerts.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `deleteAlertAction` | `src/server/actions/alerts.ts` | entry.delete | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `restoreAlertAction` | `src/server/actions/alerts.ts` | entry.restore | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `runAlertEngineAction` | `src/server/actions/alerts.ts` | alert.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createAnnouncementAction` | `src/server/actions/announcements.ts` | announcement.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `confirmAnnouncementAction` | `src/server/actions/announcements.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `closeAnnouncementAction` | `src/server/actions/announcements.ts` | announcement.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `loginAction` | `src/server/actions/auth.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `logoutAction` | `src/server/actions/auth.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `changePasswordAction` | `src/server/actions/auth.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `sendBookItemMailAction` | `src/server/actions/book-mail.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `closeShiftCashAction` | `src/server/actions/cash-closure.ts` | cash.close | shiftId, notes | Conectado; acreditación individual pendiente |
| `reopenShiftCashAction` | `src/server/actions/cash-closure.ts` | cash.reopen | shiftId, reason | Conectado; acreditación individual pendiente |
| `saveCashConfigurationAction` | `src/server/actions/cash-config.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `declareCashCountAction` | `src/server/actions/cash.ts` | cash.count_declare | handoverId, notes, quantitiesJson, guaranteeIds | Conectado; acreditación individual pendiente |
| `confirmCashCountAction` | `src/server/actions/cash.ts` | cash.count_receive | handoverId, notes, quantitiesJson, guaranteeIds | Conectado; acreditación individual pendiente |
| `recordCashTransferAction` | `src/server/actions/cash.ts` | cash.treasury_transfer | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveHandoverUsdRateAction` | `src/server/actions/cash.ts` | cash.usd_rate | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `declareElementsAction` | `src/server/actions/cash.ts` | shift.handover | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `confirmElementsAction` | `src/server/actions/cash.ts` | shift.receive | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveChecklistTemplateAction` | `src/server/actions/checklists.ts` | supervision.audit.create | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `deleteChecklistTemplateAction` | `src/server/actions/checklists.ts` | supervision.audit.create | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `startChecklistRunAction` | `src/server/actions/checklists.ts` | supervision.audit.create | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `markChecklistItemAction` | `src/server/actions/checklists.ts` | supervision.audit.create | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `finishChecklistRunAction` | `src/server/actions/checklists.ts` | supervision.audit.close | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `addCommentAction` | `src/server/actions/comments.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `deleteCommentAction` | `src/server/actions/comments.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `resolveAllConflictsAction` | `src/server/actions/conflicts.ts` | conflict.resolve_all | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `coordinateWorkAction` | `src/server/actions/coordination.ts` | Control contextual del servicio nativo | kind, id, updatedAt, requestKey, action, ownerId, nextAction | Conectado; acreditación individual pendiente |
| `repairDiagnosticsAction` | `src/server/actions/diagnostics.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `reportRuntimeErrorAction` | `src/server/actions/diagnostics.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createEntryAction` | `src/server/actions/entries.ts` | Control contextual del servicio nativo | type, title, description, category, departmentId, roomId, priority, ownerId, occurredAt, dueAt, tags, requiresFollowUp, severity, impact, immediateAction | Conectado; acreditación individual pendiente |
| `updateEntryAction` | `src/server/actions/entries.ts` | entry.edit | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `changeEntryStatusAction` | `src/server/actions/entries.ts` | entry.edit | id, status, reason, resolution, rootCause | Conectado; acreditación individual pendiente |
| `deleteEntryAction` | `src/server/actions/entries.ts` | entry.delete | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `restoreEntryAction` | `src/server/actions/entries.ts` | entry.restore | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `factoryResetAction` | `src/server/actions/factory-reset.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createFineAction` | `src/server/actions/fines.ts` | incident.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `changeFineStatusAction` | `src/server/actions/fines.ts` | incident.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `deleteFineAction` | `src/server/actions/fines.ts` | incident.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createFollowUpAction` | `src/server/actions/followups.ts` | followup.create | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `updateFollowUpAction` | `src/server/actions/followups.ts` | followup.create | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `deleteFollowUpAction` | `src/server/actions/followups.ts` | entry.delete | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `restoreFollowUpAction` | `src/server/actions/followups.ts` | entry.restore | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveFrontiSettingAction` | `src/server/actions/fronti.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `setFrontiUserAccessAction` | `src/server/actions/fronti.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `resetFrontiSettingsAction` | `src/server/actions/fronti.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `cleanupFrontiMemoryAction` | `src/server/actions/fronti.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveFrontiProviderCredentialAction` | `src/server/actions/fronti.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `clearFrontiProviderCredentialAction` | `src/server/actions/fronti.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `testFrontiProviderAction` | `src/server/actions/fronti.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `prepareGuestReservationImportAction` | `src/server/actions/guest-reservation-imports.ts` | pms.import | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `applyGuestReservationImportAction` | `src/server/actions/guest-reservation-imports.ts` | pms.import | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `discardGuestReservationImportAction` | `src/server/actions/guest-reservation-imports.ts` | pms.import | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveHandoverElementConfigurationAction` | `src/server/actions/handover-element-config.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveSingleHandoverNoteAction` | `src/server/actions/handover-note.ts` | shift.handover | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `runHelpActionAction` | `src/server/actions/help.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createHkWorkAction` | `src/server/actions/housekeeping-work.ts` | Control contextual del servicio nativo | departmentId, requestKey, title, description, workKind, workDate, roomId, zoneId, location, priority, dueAt, effortMinutes, requiresInspection, assignedToId, sourceEntryId | Conectado; acreditación individual pendiente |
| `changeHkWorkAction` | `src/server/actions/housekeeping-work.ts` | Control contextual del servicio nativo | id, version, action, severity, note, assignedToId, dueAt | Conectado; acreditación individual pendiente |
| `saveHkRoutineAction` | `src/server/actions/housekeeping-work.ts` | Control contextual del servicio nativo | departmentId, id, version, title, description, location, effortMinutes, requiresInspection, active | Conectado; acreditación individual pendiente |
| `prepareHkDayAction` | `src/server/actions/housekeeping-work.ts` | Control contextual del servicio nativo | departmentId, workDate | Conectado; acreditación individual pendiente |
| `confirmHkAvailabilityAction` | `src/server/actions/housekeeping-work.ts` | Control contextual del servicio nativo | departmentId, workDate, userId, available, note | Conectado; acreditación individual pendiente |
| `saveHkHandoverAction` | `src/server/actions/housekeeping-work.ts` | Control contextual del servicio nativo | departmentId, requestKey, workDate, note | Conectado; acreditación individual pendiente |
| `receiveHkHandoverAction` | `src/server/actions/housekeeping-work.ts` | Control contextual del servicio nativo | id | Conectado; acreditación individual pendiente |
| `delegateHkAction` | `src/server/actions/housekeeping-work.ts` | Control contextual del servicio nativo | departmentId, userId, permission, startsAt, endsAt, reason | Conectado; acreditación individual pendiente |
| `revokeHkDelegationAction` | `src/server/actions/housekeeping-work.ts` | Control contextual del servicio nativo | id | Conectado; acreditación individual pendiente |
| `organizeLegacyHkWorkAction` | `src/server/actions/housekeeping-work.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `acceptHkHandoverAction` | `src/server/actions/housekeeping-work.ts` | Control contextual del servicio nativo | id | Conectado; acreditación individual pendiente |
| `createHousekeepingAction` | `src/server/actions/housekeeping.ts` | Control contextual del servicio nativo | departmentId, assignedToId, requestKey, title, description, sourceEntryId, location, priority, dueAt | Conectado; acreditación individual pendiente |
| `changeHousekeepingAction` | `src/server/actions/housekeeping.ts` | Control contextual del servicio nativo | departmentId, assignedToId, id, version, action, note, dueAt | Conectado; acreditación individual pendiente |
| `installAction` | `src/server/actions/install.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `checkInstallState` | `src/server/actions/install.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `startKeyInventoryMetricAction` | `src/server/actions/key-inventory.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `savePhysicalKeyCountAction` | `src/server/actions/key-inventory.ts` | Control contextual del servicio nativo | floor, requestKey, notes, roomsJson, areasJson | Conectado; acreditación individual pendiente |
| `createPhysicalKeyAction` | `src/server/actions/key-inventory.ts` | key.stock | code, roomId, type, notes | Conectado; acreditación individual pendiente |
| `assignPhysicalKeyAction` | `src/server/actions/key-inventory.ts` | key.assign | keyId, roomId, note | Conectado; acreditación individual pendiente |
| `returnPhysicalKeyAction` | `src/server/actions/key-inventory.ts` | key.assign | keyId, note | Conectado; acreditación individual pendiente |
| `markPhysicalKeyIncidentAction` | `src/server/actions/key-inventory.ts` | key.stock | keyId, status, reason | Conectado; acreditación individual pendiente |
| `recoverPhysicalKeyAction` | `src/server/actions/key-inventory.ts` | key.stock | keyId, note | Conectado; acreditación individual pendiente |
| `retirePhysicalKeyAction` | `src/server/actions/key-inventory.ts` | key.stock | keyId, reason | Conectado; acreditación individual pendiente |
| `saveKeyAreaAction` | `src/server/actions/key-staff.ts` | key.stock | id, name, active | Conectado; acreditación individual pendiente |
| `createAreaKeyAction` | `src/server/actions/key-staff.ts` | key.stock | areaId, code | Conectado; acreditación individual pendiente |
| `saveSupervisorKeyAction` | `src/server/actions/key-staff.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `lendStaffKeysAction` | `src/server/actions/key-staff.ts` | key.assign | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `returnStaffKeyAction` | `src/server/actions/key-staff.ts` | key.assign | itemId, notes | Conectado; acreditación individual pendiente |
| `acceptTermsAction` | `src/server/actions/legal.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createGymPassAction` | `src/server/actions/live-cash.ts` | cash.view | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createParkingPassAction` | `src/server/actions/live-cash.ts` | cash.view | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `voidGymPassAction` | `src/server/actions/live-cash.ts` | cash.view | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createManualCashMovementAction` | `src/server/actions/live-cash.ts` | Control contextual del servicio nativo | direction, currency, amount, reference, effectiveAt, notes, effectiveDateConfirmed | Conectado; acreditación individual pendiente |
| `createCashDifferenceRegularizationAction` | `src/server/actions/live-cash.ts` | cash.approve | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `markCashMovementAsRegularizationAction` | `src/server/actions/live-cash.ts` | cash.approve | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `returnCashGuaranteeAction` | `src/server/actions/live-cash.ts` | cash.guarantee_out | guaranteeId, confirmed | Conectado; acreditación individual pendiente |
| `chargeCashGuaranteeAction` | `src/server/actions/live-cash.ts` | cash.guarantee_out | guaranteeId, concept, notes, confirmed | Conectado; acreditación individual pendiente |
| `saveLiveCashAuditAction` | `src/server/actions/live-cash.ts` | cash.audit | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveMailConfigAction` | `src/server/actions/mail.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `sendMailTestAction` | `src/server/actions/mail.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveNotificationEmailPolicyAction` | `src/server/actions/mail.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `getUnreadCounts` | `src/server/actions/notifications.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `markNotificationsReadAction` | `src/server/actions/notifications.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createOperationalAlarmAction` | `src/server/actions/operational-alarms.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `updateOperationalAlarmAction` | `src/server/actions/operational-alarms.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `cancelOperationalAlarmAction` | `src/server/actions/operational-alarms.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveAutomationAction` | `src/server/actions/operational-automation.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `simulateAutomationAction` | `src/server/actions/operational-automation.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `setAutomationStateAction` | `src/server/actions/operational-automation.ts` | system.configure | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `applyImportWithReservationCoreAction` | `src/server/actions/pms-reservations.ts` | pms.import | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `updateMyEmailPreferencesAction` | `src/server/actions/profile.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveGuestAction` | `src/server/actions/references.ts` | guest.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveReservationAction` | `src/server/actions/references.ts` | guest.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createGuaranteeAction` | `src/server/actions/references.ts` | cash.guarantee_in | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `updateGuaranteeAction` | `src/server/actions/references.ts` | cash.guarantee_in | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `changeGuaranteeStateAction` | `src/server/actions/references.ts` | cash.guarantee_out | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `deleteGuaranteeAction` | `src/server/actions/references.ts` | cash.guarantee_out | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `prepareReservationPdfAction` | `src/server/actions/reservation-pdf.ts` | pms.import | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `applyReservationPdfAction` | `src/server/actions/reservation-pdf.ts` | pms.import | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `discardReservationPdfAction` | `src/server/actions/reservation-pdf.ts` | pms.import | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `addGuestToRoomAction` | `src/server/actions/room-occupancy.ts` | room.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `confirmCheckOutAction` | `src/server/actions/rooms.ts` | room.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `confirmCheckInAction` | `src/server/actions/rooms.ts` | room.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `returnKeyAction` | `src/server/actions/rooms.ts` | key.assign | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `handMainKeyAction` | `src/server/actions/rooms.ts` | key.assign | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `giveExtraCopyAction` | `src/server/actions/rooms.ts` | key.stock | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `setKeyIncidentStatusAction` | `src/server/actions/rooms.ts` | key.stock | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `reinstateKeyAction` | `src/server/actions/rooms.ts` | key.stock | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createKeyAction` | `src/server/actions/rooms.ts` | key.stock | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `reconcileKeysAction` | `src/server/actions/rooms.ts` | key.stock | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `prepareImportAction` | `src/server/actions/rooms.ts` | pms.import | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `applyImportAction` | `src/server/actions/rooms.ts` | pms.import | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `discardImportAction` | `src/server/actions/rooms.ts` | pms.import | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `deleteStayAction` | `src/server/actions/rooms.ts` | stay.delete | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `resetRoomAction` | `src/server/actions/rooms.ts` | room.reset | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createSchedulePlanAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | departmentId, startDate, endDate | Conectado; acreditación individual pendiente |
| `addScheduleSlotAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | planId, version, requestKey, reason, collaboratorId, templateId, date, kind, extraKind, extraMinutes, note, replaceSlotId | Conectado; acreditación individual pendiente |
| `moveScheduleSlotAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | planId, version, requestKey, reason, slotId, targetCollaboratorId, targetDate, mode, targetSlotId | Conectado; acreditación individual pendiente |
| `cancelScheduleSlotAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | planId, version, requestKey, reason, slotId | Conectado; acreditación individual pendiente |
| `publishSchedulePlanAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | planId, version, requestKey, reason | Conectado; acreditación individual pendiente |
| `changeScheduleExtraAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `acknowledgeScheduleAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | planId, version | Conectado; acreditación individual pendiente |
| `saveScheduleCollaboratorAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | id, version, userId, employeeCode, departmentIds, functionName, weeklyHours, active | Conectado; acreditación individual pendiente |
| `saveScheduleTemplateAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveScheduleCoverageAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveScheduleGrantAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `saveScheduleHolidayAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `reviewScheduleImportAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `applyScheduleImportAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | planId, version, requestKey, reason, importId | Conectado; acreditación individual pendiente |
| `refreshScheduleImportAction` | `src/server/actions/schedule.ts` | Control contextual del servicio nativo | importId | Conectado; acreditación individual pendiente |
| `openShiftAction` | `src/server/actions/shifts.ts` | shift.start | type, continuity, emergencyReason, emergencyAccepted | Conectado; acreditación individual pendiente |
| `addShiftMemberAction` | `src/server/actions/shifts.ts` | shift.start | shiftId, userId | Conectado; acreditación individual pendiente |
| `removeShiftMemberAction` | `src/server/actions/shifts.ts` | shift.start | shiftId, userId | Conectado; acreditación individual pendiente |
| `changeShiftTypeAction` | `src/server/actions/shifts.ts` | shift.reassign | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `startReceptionShiftAction` | `src/server/actions/shifts.ts` | shift.receive | handoverId, type | Conectado; acreditación individual pendiente |
| `receiveHandoverAction` | `src/server/actions/shifts.ts` | shift.receive | handoverId, observations | Conectado; acreditación individual pendiente |
| `prepareHandoverAction` | `src/server/actions/shifts.ts` | shift.handover | shiftId | Conectado; acreditación individual pendiente |
| `confirmReceptionReviewStepAction` | `src/server/actions/shifts.ts` | shift.receive | handoverId, step, urgentAcknowledged | Conectado; acreditación individual pendiente |
| `confirmHandoverReviewStepAction` | `src/server/actions/shifts.ts` | shift.handover | handoverId, step, urgentAcknowledged | Conectado; acreditación individual pendiente |
| `sendHandoverAction` | `src/server/actions/shifts.ts` | shift.handover | shiftId, notes | Conectado; acreditación individual pendiente |
| `cancelHandoverPreparationAction` | `src/server/actions/shifts.ts` | shift.handover | shiftId | Conectado; acreditación individual pendiente |
| `closeShiftAction` | `src/server/actions/shifts.ts` | shift.close | shiftId, notes | Conectado; acreditación individual pendiente |
| `addHandoverNoteAction` | `src/server/actions/shifts.ts` | shift.handover | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `removeHandoverNoteAction` | `src/server/actions/shifts.ts` | shift.handover | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `scheduleShiftAction` | `src/server/actions/shifts.ts` | shift.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `cancelShiftAction` | `src/server/actions/shifts.ts` | shift.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `archiveShiftAction` | `src/server/actions/shifts.ts` | shift.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `unarchiveShiftAction` | `src/server/actions/shifts.ts` | shift.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `completeStayCheckoutAction` | `src/server/actions/stay-lifecycle.ts` | room.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `modifyStayAction` | `src/server/actions/stay-lifecycle.ts` | room.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `deleteStayPreservingPendingAction` | `src/server/actions/stay-lifecycle.ts` | stay.delete | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `startSupervisionShiftAction` | `src/server/actions/supervision-center.ts` | supervision.shift.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `completeSupervisionOpeningAction` | `src/server/actions/supervision-center.ts` | supervision.shift.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `deliverSupervisionShiftAction` | `src/server/actions/supervision-center.ts` | supervision.shift.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `finishSupervisionShiftAction` | `src/server/actions/supervision-center.ts` | supervision.shift.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `receiveSupervisionHandoverAction` | `src/server/actions/supervision-center.ts` | supervision.shift.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `followSupervisionSourceAction` | `src/server/actions/supervision-center.ts` | supervision.followup.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `reviewSupervisionAuditItemAction` | `src/server/actions/supervision-center.ts` | supervision.audit.create | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `updateSupervisionAuditDeparturesPendingAction` | `src/server/actions/supervision-center.ts` | supervision.audit.create | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createSupervisionNoteAction` | `src/server/actions/supervision-center.ts` | supervision.note.private | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `deleteSupervisionNoteAction` | `src/server/actions/supervision-center.ts` | supervision.note.private | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `restoreSupervisionNoteAction` | `src/server/actions/supervision-center.ts` | entry.restore | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `restoreCorrectiveMeasureAction` | `src/server/actions/supervision-center.ts` | entry.restore | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createCorrectiveMeasureAction` | `src/server/actions/supervision-center.ts` | supervision.corrective.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `changeCorrectiveMeasureStatusAction` | `src/server/actions/supervision-center.ts` | supervision.corrective.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `addPerformanceObservationAction` | `src/server/actions/supervision-center.ts` | supervision.performance.comment | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `sendSupervisorReportAction` | `src/server/actions/supervisor-reports.ts` | supervision.view | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `updateSupportRequestAction` | `src/server/actions/support.ts` | support.manage | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `createTaskAction` | `src/server/actions/tasks.ts` | task.assign, task.create | title, description, assigneeId, priority, startsAt, dueAt, departmentId, entryId, followUpId, fulfillmentCriteria, evidenceRequired, evidenceProvided, targetType, collaboratorIds, targetShiftId, roomId, tags, checklist | Conectado; acreditación individual pendiente |
| `updateTaskAction` | `src/server/actions/tasks.ts` | task.edit | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `assignTaskAction` | `src/server/actions/tasks.ts` | task.assign | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `changeTaskStatusAction` | `src/server/actions/tasks.ts` | task.edit | id, status, blockedReason, reason, evidenceProvided | Conectado; acreditación individual pendiente |
| `toggleChecklistAction` | `src/server/actions/tasks.ts` | task.edit | itemId, done | Conectado; acreditación individual pendiente |
| `deleteTaskAction` | `src/server/actions/tasks.ts` | entry.delete | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `restoreTaskAction` | `src/server/actions/tasks.ts` | entry.restore | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `recordTutorialClientEventAction` | `src/server/actions/tutorial.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `finishTutorialAction` | `src/server/actions/tutorial.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `finishModuleTutorialAction` | `src/server/actions/tutorial.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `restartTutorialAction` | `src/server/actions/tutorial.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
| `restartModuleTutorialAction` | `src/server/actions/tutorial.ts` | Control contextual del servicio nativo | Ver esquema/formulario nativo; adaptador pendiente | Pendiente de adaptador (no disponible por el catálogo nuevo) |
