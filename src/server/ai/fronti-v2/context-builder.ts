import 'server-only';

import type { CurrentUser } from '@/server/auth/current-user';
import { env } from '@/lib/env';
import { getMyOpenShift } from '@/server/services/shifts';

export type FrontiPageContext = {
  pathname: string;
  entityType?: string | null;
  entityId?: string | null;
  label?: string | null;
};

export type FrontiRuntimeContext = {
  user: {
    id: string;
    name: string;
    roleKey: string;
    roleName: string;
    roleLevel: number;
    isSystemAdmin: boolean;
    departmentId: string | null;
    permissions: string[];
  };
  shift: {
    id: string;
    type: string;
    status: string;
    date: string;
    plannedStart: string;
    plannedEnd: string;
    actualStart: string | null;
    actualEnd: string | null;
  } | null;
  page: FrontiPageContext | null;
  clock: {
    timezone: string;
    nowIso: string;
    local: string;
  };
};

export async function buildFrontiRuntimeContext(
  user: CurrentUser,
  page: FrontiPageContext | null,
): Promise<FrontiRuntimeContext> {
  const shift = user.roleOperational ? await getMyOpenShift(user.id) : null;
  const timezone = env().HOTEL_TIMEZONE;
  const now = new Date();

  return {
    user: {
      id: user.id,
      name: user.name,
      roleKey: user.roleKey,
      roleName: user.roleName,
      roleLevel: user.roleLevel,
      isSystemAdmin: user.isSystemAdmin,
      departmentId: user.departmentId,
      permissions: [...user.permissions].sort(),
    },
    shift: shift
      ? {
          id: shift.id,
          type: shift.type,
          status: shift.status,
          date: shift.date.toISOString(),
          plannedStart: shift.plannedStart.toISOString(),
          plannedEnd: shift.plannedEnd.toISOString(),
          actualStart: shift.actualStart?.toISOString() ?? null,
          actualEnd: shift.actualEnd?.toISOString() ?? null,
        }
      : null,
    page,
    clock: {
      timezone,
      nowIso: now.toISOString(),
      local: now.toLocaleString('es-CL', { timeZone: timezone }),
    },
  };
}

export function runtimeContextMessage(context: FrontiRuntimeContext): string {
  return [
    'CONTEXTO DE EJECUCIÓN DE FRONTI V2 (estructurado; no reemplaza las fuentes de verdad):',
    JSON.stringify(context),
    'Usa este contexto para resolver referencias del usuario, decidir qué herramientas consultar y respetar sus permisos.',
    'Los estados operativos cambiantes deben verificarse con herramientas del Libro antes de afirmarlos.',
  ].join('\n');
}
