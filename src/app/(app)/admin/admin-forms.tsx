'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ActionForm, Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import {
  createUserAction,
  deleteUserAction,
  resetUserPasswordAction,
  restoreUserAction,
  runMaintenanceAction,
  saveDepartmentAction,
  saveSettingAction,
  updateRolePermissionsAction,
  updateUserAction,
} from '@/server/actions/admin';
import { scheduleShiftAction } from '@/server/actions/shifts';
import type { Option } from '@/server/services/options';
import { suggestUsername } from '@/domain/username';
import { CASH_APPROVAL_CAPABLE_PERMISSIONS } from '@/lib/permissions';
import { WORK_ACTIVITY_PRESETS } from '@/domain/work-activities';

export function RunMaintenanceForm() {
  return (
    <ActionForm action={async () => runMaintenanceAction()} className="space-y-0">
      <SubmitButton variant="secondary" pendingLabel="Ejecutando…">
        Ejecutar mantenimiento ahora
      </SubmitButton>
    </ActionForm>
  );
}

const PASSWORD_HINT = 'Mínimo 10 caracteres, con mayúscula, minúscula y número.';

export function CreateUserDialog({
  roles,
  departments,
  credentialsMailTo,
}: {
  roles: Option[];
  departments: Option[];
  credentialsMailTo: string;
}) {
  const [suggested, setSuggested] = useState('');

  return (
    <Dialog
      title="Nuevo usuario"
      description="El sistema genera la clave y la envía al correo de recepción. El usuario deberá cambiarla en el primer ingreso."
      triggerVariant="gold"
      triggerSize="sm"
      trigger="Nuevo usuario"
    >
      <ActionForm action={createUserAction} closeOnSuccess resetOnSuccess>
        <Field label="Nombre" name="name" required>
          <Input
            name="name"
            required
            maxLength={120}
            onChange={(event) => setSuggested(suggestUsername(event.target.value))}
          />
        </Field>
        <Field
          label="Usuario"
          name="username"
          hint={suggested ? `Si lo dejas vacío será @${suggested}.` : 'Se propone a partir del nombre.'}
        >
          <Input name="username" placeholder={suggested ? `@${suggested}` : '@EHerrera'} maxLength={30} />
        </Field>
        <Field
          label="Correo"
          name="email"
          hint="Recibirá credenciales y avisos de la Central. No se usa para iniciar sesión."
        >
          <Input name="email" type="email" autoComplete="email" maxLength={254} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rol" name="roleId" required>
            <Select name="roleId" placeholder="Selecciona un rol" options={roles} required />
          </Field>
          <Field label="Área principal" name="departmentId" hint="Define el área principal de la cuenta. Las pertenencias adicionales se gestionan desde Equipo → Colaboradores.">
            <Select name="departmentId" placeholder="Sin área" options={departments} />
          </Field>
        </div>
        <Field label="Teléfono" name="phone">
          <Input name="phone" />
        </Field>
        <Checkbox
          name="emailNotificationsEnabled"
          label="Enviar avisos opcionales por correo"
          defaultChecked
        />
        <Checkbox
          name="hiddenFromSelectors"
          label="Ocultar cuenta de los selectores de todas las áreas"
        />
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          La cuenta oculta puede iniciar sesión y conserva su historial, pero no es elegible para
          nuevas asignaciones en Equipo. Este estado se aplica a todas sus áreas.
        </p>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          Si registras un correo, la clave temporal se envía allí. Sin correo, se usa la casilla
          de respaldo <strong>{credentialsMailTo}</strong>. El usuario de acceso sigue siendo @usuario.
        </p>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Creando…">Crear usuario y enviar clave</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function EditUserDialog({
  user,
  roles,
  departments,
}: {
  user: {
    id: string;
    name: string;
    roleId: string;
    departmentId: string | null;
    email: string | null;
    emailNotificationsEnabled: boolean;
    hiddenFromSelectors: boolean;
    phone: string | null;
    active: boolean;
    scheduleAreas: string[];
    scheduleAssignmentCount: number;
  };
  roles: Option[];
  departments: Option[];
}) {
  return (
    <Dialog title={`Editar ${user.name}`} triggerVariant="secondary" triggerSize="sm" trigger="Editar">
      <ActionForm action={updateUserAction} closeOnSuccess>
        <input type="hidden" name="id" value={user.id} />
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          <p>Pertenencias de horarios activas: {user.scheduleAreas.join(', ') || 'ninguna'}.</p>
          <p>Cambiar el área principal no añade ni retira estas pertenencias. También pueden intervenir en el acceso operativo según el rol.</p>
          <p>Para retirar sólo un área, usa Equipo → Colaboradores. Los cambios de cuenta se aplican a todas sus áreas.</p>
        </div>
        <Field label="Nombre" name="name" required>
          <Input name="name" defaultValue={user.name} required maxLength={120} />
        </Field>
        <Field
          label="Correo"
          name="email"
          hint="Canal individual para avisos; no cambia el usuario de acceso."
        >
          <Input
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={user.email ?? ''}
            maxLength={254}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Rol"
            name="roleId"
            required
            hint="Cambiar el rol exige el permiso de administración de roles y cierra sus sesiones."
          >
            <Select name="roleId" defaultValue={user.roleId} options={roles} required />
          </Field>
          <Field label="Área principal" name="departmentId" hint="Define el área principal de la cuenta. Las pertenencias adicionales se gestionan desde Equipo → Colaboradores.">
            <Select
              name="departmentId"
              placeholder="Sin área"
              defaultValue={user.departmentId ?? ''}
              options={departments}
            />
          </Field>
        </div>
        <Field label="Teléfono" name="phone">
          <Input name="phone" defaultValue={user.phone ?? ''} />
        </Field>
        <Checkbox
          name="emailNotificationsEnabled"
          label="Enviar novedades de la Central por correo"
          defaultChecked={user.emailNotificationsEnabled}
        />
        <Checkbox
          name="hiddenFromSelectors"
          label="Ocultar cuenta de los selectores de todas las áreas"
          defaultChecked={user.hiddenFromSelectors}
        />
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          Ocultarla mantiene el inicio de sesión, pero impide nuevas asignaciones en Equipo.
          Desactivar, ocultar o cambiar a un rol no operativo requiere resolver antes las asignaciones
          vigentes o futuras de todas las áreas, incluidas las de borradores.
        </p>
        <ScheduleAccountReview count={user.scheduleAssignmentCount} />
        <Checkbox name="active" label="Cuenta activa en todo el sistema" defaultChecked={user.active} />
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Guardar cambios</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function ResetPasswordDialog({ userId, name }: { userId: string; name: string }) {
  return (
    <Dialog
      title={`Restablecer contraseña de ${name}`}
      description="Se cerrarán todas sus sesiones y deberá cambiarla al ingresar."
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
      trigger="Contraseña"
    >
      <ActionForm action={resetUserPasswordAction} closeOnSuccess>
        <input type="hidden" name="id" value={userId} />
        <Field label="Nueva contraseña" name="password" required hint={PASSWORD_HINT}>
          <Input name="password" type="password" required autoComplete="new-password" />
        </Field>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Restablecer</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

function ScheduleAccountReview({ count }: { count: number }) {
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
      {count} asignaciones vigentes o futuras al abrir esta página. El servidor volverá a revisarlas al guardar.
      {' '}Si hay alguna, desactivar, ocultar, pasar a un rol no operativo o eliminar se bloqueará. Cancela o reasigna las futuras desde{' '}
      <Link href="/equipo" className="font-medium underline">Equipo</Link> y espera el término de las jornadas en curso.
      El horario y su historial no se modifican automáticamente.
    </p>
  );
}

export function DeleteUserDialog({ userId, name, scheduleAssignmentCount }: { userId: string; name: string; scheduleAssignmentCount: number }) {
  return (
    <Dialog
      title={`Eliminar a ${name}`}
      description="Eliminación lógica de la cuenta en todas sus áreas. Se conserva el historial; no retira sólo una pertenencia."
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
      trigger="Eliminar"
    >
      <ActionForm action={deleteUserAction} closeOnSuccess>
        <input type="hidden" name="id" value={userId} />
        <ScheduleAccountReview count={scheduleAssignmentCount} />
        <Field label="Motivo" name="reason" required>
          <Textarea name="reason" rows={3} required minLength={5} />
        </Field>
        <div className="flex justify-end">
          <SubmitButton variant="danger" pendingLabel="Eliminando…">
            Eliminar usuario
          </SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function RestoreUserForm({ userId }: { userId: string }) {
  return (
    <ActionForm action={restoreUserAction} className="space-y-0">
      <input type="hidden" name="id" value={userId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Restaurando…">
        Restaurar
      </SubmitButton>
    </ActionForm>
  );
}

export function RolePermissionsForm({
  roleId,
  roleName,
  groups,
  granted,
  approvalRequired,
  locked,
  affectedUsers,
}: {
  roleId: string;
  roleName: string;
  groups: Array<{ group: string; permissions: Array<{ key: string; name: string }> }>;
  granted: string[];
  approvalRequired: string[];
  locked: boolean;
  affectedUsers: number;
}) {
  const [selectedPermissions, setSelectedPermissions] = useState(() => new Set(granted));
  const [selectedApprovals, setSelectedApprovals] = useState(() => new Set(approvalRequired));
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const preview = WORK_ACTIVITY_PRESETS.find((activity) => activity.key === previewKey) ?? null;
  const missing = preview?.permissions.filter((permission) => !selectedPermissions.has(permission)) ?? [];

  function setPermission(key: string, checked: boolean) {
    setSelectedPermissions((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
    if (!checked) {
      setSelectedApprovals((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function addPreparedActivity() {
    if (!preview?.available) return;
    setSelectedPermissions((current) => {
      const next = new Set(current);
      for (const permission of preview.permissions) next.add(permission);
      return next;
    });
  }

  return (
    <ActionForm action={updateRolePermissionsAction}>
      <input type="hidden" name="roleId" value={roleId} />
      {!locked ? (
        <section className="mb-5 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3" aria-label="Configurar por actividad">
          <div>
            <h3 className="text-sm font-semibold text-petrol-900">Configurar por actividad</h3>
            <p className="mt-1 text-xs text-slate-600">
              Estas ayudas sólo preparan permisos del rol. No guardan nada hasta usar «Guardar permisos»
              y no sustituyen alcance por área, coberturas ni condiciones del proceso.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {WORK_ACTIVITY_PRESETS.map((activity) => (
              <button
                key={activity.key}
                type="button"
                onClick={() => setPreviewKey(activity.key)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-xs font-medium text-petrol-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-petrol-600"
              >
                {activity.label}{activity.available ? '' : ' · pendiente'}
              </button>
            ))}
          </div>
          {preview ? (
            <div className="rounded-lg border border-petrol-100 bg-white p-3 text-xs">
              <p className="font-semibold text-petrol-900">{preview.label}</p>
              <p className="mt-1 text-slate-600">{preview.description}</p>
              <p className="mt-2 text-slate-700">
                <strong>Personas afectadas al guardar:</strong> {affectedUsers} cuenta(s) que usan el rol {roleName}.
              </p>
              <p className="mt-1 text-slate-700">
                <strong>Cambio concreto:</strong>{' '}
                {preview.available
                  ? missing.length
                    ? `añadir ${missing.join(', ')} a la propuesta actual.`
                    : 'los permisos necesarios ya están seleccionados.'
                  : 'ninguno; esta actividad todavía no tiene un permiso canónico que pueda habilitarse.'}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-slate-600">
                {preview.dependencies.map((dependency) => <li key={dependency}>{dependency}</li>)}
              </ul>
              {preview.available && missing.length ? (
                <button
                  type="button"
                  onClick={addPreparedActivity}
                  className="mt-3 rounded-lg bg-petrol-800 px-3 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-petrol-600"
                >
                  Añadir a la propuesta
                </button>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-slate-500">
            Una excepción individual no modifica esta plantilla global. Usa el alcance de área existente
            o una cobertura temporal de Housekeeping cuando corresponda.
          </p>
        </section>
      ) : null}
      <div className="space-y-4">
        {groups.map((group) => (
          <fieldset key={group.group}>
            <legend className="text-xs font-semibold text-petrol-700">
              {group.group}
            </legend>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {group.permissions.map((permission) => {
                const canRequireApproval = CASH_APPROVAL_CAPABLE_PERMISSIONS.includes(
                  permission.key as (typeof CASH_APPROVAL_CAPABLE_PERMISSIONS)[number],
                );
                const checked = selectedPermissions.has(permission.key);
                return (
                  <div
                    key={permission.key}
                    className="rounded-md px-1 py-1 text-sm hover:bg-slate-50"
                  >
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        name="permissions"
                        value={permission.key}
                        checked={checked}
                        onChange={(event) => setPermission(permission.key, event.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-petrol-700"
                      />
                      <span>
                        <span className="block text-petrol-900">{permission.name}</span>
                        <code className="block text-[0.7rem] text-slate-400">{permission.key}</code>
                      </span>
                    </label>
                    {canRequireApproval ? (
                      <label className="ml-6 mt-1 flex items-center gap-2 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          name="approvalRequired"
                          value={permission.key}
                          checked={checked && selectedApprovals.has(permission.key)}
                          disabled={!checked}
                          onChange={(event) => setSelectedApprovals((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(permission.key);
                            else next.delete(permission.key);
                            return next;
                          })}
                          className="h-3.5 w-3.5 rounded border-slate-300 text-petrol-700"
                        />
                        Requiere autorización previa
                      </label>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      {locked ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
          El Administrador de sistema no puede perder los permisos de usuarios, roles ni
          configuración: son necesarios para recuperar el sistema desde la interfaz.
        </p>
      ) : null}
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Guardando…">Guardar permisos de {roleName}</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DepartmentDialog({
  department,
}: {
  department?: { id: string; key: string; name: string; order: number; active: boolean };
}) {
  return (
    <Dialog
      title={department ? `Editar área ${department.name}` : 'Nueva área'}
      triggerVariant={department ? 'secondary' : 'gold'}
      triggerSize="sm"
      width="sm"
      trigger={department ? 'Editar' : 'Nueva área'}
    >
      <ActionForm action={saveDepartmentAction} closeOnSuccess>
        {department ? <input type="hidden" name="id" value={department.id} /> : null}
        <Field
          label="Clave"
          name="key"
          required
          hint="Identificador técnico en MAYÚSCULAS. No cambia después de creada."
        >
          <Input
            name="key"
            required
            defaultValue={department?.key ?? ''}
            readOnly={Boolean(department)}
            pattern="[A-Z0-9_]+"
            placeholder="SPA"
          />
        </Field>
        <Field label="Nombre" name="name" required>
          <Input name="name" required defaultValue={department?.name ?? ''} maxLength={80} />
        </Field>
        <Field label="Orden" name="order">
          <Input type="number" name="order" min={0} max={999} defaultValue={department?.order ?? 0} />
        </Field>
        <Checkbox name="active" label="Área activa" defaultChecked={department?.active ?? true} />
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">
          Desactivar retira el área de los selectores y conserva sus cuentas, pertenencias e historial.
          El servidor bloqueará la desactivación si hay asignaciones vigentes o futuras, incluso en borradores.
          Revisa y resuelve las futuras desde Equipo; las jornadas en curso deben terminar antes de continuar.
        </p>
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Guardando…">Guardar área</SubmitButton>
        </div>
      </ActionForm>
    </Dialog>
  );
}

export function SettingForm({
  settingKey,
  value,
  kind,
}: {
  settingKey: string;
  value: string;
  kind: 'boolean' | 'number' | 'string';
}) {
  return (
    <ActionForm action={saveSettingAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="key" value={settingKey} />
      <div className="min-w-[180px]">
        <label htmlFor={`value-${settingKey}`} className="label-base">
          Valor
        </label>
        {kind === 'boolean' ? (
          <select
            id={`value-${settingKey}`}
            name="value"
            defaultValue={value}
            className="input-base"
          >
            <option value="true">Activado</option>
            <option value="false">Desactivado</option>
          </select>
        ) : (
          <input
            id={`value-${settingKey}`}
            name="value"
            type={kind === 'number' ? 'number' : 'text'}
            defaultValue={value}
            className="input-base"
          />
        )}
      </div>
      <SubmitButton size="sm" variant="secondary" pendingLabel="Guardando…">
        Guardar
      </SubmitButton>
    </ActionForm>
  );
}

export function ScheduleShiftForm({ users }: { users: Option[] }) {
  return (
    <ActionForm action={scheduleShiftAction} resetOnSuccess>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Fecha" name="date" required>
          <Input type="date" name="date" required />
        </Field>
        <Field label="Turno" name="type" required>
          <Select
            name="type"
            required
            options={[
              { value: 'MANANA', label: 'Mañana (07:00–15:00)' },
              { value: 'TARDE', label: 'Tarde (15:00–23:00)' },
              { value: 'NOCHE', label: 'Noche (23:00–07:00)' },
            ]}
          />
        </Field>
        <Field label="Notas" name="notes">
          <Input name="notes" />
        </Field>
      </div>

      {/*
        Horario a medida. Vacío = el horario nominal del tipo de turno, que es
        el caso normal. Se llena cuando hay que cubrir algo que no encaja: una
        jornada de doce horas, una entrada a las 6. Las dos casillas van
        juntas: una hora sin duración sería una ventana a medias, y el servidor
        las ignora si falta una.
      */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Hora de inicio (opcional)"
          name="startTime"
          hint="Vacío usa el horario del turno."
        >
          <Input type="time" name="startTime" />
        </Field>
        <Field
          label="Duración en horas (opcional)"
          name="durationHours"
          hint="Hasta 12. Horas o medias horas."
        >
          <Input
            type="number"
            name="durationHours"
            min={0.5}
            max={12}
            step={0.5}
            placeholder="8"
          />
        </Field>
      </div>

      <Field
        label="Personal asignado"
        name="userIds"
        required
        hint="El primero seleccionado queda como titular. Sólo aparece personal operativo."
      >
        <select
          id="userIds"
          name="userIds"
          multiple
          required
          size={Math.min(8, Math.max(4, users.length))}
          className="input-base h-auto"
        >
          {users.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      <div className="flex justify-end">
        <SubmitButton pendingLabel="Programando…">Programar turno</SubmitButton>
      </div>
    </ActionForm>
  );
}
