import Link from 'next/link';
import { requirePagePermission } from '@/server/auth/guard';
import { getManagementWorkday } from '@/server/services/management-workday';
import { ActionForm, Field, Select, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Card, EmptyState } from '@/components/ui/card';
import { formatDateTime } from '@/lib/format';
import {
  finishManagementWorkdayAction,
  startManagementWorkdayAction,
} from '@/server/actions/management-workday';

export const metadata = { title: 'Mi jornada' };
export const dynamic = 'force-dynamic';

export default async function ManagementWorkdayPage() {
  const user = await requirePagePermission('workday.manage');
  const data = await getManagementWorkday(user);
  const openIds = new Set(data.active.map(row => row.departmentId).filter(Boolean));
  const available = data.departments.filter(row => !openIds.has(row.id));

  return <div className="mx-auto max-w-5xl space-y-4">
    <header>
      <h1 className="text-xl font-semibold text-petrol-900">Mi jornada</h1>
      <p className="mt-1 text-sm text-slate-600">
        Identifica cuándo ejerces una jefatura y da continuidad a tus decisiones. No abre Caja, no inicia un turno de Recepción y no acredita asistencia.
      </p>
    </header>

    <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
      <p className="font-semibold">Tres conceptos separados</p>
      <p className="mt-1">Horario publicado = planificación. Mi jornada = ejercicio de jefatura. Mi turno = relevo operativo de Recepción y Caja.</p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Link href="/equipo" className="underline">Consultar Equipo y horarios</Link>
        {user.permissions.includes('shift.view') ? <Link href="/turno" className="underline">Ir a Mi turno</Link> : null}
      </div>
    </section>

    {data.active.length > 0 ? <section className="space-y-3">
      <h2 className="font-semibold text-petrol-900">Jornadas abiertas</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {data.active.map(row => <Card key={row.id}>
          <div className="p-4">
            <p className="font-semibold text-petrol-900">{row.department?.name ?? 'Área'}</p>
            <p className="mt-1 text-sm text-slate-600">Iniciada {formatDateTime(row.startedAt)}</p>
            <p className="mt-2 text-xs text-slate-500">Cerrar esta jornada no cierra la de otra persona ni modifica el turno de Recepción. Los pendientes permanecen en su fuente.</p>
            <ActionForm action={finishManagementWorkdayAction} refreshOnSuccess className="mt-4 space-y-3">
              <input type="hidden" name="shiftId" value={row.id} />
              <Field label="Nota de continuidad" name="note" hint="Opcional. Úsala sólo si aporta contexto al cierre.">
                <Textarea name="note" rows={2} maxLength={4000} placeholder="Ej.: queda pendiente revisión de lavandería" />
              </Field>
              <SubmitButton variant="secondary" pendingLabel="Cerrando…">Cerrar mi jornada</SubmitButton>
            </ActionForm>
          </div>
        </Card>)}
      </div>
    </section> : null}

    <Card>
      <div className="p-4">
        <h2 className="font-semibold text-petrol-900">Iniciar jornada de jefatura</h2>
        <p className="mt-1 text-sm text-slate-600">Sólo aparecen áreas que pertenecen a tu alcance vigente. Las coberturas temporales conservan su vigencia y trazabilidad.</p>
        {available.length ? <ActionForm action={startManagementWorkdayAction} refreshOnSuccess className="mt-4 max-w-xl">
          <Field label="Área" name="departmentId" required>
            <Select name="departmentId" required options={available.map(row => ({ value: row.id, label: row.name }))} />
          </Field>
          <SubmitButton pendingLabel="Iniciando…">Iniciar mi jornada</SubmitButton>
        </ActionForm> : <EmptyState message={data.active.length ? 'Ya tienes abiertas todas las áreas disponibles para tu alcance.' : 'No tienes un área habilitada para iniciar jornada.'} hint="Administración puede revisar tu área principal, pertenencias y coberturas temporales sin duplicar tu usuario." />}
      </div>
    </Card>

    {data.recent.length > 0 ? <section className="space-y-2">
      <h2 className="font-semibold text-petrol-900">Jornadas recientes</h2>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {data.recent.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
          <div><span className="font-medium text-petrol-900">{row.department?.name ?? 'Área'}</span><span className="ml-2 text-slate-500">#{row.humanId}</span></div>
          <div className="text-slate-600">{formatDateTime(row.startedAt)} → {row.finishedAt ? formatDateTime(row.finishedAt) : 'sin cierre registrado'}</div>
        </div>)}
      </div>
    </section> : null}
  </div>;
}
