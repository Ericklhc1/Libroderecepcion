import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requirePageUser } from '@/server/auth/guard';
import { listLostFound, lostFoundTeam } from '@/server/services/lost-found';
import { NewLostFoundForm, LostFoundAction } from '@/components/operational/lost-found-forms';
import { ContextWorklist, type ContextWorklistRow } from '@/components/operational/context-worklist';
import { formatDateTime } from '@/lib/format';
import { listRowAnchor, operationalListHref } from '@/lib/list-navigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Objetos olvidados y custodia' };
const labels: Record<string, string> = { EN_CUSTODIA: 'En custodia', ENTREGADO: 'Entregado', DISPUESTO: 'Disposición final' };

type CustodyParams = { estado?: string; q?: string; pagina?: string; objeto?: string };

export default async function CustodiaPage({ searchParams }: { searchParams: Promise<CustodyParams> }) {
  const user = await requirePageUser({ allowAreaOperation: true });
  const p = await searchParams;
  const page = Math.max(1, Math.floor(Number(p.pagina) || 1));
  const currentListHref = operationalListHref('/custodia', p);
  const filters = { estado: p.estado, q: p.q, pagina: p.pagina };
  const href = (next: number) => operationalListHref('/custodia', { ...filters, pagina: String(next) });
  const canManage = user.roleKey === 'ADMINISTRADOR_SISTEMA' || user.permissions.includes('custody.manage');
  const [items, team] = await Promise.all([
    listLostFound(user, { status: p.estado, q: p.q, page }),
    canManage ? lostFoundTeam(user) : Promise.resolve([]),
  ]);
  // A direct link selects only a record in this authorized, filtered page.
  const focusedItem = p.objeto ? items.find(item => String(item.humanId) === p.objeto) : undefined;
  const rows: ContextWorklistRow[] = items.map(item => ({
    id: listRowAnchor('custody', item.id),
    title: `Objeto #${item.humanId} · ${item.item}`,
    href: operationalListHref('/custodia', { ...filters, objeto: String(item.humanId) }),
    openLabel: `Consultar objeto #${item.humanId} · ${item.item}`,
    nativeLabel: 'Abrir enlace del objeto',
    summary: <div id={`objeto-${item.humanId}`} className="space-y-2 break-words">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-500">#{item.humanId} · Hallazgo: {formatDateTime(item.foundAt)}</p>
          <h2 className="mt-1 font-semibold text-petrol-900">{item.item}</h2>
        </div>
        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${item.status === 'EN_CUSTODIA' ? 'bg-amber-50 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{labels[item.status] ?? item.status}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
        <span><strong>Custodia:</strong> {item.custodyLocation}</span>
        <span><strong>Responsable:</strong> {item.custodian?.name ?? 'Sin responsable individual'}</span>
      </div>
      {item.finalAction && <p className="line-clamp-2 text-sm text-slate-600"><strong>Resultado registrado:</strong> {item.finalAction}</p>}
    </div>,
    children: <div className="space-y-4" data-custody-detail={item.id}>
      <p className="text-sm font-medium text-petrol-900">#{item.humanId} · {labels[item.status] ?? item.status}</p>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="font-semibold text-slate-600">Lugar del hallazgo</dt><dd className="mt-1">{item.foundLocation}</dd></div>
        <div><dt className="font-semibold text-slate-600">Fecha y hora del hallazgo</dt><dd className="mt-1">{formatDateTime(item.foundAt)}</dd></div>
        <div><dt className="font-semibold text-slate-600">Ubicación de custodia</dt><dd className="mt-1">{item.custodyLocation}</dd></div>
        <div><dt className="font-semibold text-slate-600">Responsable de custodia</dt><dd className="mt-1">{item.custodian?.name ?? 'Sin responsable individual'}</dd></div>
        <div><dt className="font-semibold text-slate-600">Registró</dt><dd className="mt-1">{item.registeredBy.name}</dd></div>
      </dl>
      {item.finalAction && <section aria-label="Resultado registrado" className="space-y-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
        <p className="whitespace-pre-wrap"><strong>Resultado:</strong> {item.finalAction}</p>
        {item.evidenceNote && <p className="whitespace-pre-wrap"><strong>Evidencia:</strong> {item.evidenceNote}</p>}
        {item.closedBy && <p><strong>Responsable del cierre:</strong> {item.closedBy.name}</p>}
        {item.closedAt && <p><strong>Fecha del cierre:</strong> {formatDateTime(item.closedAt)}</p>}
      </section>}
      {canManage ? <section aria-label="Acciones de custodia" className="space-y-2 border-t border-slate-100 pt-3">
        <h3 className="text-sm font-semibold text-petrol-900">Actualizar este registro</h3>
        <div className="flex flex-wrap gap-2">
          {item.status === 'EN_CUSTODIA' ? <>
            <LostFoundAction id={item.id} version={item.version} action="MOVER" team={team} currentLocation={item.custodyLocation} currentCustodian={item.custodianId} />
            <LostFoundAction id={item.id} version={item.version} action="ENTREGAR" team={team} currentLocation={item.custodyLocation} />
            <LostFoundAction id={item.id} version={item.version} action="DISPONER" team={team} currentLocation={item.custodyLocation} />
          </> : <LostFoundAction id={item.id} version={item.version} action="REABRIR" team={team} currentLocation={item.custodyLocation} currentCustodian={item.custodianId} />}
        </div>
      </section> : <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Consulta de custodia. Tu acceso permite revisar el registro y su historial.</p>}
      <details className="border-t border-slate-100 pt-3">
        <summary className="cursor-pointer text-sm font-medium text-petrol-900">Historial y responsables</summary>
        <ol className="mt-3 space-y-3 text-xs text-slate-600">
          {item.events.map(event => <li key={event.id}>
            <p>{formatDateTime(event.createdAt)} · <strong>{event.actorName}</strong> · {event.action}</p>
            {event.note && <p className="mt-1 whitespace-pre-wrap">{event.note}</p>}
          </li>)}
        </ol>
      </details>
    </div>,
  }));

  return <div className="mx-auto max-w-6xl space-y-4 surface-enter">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-petrol-900">Objetos olvidados y custodia</h1><p className="mt-1 text-sm text-slate-600">Hallazgo, ubicación física, responsable e historial hasta su entrega o disposición final.</p></div>
      {canManage && <NewLostFoundForm requestKey={randomUUID()} team={team} />}
    </header>
    <form action="/custodia" className="card flex flex-wrap items-end gap-3 p-3">
      <label className="text-sm">Estado<select className="input-base mt-1" name="estado" defaultValue={p.estado ?? ''}><option value="">Todos</option><option value="EN_CUSTODIA">En custodia</option><option value="ENTREGADO">Entregados</option><option value="DISPUESTO">Disposición final</option></select></label>
      <label className="min-w-0 flex-1 text-sm">Buscar<input className="input-base mt-1 w-full" name="q" defaultValue={p.q ?? ''} placeholder="Objeto, lugar o ubicación de custodia" /></label>
      <button className="btn-secondary" type="submit">Ver</button>
    </form>
    <section className="card p-4">
      <p className="text-sm"><strong>{items.filter(item => item.status === 'EN_CUSTODIA').length}</strong> en custodia · {items.length} registros visibles con estos filtros.</p>
      <p className="mt-1 text-xs text-slate-600">Este registro no administra reservas, estadías ni disponibilidad de habitaciones.</p>
    </section>
    <ContextWorklist href={currentListHref} scope={user.id} label="Objetos registrados" rows={rows} initialOpenId={focusedItem ? listRowAnchor('custody', focusedItem.id) : undefined} emptyMessage="No hay objetos con estos filtros." />
    <nav aria-label="Páginas de custodia" className="flex flex-wrap justify-between gap-3 text-sm">
      {page > 1 ? <Link className="underline" href={href(page - 1)}>Anterior</Link> : <span />}
      <span>Página {page} · hasta 50 registros por página</span>
      {items.length === 50 && <Link className="underline" href={href(page + 1)}>Siguiente</Link>}
    </nav>
  </div>;
}
