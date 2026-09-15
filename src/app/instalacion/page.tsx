import { redirect } from 'next/navigation';
import { BookOpen, ShieldCheck } from 'lucide-react';
import { needsInstall } from '@/server/services/install';
import { InstallForm } from './install-form';

export const metadata = { title: 'Instalación' };
export const dynamic = 'force-dynamic';

/*
  Sembrar el catálogo o aplicar tres informes completos toma más que los diez
  segundos que la plataforma concede por omisión a una función.
*/
export const maxDuration = 60;

/**
 * Pantalla de instalación inicial. Sólo existe mientras la base de datos no
 * tenga ningún usuario: en cuanto hay uno, redirige al inicio de sesión.
 */
export default async function InstallPage() {
  if (!(await needsInstall())) redirect('/login');

  return (
    <main className="flex min-h-screen items-center justify-center bg-petrol-900 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-3 text-white">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-500 text-petrol-950">
            <BookOpen className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-medium text-gold-300">Instalación</p>
            <h1 className="text-lg font-semibold">Libro Operativo de Recepción</h1>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="text-base font-semibold text-petrol-900">Poner en marcha el sistema</h2>
          <p className="mt-1 text-sm text-slate-600">
            Se hace una sola vez. Crea el hotel y tu cuenta de Administrador de sistema; desde
            ella agregarás al equipo y programarás los turnos.
          </p>
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-petrol-600" aria-hidden="true" />
            <span>
              Esta pantalla deja de existir en cuanto se crea la primera cuenta. La contraseña
              necesita al menos 10 caracteres, con mayúscula, minúscula y número.
            </span>
          </p>
          <div className="mt-5">
            <InstallForm />
          </div>
        </div>
      </div>
    </main>
  );
}
