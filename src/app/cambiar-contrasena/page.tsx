import Link from 'next/link';
import { KeyRound } from 'lucide-react';
import { requirePageUser } from '@/server/auth/guard';
import { ChangePasswordForm } from './change-password-form';

export const metadata = { title: 'Cambiar contraseña' };

export default async function ChangePasswordPage() {
  const user = await requirePageUser({ allowIncompleteAccess: true });

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f3f6f8] px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-slate-300 border-t-2 border-t-gold-500 bg-white p-6 shadow-card">
        <span className="flex h-11 w-11 items-center justify-center rounded-md bg-petrol-50 text-petrol-700">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-petrol-900">Cambiar contraseña</h1>
        <p className="mt-1 text-sm text-slate-600">
          {user.mustChangePassword
            ? 'Por seguridad debes definir una contraseña propia antes de continuar.'
            : 'Al cambiarla se cerrarán tus otras sesiones activas.'}
        </p>
        <p className="mt-3 rounded-md bg-[#f8fafc] px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          Mínimo 10 caracteres, con mayúscula, minúscula y número.
        </p>
        <div className="mt-5">
          <ChangePasswordForm />
        </div>
        {user.mustChangePassword ? null : (
          <Link
            href="/"
            className="mt-4 inline-block text-xs font-medium text-petrol-600 hover:underline"
          >
            Volver al inicio
          </Link>
        )}
      </div>
    </main>
  );
}
