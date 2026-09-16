'use client';

import { useState } from 'react';
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
        {/*
          Una cuenta es nombre, usuario y contraseña. El correo se quitó: en el
          mesón nadie usaba el suyo, no servía para entrar y era un campo más
          que alguien tenía que inventar. La clave la genera el sistema.
        */}
        <Field
          label="Usuario"
          name="username"
          hint={suggested ? `Si lo dejas vacío será @${suggested}.` : 'Se propone a partir del nombre.'}
        >
          <Input name="username" placeholder={suggested ? `@${suggested}` : '@EHerrera'} maxLength={30} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rol" name="roleId" required>
            <Select name="roleId" placeholder="Selecciona un rol" options={roles} required />
          </Field>
          <Field label="Área" name="departmentId">
            <Select name="departmentId" placeholder="Sin área" options={departments} />
          </Field>
        </div>
        <Field label="Teléfono" name="phone">
          <Input name="phone" />
        </Field>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          La clave la genera el sistema y se envía a <strong>{credentialsMailTo}</strong>. Nadie la
          escribe aquí, y no queda guardada en claro en ninguna parte.
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
    phone: string | null;
    active: boolean;
  };
  roles: Option[];
  departments: Option[];
}) {
  return (
    <Dialog title={`Editar ${user.name}`} triggerVariant="secondary" triggerSize="sm" trigger="Editar">
      <ActionForm action={updateUserAction} closeOnSuccess>
        <input type="hidden" name="id" value={user.id} />
        <Field label="Nombre" name="name" required>
          <Input name="name" defaultValue={user.name} required maxLength={120} />
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
          <Field label="Área" name="departmentId">
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
        <Checkbox name="active" label="Cuenta activa" defaultChecked={user.active} />
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

export function DeleteUserDialog({ userId, name }: { userId: string; name: string }) {
  return (
    <Dialog
      title={`Eliminar a ${name}`}
      description="Eliminación lógica: se desactiva la cuenta y se conservan sus registros históricos."
      triggerVariant="secondary"
      triggerSize="sm"
      width="sm"
      trigger="Eliminar"
    >
      <ActionForm action={deleteUserAction} closeOnSuccess>
        <input type="hidden" name="id" value={userId} />
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
  locked,
}: {
  roleId: string;
  roleName: string;
  groups: Array<{ group: string; permissions: Array<{ key: string; name: string }> }>;
  granted: string[];
  locked: boolean;
}) {
  return (
    <ActionForm action={updateRolePermissionsAction}>
      <input type="hidden" name="roleId" value={roleId} />
      <div className="space-y-4">
        {groups.map((group) => (
          <fieldset key={group.group}>
            <legend className="text-xs font-semibold text-petrol-700">
              {group.group}
            </legend>
            <div className="mt-1 grid gap-1 sm:grid-cols-2">
              {group.permissions.map((permission) => (
                <label
                  key={permission.key}
                  className="flex items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    name="permissions"
                    value={permission.key}
                    defaultChecked={granted.includes(permission.key)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-petrol-700"
                  />
                  <span>
                    <span className="block text-petrol-900">{permission.name}</span>
                    <code className="block text-[0.7rem] text-slate-400">{permission.key}</code>
                  </span>
                </label>
              ))}
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
