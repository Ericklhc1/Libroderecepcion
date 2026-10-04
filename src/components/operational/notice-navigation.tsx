import {hkNavigationAllowed} from '@/domain/housekeeping-work';
import type {PermissionKey} from '@/lib/permissions';
import Link from 'next/link';

/** Human views of the existing notification, alarm and continuity routes. */
export function NoticeNavigation({current,permissions}:{permissions:PermissionKey[];current:'received'|'reminders'|'continuity'}){
  const views=[{id:'received',href:'/notificaciones',label:'Recibidos'},{id:'reminders',href:'/alertas',label:'Recordatorios'},{id:'continuity',href:'/seguimientos?mios=1',label:'Pendientes que continúan'}];
  return <nav aria-label="Avisos" className="flex flex-wrap gap-2">{views.filter(view=>hkNavigationAllowed(permissions,view.href.split('?')[0])).map(view=><Link key={view.id} href={view.href} aria-current={current===view.id?'page':undefined} className={current===view.id?'rounded-lg bg-petrol-800 px-3 py-2 text-sm font-semibold text-white':'rounded-lg bg-white px-3 py-2 text-sm font-medium text-petrol-800 ring-1 ring-slate-200'}>{view.label}</Link>)}</nav>;
}
