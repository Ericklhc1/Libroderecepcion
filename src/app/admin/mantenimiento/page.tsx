import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePageUser } from '@/server/auth/guard';
import { getMaintenanceState } from '@/server/services/system-maintenance';
import { MAINTENANCE_MESSAGE } from '@/domain/system-maintenance';
import { SystemMaintenanceForm } from '@/components/admin/system-maintenance-form';
import { SystemClosureForm } from '@/components/admin/system-closure-form';
import { getSystemClosureChecklist } from '@/server/services/system-closure';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disponibilidad y cierre ordenado' };

export default async function SystemMaintenancePage() {
  const user = await requirePageUser({ allowAreaOperation: true });
  if (!user.isSystemAdmin) redirect('/sin-permisos');
  const state = await getMaintenanceState();
  const checklist = state.closure ? await getSystemClosureChecklist() : null;
  return <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
    <Link href="/admin" className="text-sm underline">Volver a Administración</Link>
    <h1 className="text-xl font-semibold text-petrol-900">Disponibilidad y cierre ordenado</h1>
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Cierre ordenado del sistema</h2>
      <p className="text-sm">Estado: {state.closure?.phase === 'LOCKED' ? 'Acceso exclusivo de sysadmin' : state.closure ? 'Despedida y cierre operativo' : 'Sin activar'}</p>
      <p className="text-sm text-slate-600">Primero se finalizan los turnos y sus recepciones reales. Después se descarga el respaldo actualizado y se verifica el archivo guardado. Sólo entonces sysadmin puede autorizar expresamente el acceso exclusivo.</p>
      {checklist && <div className="space-y-3">
        <h3 className="font-semibold">Comprobación de pendientes</h3>
        {checklist.ready ? <p role="status" className="text-sm">Los controles operativos están completos. Puedes generar el respaldo actualizado.</p> : <ul className="list-disc space-y-2 pl-5 text-sm">{checklist.blockers.map(item => <li key={item.code}>{item.message} ({item.count}){item.ids.length > 0 && <span className="block break-all text-xs text-slate-500">{item.ids.join(', ')}</span>}</li>)}</ul>}
        {checklist.warnings.length > 0 && <details><summary className="cursor-pointer text-sm">Observaciones del historial</summary><ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{checklist.warnings.map(item => <li key={item.code}>{item.message} ({item.count})</li>)}</ul></details>}
        <p className="text-xs text-slate-600">El respaldo incluye el historial completo de cierres y Libro, con textos, comentarios y auditoría. Comprobación adicional de cierres anteriores: {checklist.requiredClosureHumanIds.join(', ')}. Los adjuntos conservan sus referencias; los archivos binarios requieren su respaldo de almacenamiento.</p>
      </div>}
      <SystemClosureForm key={state.revision} state={state} ready={checklist?.ready ?? false} />
    </section>
    {!state.closure && <>
    <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
      <p className="font-semibold">Estado: {state.enabled ? 'Activado' : 'Desactivado'}</p>
      {!state.valid && <p role="alert">El control necesita reparación. La operación permanece pausada; puedes desactivarlo aquí.</p>}
      <p>{MAINTENANCE_MESSAGE}</p>
      {state.startedAt && <p className="text-sm">Activado: {formatDateTime(new Date(state.startedAt))}</p>}
      <p className="text-sm text-slate-600">Pausa el acceso y las acciones del personal, incluidas solicitudes API y procesos automáticos. El Administrador de sistema conserva acceso para revisar y reabrir. Los datos, turnos y permisos se conservan.</p>
      <p className="text-sm text-slate-600">No hay reapertura automática. Este estado se conserva entre versiones compatibles. Las solicitudes que ya estaban ejecutándose pueden terminar; comprueba su finalización antes de actualizar.</p>
      <SystemMaintenanceForm state={state} />
    </section>
    </>}
  </main>;
}
