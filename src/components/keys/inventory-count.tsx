'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Dialog } from '@/components/ui/dialog';
import { ActionForm } from '@/components/ui/form';
import { Button, SubmitButton } from '@/components/ui/button';
import { savePhysicalKeyCountAction, startKeyInventoryMetricAction } from '@/server/actions/key-inventory';

type Room = { roomId: string; roomNumber: string; floor: number; expected?: number; custody?: string[]; keys: { code: string; status: string; notes: string | null }[] };
type Count = { reviewed: boolean; found: number; outOfService: number; elsewhere: number; notes: string };
const empty = (): Count => ({ reviewed: false, found: 1, outOfService: 0, elsewhere: 0, notes: '' });
const NO_AREAS: Room[] = [];
export function CompleteKeyInventory({ rooms: hotelRooms, areas = NO_AREAS, draftOwner, initialFloor = 'todos' }: { rooms: Room[]; areas?: Room[]; draftOwner: string; initialFloor?: string }) {
  const rooms = useMemo(() => [...hotelRooms,...areas], [hotelRooms,areas]);
  const initial = (r: Room): Count => ({...empty(),found:r.expected ?? 1});
  const [started, setStarted] = useState(false);
  const [floor, setFloor] = useState(initialFloor);
  const [counts, setCounts] = useState<Record<string, Count>>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [requestKey, setRequestKey] = useState('');
  const [ready, setReady] = useState(false);
  const storageKey = `aroh:key-count:v1:${draftOwner}`;
  const [startedAt, setStartedAt] = useState(() => Date.now());
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const draft = JSON.parse(saved);
        const valid = draft.counts && rooms.every(r => { const c = draft.counts[r.roomId]; return !c || (typeof c.reviewed === 'boolean' && [c.found,c.outOfService,c.elsewhere].every(n => Number.isInteger(n) && n >= 0 && n <= 100) && typeof c.notes === 'string' && c.notes.length <= 180); });
        if (valid && typeof draft.requestKey === 'string' && Number.isFinite(draft.startedAt)) { setCounts(draft.counts); setRequestKey(draft.requestKey); setStartedAt(draft.startedAt); setStarted(true); }
      }
    } catch { /* Storage is optional; a physical count still works without it. */ }
    setReady(true);
  }, [rooms, storageKey]);
  useEffect(() => {
    if (!ready) return;
    try {
      if (started && !savedId) sessionStorage.setItem(storageKey, JSON.stringify({ counts, requestKey, startedAt }));
      else sessionStorage.removeItem(storageKey);
    } catch { /* No operational write depends on browser storage. */ }
  }, [counts, requestKey, ready, savedId, started, startedAt, storageKey]);
  const patch = (id: string, change: Partial<Count>) => setCounts(old => ({ ...old, [id]: { ...(old[id] ?? initial(rooms.find(r => r.roomId === id)!)), ...change } }));
  const reviewed = rooms.filter(r => counts[r.roomId]?.reviewed).length;
  const differences = rooms.filter(r => { const c = counts[r.roomId]; return c?.reviewed && (c.found + c.elsewhere !== (r.expected ?? 1) || c.outOfService > 0); }).length;
  if (savedId) return <div className="space-y-3 p-4"><p className="font-semibold text-green-800">Inventario completo guardado.</p><Link className="inline-flex rounded bg-petrol-800 px-4 py-2 text-white" href={`/llaves/inventarios/${savedId}`}>Ver e imprimir inventario</Link><Button variant="secondary" onClick={() => { setSavedId(null); setCounts({}); setStarted(false); }}>Nueva toma</Button><p className="text-sm text-slate-600">El documento conserva el conteo de los tres pisos y sus observaciones.</p></div>;
  if (!started) return <div className="p-4"><p className="mb-3 text-sm text-slate-600">Una toma para los tres pisos. Registra las excepciones y confirma las habitaciones revisadas por piso; cambiar de piso conserva el conteo.</p><Button disabled={!ready} onClick={() => { const key = crypto.randomUUID(); const now = Date.now(); setRequestKey(key); setStartedAt(now); setStarted(true); void startKeyInventoryMetricAction({ floor: 'todos', correlationId: `key-inventory:all:${key}`, startedAtMs: now }).catch(() => undefined); }}>Iniciar inventario completo</Button></div>;
  return <ActionForm action={savePhysicalKeyCountAction} resetOnSuccess={false} onSuccess={state => setSavedId(state.id ?? null)}>
    <input type="hidden" name="floor" value="todos" /><input type="hidden" name="requestKey" value={requestKey} /><input type="hidden" name="metricCorrelationId" value={`key-inventory:all:${requestKey}`} /><input type="hidden" name="metricStartedAt" value={startedAt} />
    <div className="sticky top-16 z-10 flex flex-wrap items-center justify-between gap-2 border-b bg-white p-3 shadow-sm"><nav className="flex gap-1" aria-label="Pisos del inventario">{['todos', '4', '5', '6', '0'].map(f => <Button key={f} type="button" size="sm" variant={floor === f ? 'primary' : 'secondary'} onClick={() => setFloor(f)} aria-pressed={floor === f}>{f === 'todos' ? 'Todos' : f === '0' ? 'Áreas' : `Piso ${f}`}</Button>)}</nav><Dialog open={bulkOpen} onOpenChange={setBulkOpen} title="Confirmar revisión física" description="Confirma sólo después de revisar físicamente las llaves. Registra antes cualquier excepción en Detalle. Este paso marca las habitaciones visibles sin diferencias." trigger="Confirmar visibles" triggerVariant="secondary" triggerSize="sm"><Button type="button" onClick={() => { setCounts(old => { const next = { ...old }; for (const r of rooms) { const c = next[r.roomId] ?? initial(r); if ((floor === 'todos' || r.floor === Number(floor)) && !c.reviewed && c.found === (r.expected ?? 1) && !(r.custody?.length) && c.elsewhere === 0 && c.outOfService === 0) next[r.roomId] = { ...c, reviewed: true }; } return next; }); setBulkOpen(false); }}>Sí, verifiqué físicamente estas llaves</Button></Dialog><p className="text-sm" aria-live="polite">{reviewed}/{rooms.length} revisadas · {differences} diferencias</p><Button type="button" size="sm" variant="ghost" onClick={() => { setCounts({}); setStarted(false); }}>Descartar borrador</Button><SubmitButton disabled={reviewed !== rooms.length} size="sm" pendingLabel="Guardando…">Finalizar inventario</SubmitButton></div>
    <div className="grid grid-cols-3 gap-2 px-3 sm:grid-cols-5 lg:grid-cols-8">{rooms.map(room => {
      const count = counts[room.roomId] ?? initial(room); const different = count.found + count.elsewhere !== (room.expected ?? 1) || count.outOfService > 0;
      return <div key={room.roomId} hidden={floor !== 'todos' && room.floor !== Number(floor)} className={`rounded-lg border p-2 ${!count.reviewed ? 'border-slate-300 bg-white' : different ? 'border-amber-400 bg-amber-50' : 'border-green-400 bg-green-50'}`}>
        <input type="hidden" name={room.floor === 0 ? "areaId" : "roomId"} value={room.roomId} /><input type="hidden" name={`found:${room.roomId}`} value={count.reviewed ? count.found : ''} /><input type="hidden" name={`outOfService:${room.roomId}`} value={count.outOfService} /><input type="hidden" name={`elsewhere:${room.roomId}`} value={count.elsewhere} /><input type="hidden" name={`notes:${room.roomId}`} value={count.notes} />
        <button type="button" className="min-h-12 w-full text-center" aria-pressed={count.reviewed} aria-label={`Confirmar llave física habitación ${room.roomNumber}`} onClick={() => { if (room.custody?.length && !counts[room.roomId]) setDetail(room.roomId); else patch(room.roomId, { reviewed: !count.reviewed }); }}><strong className="block text-base">{room.roomNumber}</strong><span className="text-xs">{count.reviewed ? different ? 'Revisada · diferencia' : 'Confirmada' : 'Sin revisar'}</span></button>
        {!!room.custody?.length && <p className="break-words text-xs text-amber-800">Personal · {room.custody.length} llave(s). Revisa Detalle.</p>}
        <button type="button" className="min-h-8 w-full text-xs text-petrol-800 underline" onClick={() => setDetail(detail === room.roomId ? null : room.roomId)} aria-expanded={detail === room.roomId}>Detalle</button>
        {detail === room.roomId && <div className="space-y-2 border-t pt-2"><p className="break-words text-xs">{room.custody?.join("; ")}</p>{!!room.custody?.length && <Button type="button" size="sm" onClick={() => patch(room.roomId,{found:Math.max(0,(room.expected ?? 1)-room.custody!.length),elsewhere:room.custody!.length,notes:room.custody!.join("; ").slice(0,180)})}>Registrar custodia informada</Button>}<p className="break-words text-xs">{room.keys.map(k => `${k.code}: ${k.status.toLowerCase()}${k.notes ? ` (${k.notes})` : ''}`).join('; ') || 'Sin llaves registradas'}</p>{([['found','Físicas útiles'],['elsewhere','Custodia conocida'],['outOfService','Fuera de servicio']] as const).map(([key,label]) => <label className="block text-xs" key={key}>{label}<input aria-label={`${label} habitación ${room.roomNumber}`} className="input-base w-full" type="number" min={0} max={100} value={count[key]} onChange={e => patch(room.roomId,{ [key]: Number(e.target.value) })} /></label>)}<label className="block text-xs">Observación / custodia<textarea aria-label={`Observación habitación ${room.roomNumber}`} className="input-base w-full" maxLength={180} value={count.notes} onChange={e => patch(room.roomId,{notes:e.target.value})} /></label><Button type="button" size="sm" onClick={() => { patch(room.roomId,{reviewed:true}); setDetail(null); }}>Confirmar detalle</Button></div>}
      </div>;
    })}</div><label className="block px-3 text-sm">Observación general<input className="input-base mt-1 w-full" name="notes" maxLength={300} /></label><p className="px-3 pb-3 text-xs text-slate-600">Custodia conocida exige una observación. Una llave entregada no se declara extraviada por estar fuera del mesón. Ningún estado de llave se modifica al guardar este conteo.</p>
  </ActionForm>;
}
