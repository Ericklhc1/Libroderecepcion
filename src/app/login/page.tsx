import { redirect } from 'next/navigation';
import { BookOpen } from 'lucide-react';
import { getCurrentUser } from '@/server/auth/current-user';
import { needsInstall } from '@/server/services/install';
import { getSettingString } from '@/server/services/settings';
import { LoginForm } from './login-form';

export const metadata = { title: 'Iniciar sesión' };

/*
  Nunca pre-generar esta página. Su respuesta depende de si la base tiene
  cuentas: pre-generada durante la compilación —cuando la base está vacía—
  queda congelada redirigiendo a la instalación, y en cuanto existe la primera
  cuenta se forma un bucle con /instalacion, que redirige de vuelta aquí.
*/
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Despliegue nuevo, sin ninguna cuenta todavía: se instala primero.
  if (await needsInstall()) redirect('/instalacion');

  const user = await getCurrentUser();
  if (user) redirect('/');

  const hotelName = await getSettingString('hotel.name', 'Hotel').catch(() => 'Hotel');
  const showDemoHint = process.env.NODE_ENV !== 'production';

  return (
    <main className="flex min-h-screen items-center justify-center bg-petrol-900 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3 text-white">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-500 text-petrol-950">
            <BookOpen className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-medium text-gold-300">{hotelName}</p>
            <h1 className="text-lg font-semibold">Libro Operativo de Recepción</h1>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-xl">
          <h2 className="text-base font-semibold text-petrol-900">Iniciar sesión</h2>
          <p className="mt-1 text-sm text-slate-500">
            Accede con tu cuenta operativa para entrar a tu turno.
          </p>
          <div className="mt-5">
            <LoginForm />
          </div>
        </div>

        {showDemoHint ? (
          <div className="mt-5 rounded-xl bg-petrol-800/60 p-4 text-xs text-petrol-100 ring-1 ring-petrol-700">
            <p className="font-semibold text-gold-300">Cuentas demo (sólo desarrollo)</p>
            {/* Se entra con el USUARIO, así que es lo que se muestra. */}
            <ul className="mt-2 space-y-1">
              <li>@SReyes · Administrador de sistema</li>
              <li>@MPinto · Supervisor</li>
              <li>@DAlarcn · Recepcionista</li>
              <li>@CVera · Recepcionista</li>
              <li>@RNez · Auditor nocturno</li>
            </ul>
            <p className="mt-2 text-petrol-200">
              Contraseña: la definida en <code className="text-gold-200">SEED_DEMO_PASSWORD</code>.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
