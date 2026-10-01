import Link from 'next/link';
import { CompleteKeyInventory } from '@/components/keys/inventory-count';
import { KeyStatus, KeyType } from '@prisma/client';
import { KeyRound, Plus, RotateCcw } from 'lucide-react';
import { requirePageAnyPermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import {
  getPhysicalKeyInventory,
  isInventoryFloor,
  KEY_INVENTORY_MINIMUM_BY_FLOOR,
  KEY_INVENTORY_MINIMUM_TOTAL,
  listRecentPhysicalKeyCounts,
} from '@/server/services/key-inventory';
import {
  assignPhysicalKeyAction,
  createPhysicalKeyAction,
  markPhysicalKeyIncidentAction,
  recoverPhysicalKeyAction,
  retirePhysicalKeyAction,
  returnPhysicalKeyAction,
} from '@/server/actions/key-inventory';
import { Card, CardHeader, CardScroll, EmptyState, StatTile } from '@/components/ui/card';
import { ListFilterBar } from '@/components/ui/list-controls';
import { Badge, Chip } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { ActionForm, Field, Input, Select } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';

import type { Tone } from '@/domain/labels';

export const metadata = { title: 'Llaves' };
export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

const STATUS_LABEL: Record<KeyStatus, string> = {
  DISPONIBLE: 'Disponible',
  ASIGNADA: 'Entregada / asignada',
  COPIA_ADICIONAL: 'Copia adicional',
  PENDIENTE_DEVOLUCION: 'Pendiente de devolución',
  EXTRAVIADA: 'Extraviada',
  FUERA_DE_SERVICIO: 'Fuera de servicio',
};

const TYPE_LABEL: Record<KeyType, string> = {
  PRINCIPAL: 'Principal',
  COPIA: 'Copia',
  MAESTRA: 'Maestra',
};

function statusTone(status: KeyStatus): Tone {
  if (status === KeyStatus.DISPONIBLE) return 'resuelto';
  if (status === KeyStatus.EXTRAVIADA) return 'critico';
  if (status === KeyStatus.FUERA_DE_SERVICIO || status === KeyStatus.PENDIENTE_DEVOLUCION) {
    return 'atencion';
  }
  return 'curso';
}

function readOne(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : '';
}

export default async function KeysPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePageAnyPermission(['key.assign', 'key.inventory', 'key.stock']);
  const params = await searchParams;
  const floorParam = readOne(params.piso) || 'todos';
  const section = readOne(params.vista) || 'inventario';
  const allFloors = section !== 'llaves' || floorParam === 'todos';
  const requestedFloor = Number(floorParam);
  const floor = isInventoryFloor(requestedFloor) ? requestedFloor : 4;
  const q = readOne(params.q).trim();
  const statusRaw = readOne(params.estado);
  const status = Object.values(KeyStatus).includes(statusRaw as KeyStatus)
    ? (statusRaw as KeyStatus)
    : null;

  const [filteredInventory, recentCounts, completeFloors] = await Promise.all([
    section !== 'llaves' ? Promise.resolve(null) : allFloors
      ? Promise.all(
          ([4, 5, 6] as const).map((value) =>
            getPhysicalKeyInventory({ floor: value, query: q, status }),
          ),
        ).then((floors) => ({
          floor: 4 as const,
          rooms: floors.flatMap((item) => item.rooms),
          summary: floors.reduce(
            (acc, item) => ({
              expected: acc.expected + item.summary.expected,
              registered: acc.registered + item.summary.registered,
              outOfService: acc.outOfService + item.summary.outOfService,
              lost: acc.lost + item.summary.lost,
            }),
            { expected: 0, registered: 0, outOfService: 0, lost: 0 },
          ),
        }))
      : getPhysicalKeyInventory({ floor, query: q, status }),
    listRecentPhysicalKeyCounts('todos'),
    Promise.all(([4, 5, 6] as const).map(floor => getPhysicalKeyInventory({ floor }))),
  ]);

  const inventory = filteredInventory ?? {
    floor: 4 as const,
    rooms: completeFloors.flatMap(f => f.rooms),
    summary: completeFloors.reduce((a, f) => ({ expected: a.expected + f.summary.expected, registered: a.registered + f.summary.registered, outOfService: a.outOfService + f.summary.outOfService, lost: a.lost + f.summary.lost }), { expected: 0, registered: 0, outOfService: 0, lost: 0 }),
  };

  const canAssign = hasPermission(user, 'key.assign');
  const canInventory = hasPermission(user, 'key.inventory') || hasPermission(user, 'key.stock');
  const canStock = hasPermission(user, 'key.stock');

  const latest = recentCounts[0] ?? null;
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-petrol-900">Tomar inventario de llaves</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Cuadre físico mínimo del hotel: 89 habitaciones. Piso 4: 29 habitaciones;
            pisos 5 y 6: 30 habitaciones cada uno. Se espera al menos una llave por habitación,
            sin depender de PMS, reserva, huésped ni estadía.
          </p>
        </div>

        {canStock ? (
          <Dialog
            title="Ingresar llave al inventario"
            description="Asocia la llave física a una habitación. No crea reservas ni estadías."
            triggerVariant="primary"
            triggerSize="sm"
            width="sm"
            trigger={
              <>
                <Plus className="h-4 w-4" aria-hidden="true" />
                Nueva llave
              </>
            }
          >
            <ActionForm action={createPhysicalKeyAction} closeOnSuccess refreshOnSuccess>
              <Field label="Código" name="code">
                <Input name="code" maxLength={30} placeholder="Ej: 4-401-P" required />
              </Field>
              <Field label="Habitación" name="roomId">
                <Select
                  name="roomId"
                  options={inventory.rooms.map((room) => ({
                    value: room.roomId,
                    label: room.roomNumber,
                  }))}
                  required
                />
              </Field>
              <Field label="Tipo" name="type">
                <Select
                  name="type"
                  options={Object.values(KeyType).map((value) => ({
                    value,
                    label: TYPE_LABEL[value],
                  }))}
                  required
                />
              </Field>
              <Field label="Observación" name="notes">
                <Input name="notes" maxLength={300} placeholder="Opcional" />
              </Field>
              <SubmitButton className="w-full" pendingLabel="Ingresando…">
                Ingresar llave
              </SubmitButton>
            </ActionForm>
          </Dialog>
        ) : null}
      </header>

      {section === 'llaves' && <nav className="flex flex-wrap gap-2" aria-label="Pisos">
        <Link
          href="/llaves?vista=llaves&piso=todos"
          className={
            allFloors
              ? 'rounded-lg bg-petrol-700 px-4 py-2 text-sm font-semibold text-white'
              : 'rounded-lg bg-white px-4 py-2 text-sm font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50'
          }
        >
          Todos los pisos · {KEY_INVENTORY_MINIMUM_TOTAL} hab.
        </Link>
        {([4, 5, 6] as const).map((value) => (
          <Link
            key={value}
            href={`/llaves?vista=llaves&piso=${value}`}
            className={
              !allFloors && value === floor
                ? 'rounded-lg bg-petrol-700 px-4 py-2 text-sm font-semibold text-white'
                : 'rounded-lg bg-white px-4 py-2 text-sm font-medium text-petrol-700 ring-1 ring-slate-300 hover:bg-slate-50'
            }
          >
            Piso {value} · {KEY_INVENTORY_MINIMUM_BY_FLOOR[value]} hab.
          </Link>
        ))}
      </nav>}

      {section === 'llaves' && <ListFilterBar
        searchValue={q}
        searchPlaceholder="Buscar habitación o código de llave…"
        clearHref={allFloors ? '/llaves?vista=llaves&piso=todos' : `/llaves?vista=llaves&piso=${floor}`}
      >
        <input type="hidden" name="vista" value="llaves" /><input type="hidden" name="piso" value={allFloors ? 'todos' : floor} />
        <label className="min-w-[13rem]">
          <span className="mb-1 block text-xs font-medium text-slate-500">Estado</span>
          <select name="estado" defaultValue={status ?? ''} className="input-base w-full">
            <option value="">Todos</option>
            {Object.values(KeyStatus).map((value) => (
              <option key={value} value={value}>
                {STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </ListFilterBar>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatTile label="Mínimo hotel" value={KEY_INVENTORY_MINIMUM_TOTAL} hint="89 habitaciones" />
        <StatTile
          label={allFloors ? 'Mínimo selección' : `Mínimo piso ${floor}`}
          value={inventory.summary.expected}
          hint={allFloors ? 'Pisos 4, 5 y 6' : `${KEY_INVENTORY_MINIMUM_BY_FLOOR[floor]} habitaciones`}
        />
        <StatTile label="Registradas" value={inventory.summary.registered} />
        <StatTile
          label="Último inventario"
          value={latest?.totals.found ?? '—'}
          hint={latest ? formatDateTime(latest.countedAt) : 'Sin inventarios guardados'}
        />
        <StatTile
          label="Faltantes"
          value={latest?.totals.missing ?? '—'}
          tone={latest?.totals.missing ? 'alert' : 'neutral'}
        />
        <StatTile
          label="Fuera de servicio"
          value={inventory.summary.outOfService}
          tone={inventory.summary.outOfService ? 'alert' : 'neutral'}
        />
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Secciones de Llaves">{[['inventario', 'Inventario completo'], ['llaves', 'Llaves y entregas'], ['historial', 'Historial e impresión']].map(([value, label]) => <Link key={value} className={`rounded border px-3 py-2 text-sm ${section === value ? 'bg-petrol-800 text-white' : 'bg-white'}`} href={`/llaves?vista=${value}&piso=${floorParam}`}>{label}</Link>)}</nav>
      {section === 'inventario' && canInventory && <Card><CardHeader title="Inventario completo · Pisos 4, 5 y 6" /><CompleteKeyInventory draftOwner={user.id} rooms={completeFloors.flatMap(f => f.rooms)} initialFloor={floorParam} /></Card>}

      {section === 'llaves' && <Card>
        <CardHeader title={allFloors ? 'Llaves registradas · Todos los pisos' : `Llaves registradas · Piso ${floor}`} count={inventory.rooms.reduce((sum, room) => sum + room.keys.length, 0)} />
        {inventory.rooms.length === 0 ? (
          <EmptyState
            message="No hay habitaciones que coincidan con los filtros."
            hint="Limpia la búsqueda o revisa otro piso."
          />
        ) : (
          <CardScroll maxHeight="max-h-[48rem]">
            <div className="divide-y divide-slate-100">
              {inventory.rooms.map((room) => (
                <section key={room.roomId} className="px-4 py-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-petrol-900">Habitación {room.roomNumber}</h3>
                      <p className="text-xs text-slate-500">
                        {room.registered} registrada(s) · {room.expected} mínima(s)
                      </p>
                    </div>
                    {room.lost || room.outOfService ? (
                      <div className="flex gap-2">
                        {room.lost ? <Badge tone="critico">{room.lost} extraviada(s)</Badge> : null}
                        {room.outOfService ? <Badge tone="atencion">{room.outOfService} fuera de servicio</Badge> : null}
                      </div>
                    ) : null}
                  </div>

                  {room.keys.length === 0 ? (
                    <p className="text-xs text-slate-500">Sin llaves que coincidan con el filtro.</p>
                  ) : (
                    <ul className="space-y-2">
                      {room.keys.map((key) => (
                        <li
                          key={key.id}
                          className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2"
                        >
                          <KeyRound className="h-4 w-4 text-slate-400" aria-hidden="true" />
                          <span className="font-mono text-sm font-semibold text-petrol-900">{key.code}</span>
                          <span className="text-xs text-slate-500">{TYPE_LABEL[key.type]}</span>
                          <Badge tone={statusTone(key.status)}>{STATUS_LABEL[key.status]}</Badge>
                          <span className="text-xs text-slate-500">{key.location}</span>
                          {key.lastMovementAt ? (
                            <span className="text-xs text-slate-400">
                              · {formatDateTime(key.lastMovementAt)}
                            </span>
                          ) : null}

                          <div className="ml-auto flex flex-wrap gap-1 no-print">
                            {canAssign && key.status === KeyStatus.DISPONIBLE ? (
                              <Dialog
                                title={`Entregar ${key.code}`}
                                description="La entrega se registra como movimiento físico. No requiere huésped ni reserva."
                                triggerVariant="ghost"
                                triggerSize="sm"
                                trigger="Entregar"
                              >
                                <ActionForm action={assignPhysicalKeyAction} closeOnSuccess refreshOnSuccess>
                                  <input type="hidden" name="keyId" value={key.id} />
                                  <input type="hidden" name="roomId" value={room.roomId} />
                                  <Field label="Nota" name="note">
                                    <Input name="note" maxLength={300} placeholder="Opcional: a quién se entrega" />
                                  </Field>
                                  <SubmitButton className="w-full" pendingLabel="Entregando…">
                                    Confirmar entrega
                                  </SubmitButton>
                                </ActionForm>
                              </Dialog>
                            ) : null}

                            {canAssign &&
                            ([KeyStatus.ASIGNADA, KeyStatus.COPIA_ADICIONAL, KeyStatus.PENDIENTE_DEVOLUCION] as KeyStatus[]).includes(
                              key.status,
                            ) ? (
                              <Dialog
                                title={`Recibir ${key.code}`}
                                description="La llave vuelve físicamente a Recepción."
                                triggerVariant="ghost"
                                triggerSize="sm"
                                trigger="Recibir"
                              >
                                <ActionForm action={returnPhysicalKeyAction} closeOnSuccess refreshOnSuccess>
                                  <input type="hidden" name="keyId" value={key.id} />
                                  <Field label="Nota" name="note">
                                    <Input name="note" maxLength={300} placeholder="Opcional" />
                                  </Field>
                                  <SubmitButton className="w-full" pendingLabel="Recibiendo…">
                                    Confirmar devolución
                                  </SubmitButton>
                                </ActionForm>
                              </Dialog>
                            ) : null}

                            {canStock &&
                            !([KeyStatus.EXTRAVIADA, KeyStatus.FUERA_DE_SERVICIO] as KeyStatus[]).includes(key.status) ? (
                              <Dialog
                                title={`Registrar incidencia · ${key.code}`}
                                description="Marca el objeto físico sin alterar reservas ni estadías."
                                triggerVariant="ghost"
                                triggerSize="sm"
                                trigger="Incidencia"
                              >
                                <ActionForm action={markPhysicalKeyIncidentAction} closeOnSuccess refreshOnSuccess>
                                  <input type="hidden" name="keyId" value={key.id} />
                                  <Field label="Estado" name="status">
                                    <Select
                                      name="status"
                                      options={[
                                        { value: 'EXTRAVIADA', label: 'Extraviada' },
                                        { value: 'FUERA_DE_SERVICIO', label: 'Fuera de servicio' },
                                      ]}
                                      required
                                    />
                                  </Field>
                                  <Field label="Motivo" name="reason">
                                    <Input name="reason" maxLength={300} required />
                                  </Field>
                                  <SubmitButton className="w-full" pendingLabel="Guardando…">
                                    Guardar incidencia
                                  </SubmitButton>
                                </ActionForm>
                              </Dialog>
                            ) : null}

                            {canStock &&
                            ([KeyStatus.EXTRAVIADA, KeyStatus.FUERA_DE_SERVICIO] as KeyStatus[]).includes(key.status) ? (
                              <Dialog
                                title={`Recuperar ${key.code}`}
                                description="Reintegra la llave al inventario disponible."
                                triggerVariant="ghost"
                                triggerSize="sm"
                                trigger={
                                  <>
                                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                                    Recuperar
                                  </>
                                }
                              >
                                <ActionForm action={recoverPhysicalKeyAction} closeOnSuccess refreshOnSuccess>
                                  <input type="hidden" name="keyId" value={key.id} />
                                  <Field label="Nota" name="note">
                                    <Input name="note" maxLength={300} placeholder="Opcional" />
                                  </Field>
                                  <SubmitButton className="w-full" pendingLabel="Recuperando…">
                                    Reintegrar
                                  </SubmitButton>
                                </ActionForm>
                              </Dialog>
                            ) : null}

                            {canStock ? (
                              <Dialog
                                title={`Dar de baja ${key.code}`}
                                description="La baja queda en el historial. No elimina la llave ni sus movimientos."
                                triggerVariant="danger"
                                triggerSize="sm"
                                trigger="Baja"
                              >
                                <ActionForm action={retirePhysicalKeyAction} closeOnSuccess refreshOnSuccess>
                                  <input type="hidden" name="keyId" value={key.id} />
                                  <Field label="Motivo" name="reason">
                                    <Input name="reason" minLength={5} maxLength={300} required />
                                  </Field>
                                  <SubmitButton variant="danger" className="w-full" pendingLabel="Registrando baja…">
                                    Confirmar baja
                                  </SubmitButton>
                                </ActionForm>
                              </Dialog>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          </CardScroll>
        )}
      </Card>}

      {section === 'historial' && <Card>
        <CardHeader title="Historial de inventarios · todos los pisos" count={recentCounts.length} />
        {recentCounts.length === 0 ? (
          <EmptyState message="Todavía no hay inventarios físicos guardados para el hotel." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {recentCounts.map((count) => (
              <li key={count.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
                <Link className="font-medium text-petrol-900 underline" href={`/llaves/inventarios/${count.id}`}>#{count.humanId} · {formatDateTime(count.countedAt)} · {count.floor ? `Piso ${count.floor} (histórico)` : 'Tres pisos'} · Ver e imprimir</Link>
                <span className="text-slate-600">{count.countedBy.name}</span>
                <Chip>{count.totals.found}/{count.totals.expected} encontradas</Chip>
                {count.totals.missing ? <Badge tone="critico">{count.totals.missing} faltante(s)</Badge> : null}
                {count.totals.surplus ? <Badge tone="atencion">{count.totals.surplus} sobrante(s)</Badge> : null}
                {count.totals.outOfService ? (
                  <Badge tone="atencion">{count.totals.outOfService} fuera de servicio</Badge>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>}
    </div>
  );
}
