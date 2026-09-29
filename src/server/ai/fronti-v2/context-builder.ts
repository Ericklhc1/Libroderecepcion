import 'server-only';

import type { CurrentUser } from '@/server/auth/current-user';
import { env } from '@/lib/env';
import { getMyOpenShift } from '@/server/services/shifts';
import {
  resolveFrontiPageContext,
  type FrontiPageInput,
  type FrontiResolvedPageContext,
} from './page-context';

export type FrontiPageContext = FrontiResolvedPageContext;

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
  page: FrontiResolvedPageContext | null;
  clock: {
    timezone: string;
    nowIso: string;
    local: string;
  };
};

export async function buildFrontiRuntimeContext(
  user: CurrentUser,
  page: FrontiPageInput | null,
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
    page: page ? resolveFrontiPageContext(page) : null,
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
    'moduleLabel/sectionLabel indican exactamente dónde está el usuario; filters representan los filtros visibles de la URL y recommendedTools son las capacidades de lectura más pertinentes para esa pantalla.',
    'Si el usuario dice «aquí», «esto», «esta pantalla», «este registro», «qué falta» o una referencia similar, interpreta primero el contexto de pantalla y verifica los estados cambiantes con herramientas antes de afirmarlos.',
  ].join('\n');
}
