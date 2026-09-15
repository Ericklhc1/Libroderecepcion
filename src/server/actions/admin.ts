'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { AuditAction } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { formDataToObject, parseOrThrow, runAction, type ActionState } from '@/server/action';
import {
  departmentSchema,
  rolePermissionsSchema,
  settingSchema,
  softDeleteSchema,
  userCreateSchema,
  userUpdateSchema,
} from '@/server/schemas';
import { requirePermission } from '@/server/auth/guard';
import { hashPassword, passwordSchema } from '@/server/auth/password';
import { revokeAllUserSessions } from '@/server/auth/session';
import { recordAudit, diffFields } from '@/server/audit';
import { AppError, NotFoundError, RuleError } from '@/server/errors';
import { ROLE_KEYS } from '@/lib/permissions';
import { DEFAULT_SETTINGS, getSettingString, type SettingKey } from '@/server/services/settings';
import { allocateUsername, deliverCredentials, generatePassword } from '@/server/services/credentials';
import { runAlertEngine } from '@/server/services/alert-engine';

/** Impide quedarse sin administradores activos. */
async function assertAdminRemains(excludeUserId: string) {
  const remaining = await prisma.user.count({
    where: {
      id: { not: excludeUserId },
      active: true,
      deletedAt: null,
      role: { key: ROLE_KEYS.SYSTEM_ADMIN },
    },
  });
  if (remaining === 0) {
    throw new RuleError(
      'Debe existir al menos un Administrador de sistema activo. Asigna el rol a otro usuario antes de continuar.',
    );
  }
}

export async function createUserAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('user.manage');
    const input = parseOrThrow(userCreateSchema, formDataToObject(formData));

    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new AppError('Ya existe un usuario con ese correo.', 'DUPLICATE');

    const role = await prisma.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw new NotFoundError('El rol indicado no existe.');

    /*
      La clave la genera el sistema, no la escribe nadie: así ninguna cuenta
      nace con una contraseña débil ni reutilizada. Viaja una sola vez al
      correo de recepción y se pide cambiarla en el primer ingreso.
    */
    const password = generatePassword();
    const username = await allocateUsername(input.name, input.username ?? null);

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        username,
        roleId: input.roleId,
        departmentId: input.departmentId,
        phone: input.phone,
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
      },
    });

    const hotelName = await getSettingString('hotel.name', 'el hotel');
    const delivery = await deliverCredentials({
      name: user.name,
      username,
      email: user.email,
      password,
      roleName: role.name,
      hotelName,
    });

    await recordAudit({
      entity: 'User',
      entityId: user.id,
      action: AuditAction.CREAR,
      summary:
        `Usuario creado: ${user.name} (@${username}) <${user.email}> con rol ${role.name}. ` +
        (delivery.sent
          ? `Credenciales enviadas a ${delivery.recipient}.`
          : 'No se pudo enviar el correo con las credenciales.'),
      user: actor,
      after: { name: user.name, email: user.email, username, roleId: role.id, role: role.name },
    });

    revalidatePath('/admin/usuarios');
    /*
      La clave va en `credentials`, no dentro del mensaje. Antes iba en el
      texto y el diálogo se cerraba al tener éxito, así que la clave —que no
      se puede recuperar— desaparecía antes de que nadie pudiera leerla: el
      usuario quedaba creado y sin forma de entrar.
    */
    return {
      ok: true as const,
      message: `Usuario @${username} creado.`,
      id: user.id,
      credentials: {
        name: user.name,
        username,
        email: user.email,
        password,
        recipient: delivery.recipient,
        sent: delivery.sent,
        reason: delivery.reason,
      },
    };
  });
}

