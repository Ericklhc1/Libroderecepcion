import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import { getMaintenanceState } from '@/server/services/system-maintenance';
import { logoutAction } from '@/server/actions/auth';
import { MAINTENANCE_MESSAGE } from '@/domain/system-maintenance';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Mantenimiento programado' };

export default async function MaintenancePage() {
  const state = await getMaintenanceState().catch(() => ({ enabled: true, message: MAINTENANCE_MESSAGE }));
  const user = await getCurrentUser().catch(() => null);
  if (!state.enabled) redirect('/');
  return <main className="flex min-h-screen items-center justify-center bg-petrol-950 p-5">
    <section className="w-full max-w-lg space-y-5 rounded-lg bg-white p-8 text-petrol-950">
      <p className="text-sm font-semibold">AROH Central IA · Hotel HW Libertad</p>
      <h1 className="text-xl font-semibold">Mantenimiento programado</h1>
      <p role="status">{state.message}</p>
      <p className="text-sm text-slate-600">La operación estará disponible cuando finalicen los trabajos.</p>
      <form action="/"><button className="btn-secondary inline-flex">Comprobar disponibilidad</button></form>
      {user?.isSystemAdmin ? <Link className="block underline" href="/admin/mantenimiento">Abrir control de mantenimiento</Link> : user
        ? <form action={logoutAction}><button className="text-sm underline">Cerrar sesión</button></form>
        : <Link className="block text-sm underline" href="/login">Acceso de administrador</Link>}
    </section>
  </main>;
}
