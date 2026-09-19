import Link from 'next/link';
import { KeyRound, Plus } from 'lucide-react';
import { KeyType } from '@prisma/client';
import { requirePagePermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { getKeyInventory, listKeyMovements } from '@/server/services/keys';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardScroll, EmptyState, StatTile } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import { Dialog } from '@/components/ui/dialog';
import { ActionForm, Field, Input, Select } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { createKeyAction } from '@/server/actions/rooms';
import { KeyRowActions } from '@/components/rooms/key-row-actions';
import { ReconcileKeysForm } from '@/components/rooms/reconcile-keys';
import { KEY_STATUS_LABELS, KEY_STATUS_TONE, KEY_TYPE_LABELS } from '@/domain/rooms';
import { KEY_ACTION_LABELS } from '@/domain/keys';
import { formatDateTime } from '@/lib/format';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Llaves' };
export const dynamic = 'force-dynamic';

const TYPE_OPTIONS = Object.values(KeyType).map((type) => ({
  value: type,
  label: KEY_TYPE_LABELS[type],
}));

export default async function KeysPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const user = await requirePagePermission('room.view');
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim().toLowerCase() : '';
  const estado = typeof params.estado === 'string' ? params.estado : undefined;

  const [inventory, movements] = await Promise.all([getKeyInventory(), listKeyMovements(100)]);
  const canStock = hasPermission(user, 'key.stock');
  const canAssign = hasPermission(user, 'key.assign');

  const visible = inventory.keys
    .filter((key) => (estado ? key.status === estado : true))
    .filter((key) => {
      if (!q) return true;
      return [
        key.code,
        key.type,
        key.status,
        key.roomNumber,
        key.guest,
        key.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });

  const visibleMovements = movements.filter((movement) => {
    if (!q) return true;
    return [
      movement.code,
      movement.action,
      movement.fromStatus,
      movement.toStatus,
      movement.roomNumber,
      movement.user,
      movement.note,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });

  const keysHref = (nextEstado?: string | null) => {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (nextEstado) query.set('estado', nextEstado);
    const suffix = query.toString();
    return suffix ? `/llaves?${suffix}` : '/llaves';
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-petrol-900">Inventario de llaves</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Cada llave es un objeto con estado e historial. El stock disponible se cuenta, no se
            escribe, así que no puede descuadrarse.
          </p>
        </div>
        {canStock ? (
          <div className="flex flex-wrap items-center gap-2 no-print">
            <ReconcileKeysForm />
            <Dialog
            title="Agregar una llave al inventario"
            description="Para reponer una copia perdida o registrar una llave nueva."
            trigger={
              <>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Agregar llave
              </>
            }
          >
            <ActionForm action={createKeyAction} closeOnSuccess resetOnSuccess>
              <Field label="Código" name="code" required hint="El que está grabado en la llave.">
                <Input name="code" required maxLength={30} placeholder="Ej: C-13" />
              </Field>
              <Field label="Tipo" name="type" required>
                <Select name="type" options={TYPE_OPTIONS} defaultValue={KeyType.COPIA} />
              </Field>
              <Field
                label="Habitación"
                name="roomNumber"
                hint="Sólo para llaves principales. Las copias viven en el stock."
              >
                <Input name="roomNumber" maxLength={12} placeholder="Ej: 412" />
              </Field>
              <Field label="Nota" name="notes">
                <Input name="notes" maxLength={300} placeholder="Opcional" />
              </Field>
              <SubmitButton className="w-full" pendingLabel="Agregando…">
                Agregar al inventario
              </SubmitButton>
            </ActionForm>
          </Dialog>
          </div>
        ) : null}
      </header>

      <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar código, habitación, huésped, nota…"
        clearHref="/llaves"
      >
        <label className="min-w-[12rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Estado</span>
          <select name="estado" defaultValue={estado ?? ''} className="input-base w-full">
            <option value="">Todos</option>
            {Object.entries(KEY_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </ListFilterBar>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <StatTile label="Copias en stock" value={inventory.stock.copiesAvailable} tone="good" />
        <StatTile label="Principales en tablero" value={inventory.stock.principalsAvailable} />
        <StatTile label="Asignadas" value={inventory.stock.assigned} />
        <StatTile label="Copias entregadas" value={inventory.stock.extraCopies} />
        <StatTile
          label="Por devolver"
          value={inventory.stock.pendingReturn}
          tone={inventory.stock.pendingReturn ? 'alert' : 'neutral'}
        />
        <StatTile
          label="Extraviadas"
          value={inventory.stock.lost}
          tone={inventory.stock.lost ? 'alert' : 'neutral'}
        />
        <StatTile label="Fuera de servicio" value={inventory.stock.outOfService} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-slate-500">Estado</span>
        <Link
          href={keysHref(null)}
          className={
            estado
              ? 'rounded-md px-2 py-1 text-petrol-700 hover:bg-slate-100'
              : 'rounded-md bg-petrol-800 px-2 py-1 font-medium text-white'
          }
        >
          Todas
        </Link>
        {Object.entries(KEY_STATUS_LABELS).map(([value, label]) => (
          <Link
            key={value}
            href={keysHref(value)}
            className={
              estado === value
                ? 'rounded-md bg-petrol-800 px-2 py-1 font-medium text-white'
                : 'rounded-md px-2 py-1 text-petrol-700 hover:bg-slate-100'
            }
          >
            {label}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader title="Llaves" count={visible.length} />
        {visible.length ? (
          <CardScroll>
            <ul className="divide-y divide-slate-100">
            {visible.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <KeyRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="font-medium tabular text-petrol-900">{key.code}</span>
                <span className="text-xs text-slate-500">{KEY_TYPE_LABELS[key.type]}</span>
                <Badge tone={KEY_STATUS_TONE[key.status]}>{KEY_STATUS_LABELS[key.status]}</Badge>
                {key.roomNumber ? (
                  <Link
                    href={`/habitaciones/${key.roomNumber}`}
                    className="tabular text-petrol-700 hover:underline"
                  >
                    Hab. {key.roomNumber}
                  </Link>
                ) : (
                  <span className="text-slate-400">Sin habitación</span>
                )}
                {key.guest ? <span className="text-slate-600">{key.guest}</span> : null}
                {key.assignedAt ? (
                  <span className="text-xs text-slate-400">
                    {formatDateTime(key.assignedAt)}
                    {key.assignedBy ? ` · ${key.assignedBy}` : ''}
                  </span>
                ) : null}
                {key.notes ? <span className="text-xs text-slate-500">{key.notes}</span> : null}
                <div className="ml-auto">
                  <KeyRowActions
                    keyId={key.id}
                    code={key.code}
                    status={key.status}
                    canAssign={canAssign}
                    canStock={canStock}
                  />
                </div>
              </li>
            ))}
            </ul>
          </CardScroll>
        ) : (
          <EmptyState message="No hay llaves con ese estado." />
        )}
      </Card>

      <Card>
        <CardHeader title="Historial de movimientos" count={visibleMovements.length} />
        {visibleMovements.length ? (
          <CardScroll>
            <ul className="divide-y divide-slate-100">
            {visibleMovements.map((movement) => (
              <li key={movement.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <time className="shrink-0 tabular text-xs text-slate-400">
                  {formatDateTime(movement.at)}
                </time>
                <span className="font-medium tabular text-petrol-900">{movement.code}</span>
                <span className="text-slate-700">{KEY_ACTION_LABELS[movement.action]}</span>
                <span className="text-xs text-slate-500">
                  {movement.fromStatus ? `${KEY_STATUS_LABELS[movement.fromStatus]} → ` : ''}
                  {KEY_STATUS_LABELS[movement.toStatus]}
                </span>
                {movement.roomNumber ? (
                  <span className="tabular text-slate-500">Hab. {movement.roomNumber}</span>
                ) : null}
                <span className="ml-auto text-xs text-slate-500">{movement.user}</span>
                {movement.note ? (
                  <span className="w-full text-xs text-slate-500">{movement.note}</span>
                ) : null}
              </li>
            ))}
            </ul>
          </CardScroll>
        ) : (
          <EmptyState message={q ? "Sin movimientos que coincidan con la búsqueda." : "Sin movimientos registrados."} />
        )}
      </Card>
    </div>
  );
}
