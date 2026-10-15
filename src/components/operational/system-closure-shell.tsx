import { Fragment } from 'react';
import Link from 'next/link';
import type { CurrentUser } from '@/server/auth/current-user';
import { canAccessHousekeeping } from '@/domain/housekeeping';
import { logoutAction } from '@/server/actions/auth';
import { FormDraftSession } from './form-draft-session';
import { MaintenanceWatcher } from './maintenance-watcher';

/** Minimal shell for the existing routes while staff finish their real work. */
export function SystemClosureShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
    return <div className="min-h-screen bg-[var(--aroh-canvas)]">
      <MaintenanceWatcher closing />
      <header className="border-b border-slate-200 bg-white px-4 py-5 no-print">
        <div className="mx-auto max-w-5xl space-y-3">
          <p className="text-sm font-semibold text-petrol-900">AROH Central IA · Hotel HW Libertad</p>
          <h1 className="text-xl font-semibold text-petrol-950">Gracias por el trabajo compartido</h1>
          <p className="max-w-2xl text-sm text-slate-600">Estamos finalizando la operación del sistema. Revisa Caja y custodia, envía la entrega y cierra tu turno. Si ya terminaste, no necesitas abrir otro.</p>
          <nav aria-label="Finalizar operación" className="flex flex-wrap items-center gap-4 text-sm">
            <Link href="/turno" className="font-semibold underline">Mi turno</Link>
            {user.permissions.includes('cash.view') && <Link href="/caja" className="underline">Caja</Link>}
            {user.permissions.includes('supervision.shift.manage') && <Link href="/supervision" className="underline">Finalizar Supervisión</Link>}
            {user.permissions.includes('workday.manage') && <Link href="/jornada" className="underline">Finalizar mi jornada</Link>}
            {canAccessHousekeeping(user) && <Link href="/housekeeping" className="underline">Finalizar relevo de Housekeeping</Link>}
            <form action={logoutAction} className="ml-auto"><button className="underline">Cerrar sesión</button></form>
          </nav>
        </div>
      </header>
      <main id="contenido-principal" className="mx-auto max-w-5xl px-4 py-6"><Fragment key="aroh-route-content"><FormDraftSession userId={user.id} />{children}</Fragment></main>
    </div>;
}