export async function updateUserAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('user.manage');
    const input = parseOrThrow(userUpdateSchema, formDataToObject(formData));

    const current = await prisma.user.findFirst({
      where: { id: input.id, deletedAt: null },
      include: { role: true },
    });
    if (!current) throw new NotFoundError('El usuario no existe.');

    const roleChanged = current.roleId !== input.roleId;
    if (roleChanged) {
      // Cambiar roles es gestión de permisos: requiere su propio permiso.
      await requirePermission('role.manage');
    }

    const losesAdmin =
      current.role.key === ROLE_KEYS.SYSTEM_ADMIN && (roleChanged || !input.active);
    if (losesAdmin) await assertAdminRemains(current.id);

    const updated = await prisma.user.update({
      where: { id: input.id },
      data: {
        name: input.name,
        email: input.email,
        roleId: input.roleId,
        departmentId: input.departmentId,
        phone: input.phone,
        active: input.active,
      },
      include: { role: true },
    });

    // Un usuario desactivado o con rol nuevo no debe conservar sesiones vivas.
    if (!updated.active || roleChanged) {
      await revokeAllUserSessions(updated.id);
    }

    const changes = diffFields(
      current as unknown as Record<string, unknown>,
      {
        name: input.name,
        email: input.email,
        roleId: input.roleId,
        departmentId: input.departmentId,
        phone: input.phone,
        active: input.active,
      },
      ['name', 'email', 'roleId', 'departmentId', 'phone', 'active'],
    );

    await recordAudit({
      entity: 'User',
      entityId: updated.id,
      action: roleChanged ? AuditAction.PERMISOS : AuditAction.EDITAR,
      summary: roleChanged
        ? `Rol de ${updated.name}: ${current.role.name} → ${updated.role.name}`
        : `Usuario ${updated.name} actualizado (${changes.changed.join(', ') || 'sin cambios'})`,
      user: actor,
      before: changes.before,
      after: changes.after,
    });

    revalidatePath('/admin/usuarios');
    return { ok: true as const, message: 'Usuario actualizado.' };
  });
}

const resetPasswordSchema = z.object({
  id: z.string().min(1),
  password: z.string().min(1),
});

export async function resetUserPasswordAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('user.manage');
    const input = parseOrThrow(resetPasswordSchema, formDataToObject(formData));
    const password = parseOrThrow(passwordSchema, input.password);

    const user = await prisma.user.findFirst({
      where: { id: input.id, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!user) throw new NotFoundError('El usuario no existe.');

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
    await revokeAllUserSessions(user.id);

    await recordAudit({
      entity: 'User',
      entityId: user.id,
      action: AuditAction.EDITAR,
      summary: `Contraseña restablecida para ${user.name}; sesiones revocadas`,
      user: actor,
    });

    revalidatePath('/admin/usuarios');
    return {
      ok: true as const,
      message: 'Contraseña restablecida. El usuario deberá cambiarla al ingresar.',
    };
  });
}

export async function deleteUserAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('user.manage');
    const input = parseOrThrow(softDeleteSchema, formDataToObject(formData));

    if (input.id === actor.id) {
      throw new RuleError('No puedes eliminar tu propia cuenta.');
    }
    const user = await prisma.user.findFirst({
      where: { id: input.id, deletedAt: null },
      include: { role: true },
    });
    if (!user) throw new NotFoundError('El usuario no existe.');
    if (user.role.key === ROLE_KEYS.SYSTEM_ADMIN) await assertAdminRemains(user.id);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        deletedAt: new Date(),
        deletedById: actor.id,
        deletionReason: input.reason,
        active: false,
      },
    });
    await revokeAllUserSessions(user.id);

    await recordAudit({
      entity: 'User',
      entityId: user.id,
      action: AuditAction.ELIMINAR,
      summary: `Usuario ${user.name} desactivado y eliminado lógicamente`,
      user: actor,
      reason: input.reason,
    });

    revalidatePath('/admin/usuarios');
    return { ok: true as const, message: 'Usuario eliminado. Sus registros históricos se conservan.' };
  });
}

export async function restoreUserAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('user.manage');
    const input = parseOrThrow(z.object({ id: z.string().min(1) }), formDataToObject(formData));
    const user = await prisma.user.findFirst({
      where: { id: input.id, NOT: { deletedAt: null } },
    });
    if (!user) throw new NotFoundError('El usuario no está eliminado.');

    await prisma.user.update({
      where: { id: user.id },
      data: { deletedAt: null, deletedById: null, deletionReason: null, active: true },
    });
    await recordAudit({
      entity: 'User',
      entityId: user.id,
      action: AuditAction.RESTAURAR,
      summary: `Usuario ${user.name} restaurado y reactivado`,
      user: actor,
    });
    revalidatePath('/admin/usuarios');
    return { ok: true as const, message: 'Usuario restaurado.' };
  });
}

