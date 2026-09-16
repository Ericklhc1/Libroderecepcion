import Link from 'next/link';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { getResetPreview, RESET_PHRASE } from '@/server/services/factory-reset';
import { Card, CardHeader } from '@/components/ui/card';
import { FactoryResetForm } from '@/components/admin/factory-reset-form';

export const metadata = { title: 'Puesta en cero' };
export const dynamic = 'force-dynamic';
/* Puede haber miles de filas y la base está en otra región. */
export const maxDuration = 120;

/** Lo que se va a borrar, agrupado como lo entiende el mesón. */
const GROUPS: Array<{ title: string; keys: Array<[string, keyof Awaited<ReturnType<typeof getResetPreview>>]> }> = [
  {
    title: 'Libro operativo',
    keys: [
      ['Registros (novedades, incidencias…)', 'entries'],
      ['Tareas', 'tasks'],
      ['Seguimientos', 'followUps'],
      ['Alertas', 'alerts'],
      ['Comentarios', 'comments'],
    ],
  },
  {
    title: 'Turnos y caja',
    keys: [
      ['Turnos', 'shifts'],
      ['Entregas de turno', 'handovers'],
      ['Arqueos de caja', 'cashCounts'],
    ],
  },
  {
    title: 'Supervisión',
    keys: [
      ['Comunicados', 'announcements'],
      ['Rondas de supervisión', 'checklistRuns'],
      ['Listas de control', 'checklistTemplates'],
      ['Multas', 'fines'],
    ],
  },
  {
    title: 'Huéspedes y reservas',
    keys: [
      ['Huéspedes', 'guests'],
      ['Reservas', 'reservations'],
    ],
  },
  {
    title: 'Otros',
    keys: [
      ['Notificaciones', 'notifications'],
      ['Auditoría', 'auditLogs'],
    ],
  },
];

export default async function FactoryResetPage() {
  const user = await requirePagePermission('system.configure');
  const preview = await getResetPreview();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a Administración
      </Link>

      <header>
        <h1 className="text-xl font-semibold text-petrol-900">
          Dejar el sistema en cero
        </h1>
        <p className="mt-0.5 text-sm text-slate-600">
          Para empezar a operar con el libro limpio, sin los datos de las pruebas.
        </p>
      </header>

      {/*
        La advertencia va ARRIBA y con el número real de filas. Una puesta en
        cero es lo único del sistema que borra de verdad: en todo lo demás la
        eliminación es lógica y el administrador restaura. Decirlo importa.
      */}
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="flex items-start gap-2 font-medium text-red-900">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          Esto borra de verdad y no se puede deshacer.
        </p>
        <p className="mt-2 text-sm text-red-900">
          En el resto del sistema nada se borra: se marca como eliminado y se puede
          restaurar. Aquí no. Es un gesto de instalación, pensado para ejecutarse{' '}
          <strong>una vez, antes de que existan datos reales</strong>.
        </p>
      </div>

      <Card>
        <CardHeader title="Qué se va a borrar" />
        <div className="divide-y divide-slate-100">
          {GROUPS.map((group) => (
            <div key={group.title} className="px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {group.title}
              </p>
              <ul className="mt-1.5 space-y-1">
                {group.keys.map(([label, key]) => (
                  <li key={key} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-slate-700">{label}</span>
                    <span
                      className={`tabular font-medium ${
                        preview[key] > 0 ? 'text-petrol-900' : 'text-slate-400'
                      }`}
                    >
                      {preview[key]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Qué se conserva" />
        <div className="px-4 py-3 text-sm text-slate-700">
          <p>
            El <strong>catálogo</strong>, que es la instalación del hotel: roles y
            permisos, áreas, las habitaciones, las llaves con su numeración, las
            denominaciones de efectivo, el fondo fijo, los elementos de entrega y los
            parámetros del sistema.
          </p>
          <p className="mt-2">
            Y <strong>tu cuenta</strong> ({user.name}). Nunca se borra la cuenta que
            ejecuta la puesta en cero: si se borrara, el hotel se quedaría sin forma de
            entrar a su propio sistema.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Las llaves no se borran —están numeradas y cuestan dinero— pero se
            desligan de su estadía y vuelven a «disponible», que es su estado de
            inventario.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Confirmar" />
        <div className="px-4 py-4">
          <FactoryResetForm
            phrase={RESET_PHRASE}
            stays={preview.stays}
            batches={preview.batches}
            users={preview.users}
          />
        </div>
      </Card>
    </div>
  );
}
