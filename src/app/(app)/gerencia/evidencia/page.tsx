import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePagePermission } from '@/server/auth/guard';
import { formatDateTime } from '@/lib/format';
import { normalizeMetricDays } from '@/domain/operational-metrics';
import { getManagementEvidence, getManagementKeyEvidence, managementEvidenceHref } from '@/server/services/management-evidence';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Evidencia de Gerencia' };
export const dynamic = 'force-dynamic';

export default async function ManagementEvidencePage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const user = await requirePagePermission('management.dashboard.view');
  const params = await searchParams;
  const text = (key: string) => typeof params[key] === 'string' ? params[key] as string : undefined;
  const days = normalizeMetricDays(Number(text('dias')));
  const kind = text('tipo') ?? '';
  const back = <Link href={`/gerencia?dias=${days}`} className="text-sm font-semibold underline">Volver a Gerencia · {days} días</Link>;
  if (kind === 'keys-risk') {
    const floor = text('piso') ? Number(text('piso')) : undefined;
    const snapshots = (await getManagementKeyEvidence(user, { floor, countId: text('conteo') })).filter(row => row !== null);
    return <div className="mx-auto max-w-5xl space-y-4">
      {back}
      <h1 className="text-xl font-semibold">Evidencia de llaves · {floor ? `Piso ${floor}` : 'Todos los pisos'}</h1>
      <p className="text-sm text-slate-600">Sólo lectura del inventario registrado. Se conserva el conteo enlazado; al abrir todos los pisos se muestra el último de cada uno. No acredita cambios posteriores ni modifica la custodia.</p>
      {snapshots.length === 0 ? <p>No hay un conteo para este filtro.</p> : snapshots.map(snapshot => <section key={snapshot.id} className="rounded-lg border bg-white p-4">
        <h2 className="font-semibold">Piso {snapshot.floor} · Conteo #{snapshot.humanId}</h2>
        <p className="mb-3 text-xs text-slate-600">{formatDateTime(snapshot.countedAt)}</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <caption className="sr-only">Detalle del inventario por habitación</caption>
          <thead><tr><th className="p-2">Habitación</th><th className="p-2">Esperadas</th><th className="p-2">Encontradas</th><th className="p-2">Faltantes</th><th className="p-2">Fuera de servicio</th></tr></thead>
          <tbody>{snapshot.items.map(item => <tr key={item.id} className="border-t"><th scope="row" className="p-2">{item.roomNumberSnapshot ?? item.room.number}</th><td className="p-2">{item.expected}</td><td className="p-2">{item.found}</td><td className="p-2">{Math.max(item.expected - item.found, 0)}</td><td className="p-2">{item.outOfService}</td></tr>)}</tbody>
        </table></div>
      </section>)}
    </div>;
  }
  const evidence = await getManagementEvidence(user, { kind, days, page: Number(text('pagina') ?? 1) });
  if (!evidence) notFound();
  const href = managementEvidenceHref(evidence.kind, days);
  return <div className="mx-auto max-w-5xl space-y-4">
    {back}
    <h1 className="text-xl font-semibold">{evidence.title}</h1>
    <p className="text-sm text-slate-600">{evidence.currentState ? 'Pendientes actuales, sin corte de creación.' : `Del ${formatDateTime(evidence.period.current.from)} al ${formatDateTime(evidence.period.current.to)}.`} Total completo: {evidence.total}. Página {evidence.page}, {evidence.rows.length} registros.</p>
    <ul className="divide-y rounded-lg border bg-white">{evidence.rows.map(row => <li id={row.id} key={row.id} className="space-y-1 p-4">
      <h2 className="font-semibold">{row.label}</h2><p className="text-sm text-slate-600">{row.detail}</p>
      {row.at ? <p className="text-xs text-slate-500">{formatDateTime(row.at)}</p> : null}
      {row.href ? <Link href={row.href} className="inline-block text-sm underline">Abrir registro</Link> : <p className="text-xs text-slate-500">Evidencia de sólo lectura; la gestión requiere permiso del módulo.</p>}
    </li>)}</ul>
    {evidence.rows.length === 0 ? <p>No hay registros en esta página.</p> : null}
    <nav aria-label="Páginas de evidencia" className="flex gap-5">
      {evidence.page > 1 ? <Link href={`${href}&pagina=${evidence.page - 1}`} className="underline">Anterior</Link> : null}
      {evidence.hasMore ? <Link href={`${href}&pagina=${evidence.page + 1}`} className="underline">Siguiente</Link> : null}
    </nav>
  </div>;
}