/** Matriz de permisos por rol. */
export async function updateRolePermissionsAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('role.manage');
    const input = parseOrThrow(rolePermissionsSchema, formDataToObject(formData));

    const role = await prisma.role.findUnique({
      where: { id: input.roleId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundError('El rol no existe.');

    const permissions = await prisma.permission.findMany({
      where: { key: { in: input.permissions } },
      select: { id: true, key: true },
    });

    // Salvaguarda: el rol Administrador de sistema no puede perder el control
    // de usuarios, roles y configuración; de lo contrario el sistema quedaría
    // sin forma de recuperarse desde la interfaz.
    if (role.key === ROLE_KEYS.SYSTEM_ADMIN) {
      const required = ['user.manage', 'role.manage', 'system.configure'];
      const missing = required.filter((key) => !permissions.some((p) => p.key === key));
      if (missing.length > 0) {
        throw new RuleError(
          `El Administrador de sistema no puede perder estos permisos: ${missing.join(', ')}.`,
        );
      }
    }

    const before = role.permissions.map((rp) => rp.permission.key).sort();
    const after = permissions.map((p) => p.key).sort();

    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
          skipDuplicates: true,
        });
      }
    });

    await recordAudit({
      entity: 'Role',
      entityId: role.id,
      action: AuditAction.PERMISOS,
      summary: `Permisos del rol ${role.name} actualizados (${after.length} permisos)`,
      user: actor,
      before: { permissions: before },
      after: { permissions: after },
    });

    revalidatePath('/admin/roles');
    return { ok: true as const, message: `Permisos del rol ${role.name} actualizados.` };
  });
}

export async function saveDepartmentAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('system.configure');
    const input = parseOrThrow(departmentSchema, formDataToObject(formData));

    const department = input.id
      ? await prisma.department.update({
          where: { id: input.id },
          data: { name: input.name, order: input.order, active: input.active },
        })
      : await prisma.department.create({
          data: {
            key: input.key,
            name: input.name,
            order: input.order,
            active: input.active,
          },
        });

    await recordAudit({
      entity: 'Department',
      entityId: department.id,
      action: input.id ? AuditAction.EDITAR : AuditAction.CREAR,
      summary: `Área ${department.name} ${input.id ? 'actualizada' : 'creada'}`,
      user: actor,
      after: { key: department.key, name: department.name, active: department.active },
    });

    revalidatePath('/admin/areas');
    return { ok: true as const, message: `Área ${input.id ? 'actualizada' : 'creada'}.` };
  });
}

export async function saveSettingAction(
  _state: ActionState | null,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('system.configure');
    const input = parseOrThrow(settingSchema, formDataToObject(formData));

    if (!(input.key in DEFAULT_SETTINGS)) {
      throw new NotFoundError('El parámetro indicado no existe.');
    }
    const key = input.key as SettingKey;
    const defaultValue = DEFAULT_SETTINGS[key].value;

    let value: unknown = input.value;
    if (typeof defaultValue === 'boolean') {
      value = input.value === 'true' || input.value === 'on' || input.value === '1';
    } else if (typeof defaultValue === 'number') {
      const parsed = Number(input.value);
      if (!Number.isFinite(parsed)) throw new RuleError('El valor debe ser numérico.');
      value = parsed;
    } else if (input.value.trim().length === 0) {
      throw new RuleError('El valor no puede quedar vacío.');
    }

    const previous = await prisma.systemSetting.findUnique({ where: { key } });
    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { value: value as never, updatedById: actor.id },
      create: {
        key,
        value: value as never,
        category: DEFAULT_SETTINGS[key].category,
        description: DEFAULT_SETTINGS[key].description,
        updatedById: actor.id,
      },
    });

    await recordAudit({
      entity: 'SystemSetting',
      entityId: setting.id,
      action: AuditAction.CONFIGURAR,
      summary: `Parámetro ${key} actualizado`,
      user: actor,
      before: { value: previous?.value ?? defaultValue },
      after: { value },
    });

    revalidatePath('/admin/parametros');
    revalidatePath('/');
    return { ok: true as const, message: 'Parámetro actualizado.' };
  });
}

/** Mantenimiento: recalcula alertas y estados derivados. */
export async function runMaintenanceAction(): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requirePermission('system.configure');
    const result = await runAlertEngine();
    await recordAudit({
      entity: 'System',
      entityId: 'alert-engine',
      action: AuditAction.CONFIGURAR,
      summary: `Mantenimiento ejecutado: ${result.created} alertas nuevas, ${result.resolved} resueltas, ${result.reopened} reabiertas`,
      user: actor,
    });
    revalidatePath('/');
    revalidatePath('/alertas');
    revalidatePath('/admin');
    return {
      ok: true as const,
      message: `Listo: ${result.created} alerta(s) nueva(s), ${result.reopened} reabierta(s), ${result.resolved} resuelta(s).`,
    };
  });
}
