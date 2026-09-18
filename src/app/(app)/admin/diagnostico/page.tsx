import Link from 'next/link';
import { ArrowLeft, Bug, CheckCircle2, CircleAlert, DatabaseZap, Wrench } from 'lucide-react';
import { requirePagePermission } from '@/server/auth/guard';
import { getDiagnosticReport } from '@/server/services/diagnostics';
import { getSettingBool } from '@/server/services/settings';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { repairDiagnosticsAction } from '@/server/actions/diagnostics';
import { formatDateTime } from '@/lib/format';

export const metadata = { title: 'Diagnóstico y reparación' };
export const dynamic = 'force-dynamic';

export default async function DiagnosticsPage() {
  await requirePagePermission('system.configure');
  const enabled = await getSettingBool('diagnostics.enabled', true);
  const report = enabled ? await getDiagnosticReport() : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm font-medium text-petrol-600 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Volver a Administración
      </Link>

      <header>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-petrol-900">
          <Bug className="h-5 w-5 text-petrol-600" aria-hidden="true" />
          Diagnóstico y reparación
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Busca inconsistencias de datos, alertas duplicadas, vínculos incorrectos de reservas/habitaciones y errores de ejecución registrados por la aplicación.
        </p>
      </header>

      {!enabled || !report ? (
        <Card>
          <EmptyState
            message="El Centro de diagnóstico está desactivado."
            hint="Actívalo desde Administración → Parámetros → diagnóstico."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card><div className="p-4"><p className="text-xs text-slate-500">Alertas duplicadas</p><p className="mt-1 text-2xl font-semibold tabular text-petrol-900">{report.duplicateAlerts.length}</p></div></Card>
            <Card><div className="p-4"><p className="text-xs text-slate-500">Estadías sin vínculo FNS</p><p className="mt-1 text-2xl font-semibold tabular text-petrol-900">{report.unlinkedStayCount}</p></div></Card>
            <Card><div className="p-4"><p className="text-xs text-slate-500">Asignaciones a corregir</p><p className="mt-1 text-2xl font-semibold tabular text-petrol-900">{report.reservationRoomMismatches.length}</p></div></Card>
            <Card><div className="p-4"><p className="text-xs text-slate-500">Errores de ejecución</p><p className="mt-1 text-2xl font-semibold tabular text-petrol-900">{report.runtimeErrors.length}</p></div></Card>
          </div>

          <Card className="border-gold-300">
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
              <div className="max-w-3xl">
                <h2 className="flex items-center gap-2 font-semibold text-petrol-900">
                  <Wrench className="h-4 w-4" aria-hidden="true" />
                  Reparación segura
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Corrige sólo casos determinísticos: duplicados exactos sin conversaciones ni tareas, vínculos de estadía por ID FNS exacto y proyección de habitación inequívoca. Los conflictos ambiguos se informan, no se alteran.
                </p>
              </div>
              <ActionForm action={repairDiagnosticsAction} className="space-y-0" refreshOnSuccess>
                <SubmitButton variant="gold" pendingLabel="Depurando…">
                  Depurar y reparar
                </SubmitButton>
              </ActionForm>
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="Alertas duplicadas" count={report.duplicateAlerts.length} />
              {report.duplicateAlerts.length === 0 ? <EmptyState message="No se detectaron duplicados exactos." /> : (
                <ul className="divide-y divide-slate-100">
                  {report.duplicateAlerts.map((group) => (
                    <li key={group.signature} className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-petrol-900">{group.title}</p>
                        <Badge tone={group.safeToRepair ? 'resuelto' : 'atencion'}>
                          {group.safeToRepair ? 'Reparable automáticamente' : 'Revisión manual'}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {group.ids.length} copias · estados {group.status.join(', ')}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <CardHeader title="Asignación Reserva ↔ Habitación" count={report.reservationRoomMismatches.length} />
              {report.reservationRoomMismatches.length === 0 ? <EmptyState message="Las proyecciones de habitación están coherentes." /> : (
                <ul className="divide-y divide-slate-100">
                  {report.reservationRoomMismatches.map((row) => (
                    <li key={row.reservationRefId} className="px-4 py-3 text-sm">
                      <p className="font-semibold tabular text-petrol-900">ID FNS {row.fnsId}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        Guardado: {row.currentRoomNumber ?? 'sin habitación'} · activo: {row.activeRooms.join(', ') || 'sin habitación'}
                      </p>
                      <p className="mt-1 text-xs font-medium text-petrol-700">
                        Corrección segura: {row.expectedRoomNumber ?? 'reserva multihabitación → sin habitación única'}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <CardHeader title="Estadías activas potencialmente duplicadas" count={report.duplicateActiveStays.length} />
            {report.duplicateActiveStays.length === 0 ? (
              <EmptyState message="No se detectaron estadías activas duplicadas por ID, habitación y estado." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {report.duplicateActiveStays.map((row) => (
                  <li key={row.stayIds.join(':')} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div>
                      <p className="font-semibold tabular text-petrol-900">ID FNS {row.reservationId}</p>
                      <p className="text-xs text-slate-600">
                        {row.roomNumber ? `Hab. ${row.roomNumber}` : 'Sin habitación'} · {row.status.replaceAll('_', ' ')} · {row.stayIds.length} registros activos
                      </p>
                    </div>
                    <Badge tone="atencion">No se repara sin revisión humana</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Errores de ejecución capturados" count={report.runtimeErrors.length} />
            {report.runtimeErrors.length === 0 ? (
              <EmptyState message="No hay errores de ejecución registrados." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {report.runtimeErrors.map((error) => (
                  <li key={error.id} className="px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <CircleAlert className="h-4 w-4 text-red-600" aria-hidden="true" />
                      <p className="font-medium text-petrol-900">{error.summary}</p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateTime(error.createdAt)}{error.userName ? ` · ${error.userName}` : ''}
                    </p>
                    {error.after ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs font-medium text-petrol-700">Ver contexto técnico</summary>
                        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-[0.68rem] text-slate-100">
                          {JSON.stringify(error.after, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-start gap-3 px-4 py-4 text-sm">
              <DatabaseZap className="mt-0.5 h-5 w-5 shrink-0 text-petrol-600" aria-hidden="true" />
              <div>
                <p className="font-semibold text-petrol-900">Qué sí y qué no hace “depurar”</p>
                <p className="mt-1 text-slate-600">
                  Puede reparar inconsistencias de datos con una regla inequívoca y dejar auditoría. Un error de código se captura con contexto para corregirlo en una versión nueva; Production no se reescribe a sí mismo ni genera parches automáticos sin revisión.
                </p>
                <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Cada reparación deja trazabilidad.
                </p>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
