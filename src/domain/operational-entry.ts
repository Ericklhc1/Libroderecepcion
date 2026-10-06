import {ROLE_KEYS, isReceptionDeskRole} from '@/lib/permissions';
import type {CurrentUser} from '@/server/auth/current-user';
import {isHkFocused} from './housekeeping-work';

/** La entrada prioriza el trabajo vigente sin conceder permisos ni cambiar rutas históricas. */
export function operationalLanding(user:Pick<CurrentUser,'roleKey'|'permissions'|'isSystemAdmin'>,areaKey?:string|null):string|null{
  if(user.isSystemAdmin)return null;
  if(isHkFocused(user))return '/housekeeping';
  if(user.roleKey===ROLE_KEYS.MANAGEMENT&&user.permissions.includes('management.dashboard.view'))return '/gerencia';
  if(!isReceptionDeskRole(user.roleKey)&&areaKey==='MANTENIMIENTO')return '/coordinacion?vista=unreceived';
  if(user.roleKey===ROLE_KEYS.SUPERVISOR&&user.permissions.includes('supervision.center.view'))return '/supervision?seccion=senales#senales';
  if(user.roleKey===ROLE_KEYS.RESERVATIONS_CENTER)return '/coordinacion?mios=1';
  return null;
}
