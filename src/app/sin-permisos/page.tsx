import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';

export const metadata = { title: 'Sin permisos' };

export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-card">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-700">
          <ShieldAlert className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-petrol-900">
          No tienes acceso a esta sección
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Tu rol no incluye los permisos necesarios. Si crees que deberías tener acceso,
          solicítalo al Administrador de sistema.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex rounded-lg bg-petrol-700 px-4 py-2 text-sm font-medium text-white hover:bg-petrol-800"
        >
          Volver al inicio
        </Link>
      </div>
    </main>
  );
}
