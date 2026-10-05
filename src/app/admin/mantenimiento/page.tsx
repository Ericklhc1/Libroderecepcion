import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requirePageUser } from '@/server/auth/guard';
import { getMaintenanceState } from '@/server/services/system-maintenance';
import { MAINTENANCE_MESSAGE } from '@/domain/system-maintenance';
import { SystemMaintenanceForm } from '@/components/admin/system-maintenance-form';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Modo mantenimiento' };

export default async function SystemMaintenancePage() {
  const user = await requirePageUser({ allowAreaOperation: true });
  if (!user.isSystemAdmin) redirect('/sin-permisos');
  const state = await getMaintenanceState();
  return <main className="mx-auto max-w-2xl space-y-5 px-4 py-8">
    <Link href="/admin" className="text-sm underline">Volver a Administración</Link>
    <h1 className="text-xl font-semibold text-petrol-900">Modo mantenimiento</h1>
    <section className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
      <p className="font-semibold">Estado: {state.enabled ? 'Activado' : 'Desactivado'}</p>
      {!state.valid && <p role="alert">El control necesita reparación. La operación permanece pausada; puedes desactivarlo aquí.</p>}
      <p>{MAINTENANCE_MESSAGE}</p>
      {state.startedAt && <p className="text-sm">Activado: {formatDateTime(new Date(state.startedAt))}</p>}
      <p className="text-sm text-slate-600">Pausa el acceso y las acciones del personal, incluidas solicitudes API y procesos automáticos. El Administrador de sistema conserva acceso para revisar y reabrir. Los datos, turnos y permisos se conservan.</p>
      <p className="text-sm text-slate-600">No hay reapertura automática. Este estado se conserva entre versiones compatibles. Las solicitudes que ya estaban ejecutándose pueden terminar; comprueba su finalización antes de actualizar.</p>
      <SystemMaintenanceForm state={state} />
    </section>
  </main>;
}
