'use client';

import { useMemo, useState } from 'react';
import { ActionForm, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Button, SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { recordInventoryMovementAction } from '@/server/actions/inventory';
import {
  deliverLaundryShipmentAction,
  prepareLaundryShipmentAction,
  receiveLaundryShipmentAction,
  closeLaundryShipmentAction,
} from '@/server/actions/laundry';

type LocationOption = { id: string; name: string; kind: string };
type ItemOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
  behavior: string;
  total: number;
  balances: Array<{ locationId: string; quantity: number }>;
};

export function InventoryMovementDialog({
  requestKey,
  items,
  locations,
}: {
  requestKey: string;
  items: ItemOption[];
  locations: LocationOption[];
}) {
  return (
    <Dialog
      title="Registrar movimiento"
      description="Registra un hecho físico. Trasladar cambia ubicación; uso o baja sí reduce el total."
      trigger="Registrar movimiento"
      triggerVariant="primary"
      width="md"
    >
      <ActionForm action={recordInventoryMovementAction} closeOnSuccess refreshOnSuccess
        draftScope={`inventory-movement:${requestKey}`}
        draftFields={['itemId','kind','quantity','fromLocationId','toLocationId','reason','notes']}>
        <input type="hidden" name="requestKey" value={requestKey} />
        <Field label="Artículo" name="itemId" required>
          <Select name="itemId" required placeholder="Selecciona"
            options={items.map(item=>({value:item.id,label:`${item.code} · ${item.name}`}))}/>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Operación" name="kind" required>
            <Select name="kind" required defaultValue="TRASLADO" options={[
              {value:'ENTRADA',label:'Entrada al inventario'},
              {value:'TRASLADO',label:'Traslado / cambio de custodia'},
              {value:'DEVOLUCION',label:'Devolución'},
              {value:'USO',label:'Uso / consumo'},
              {value:'REPARACION',label:'Enviar a reparación'},
              {value:'REPROCESO',label:'Reproceso'},
              {value:'BAJA',label:'Baja autorizada'},
              {value:'CORRECCION',label:'Corrección trazable'},
            ]}/>
          </Field>
          <Field label="Cantidad" name="quantity" required>
            <Input name="quantity" type="number" min="0.001" step="0.001" inputMode="decimal" required />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Desde" name="fromLocationId" hint="Vacío sólo para una entrada nueva.">
            <Select name="fromLocationId" placeholder="Sin origen"
              options={locations.map(location=>({value:location.id,label:location.name}))}/>
          </Field>
          <Field label="Hacia" name="toLocationId" hint="Vacío sólo cuando el hecho saca stock del hotel.">
            <Select name="toLocationId" placeholder="Sin destino"
              options={locations.map(location=>({value:location.id,label:location.name}))}/>
          </Field>
        </div>
        <Field label="Motivo" name="reason" required>
          <Input name="reason" required minLength={3} maxLength={500} placeholder="Qué ocurrió físicamente" />
        </Field>
        <Field label="Observaciones" name="notes">
          <Textarea name="notes" rows={2} maxLength={1000}/>
        </Field>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
          Una entrega de bodega al carro es un traslado: no consume ni reduce el total del hotel.
        </p>
        <div className="flex justify-end"><SubmitButton pendingLabel="Registrando…">Registrar movimiento</SubmitButton></div>
      </ActionForm>
    </Dialog>
  );
}

type PrepareLine = { itemId: string; sentQuantity: number; weightSentKg: number | null; notes: string | null };

export function LaundryPrepareForm({
  requestKey,
  items,
  locations,
}: {
  requestKey: string;
  items: ItemOption[];
  locations: LocationOption[];
}) {
  const washable = items.filter(item => item.behavior === 'LAVABLE');
  const [lines,setLines]=useState<PrepareLine[]>([]);
  const [itemId,setItemId]=useState(washable[0]?.id ?? '');
  const [quantity,setQuantity]=useState(1);
  const [weight,setWeight]=useState('');
  const add = () => {
    if(!itemId || !Number.isInteger(quantity) || quantity <= 0) return;
    setLines(current => {
      const without=current.filter(line=>line.itemId!==itemId);
      return [...without,{itemId,sentQuantity:quantity,weightSentKg:weight?Number(weight):null,notes:null}];
    });
  };
  const label=(id:string)=>washable.find(item=>item.id===id);

  return (
    <ActionForm action={prepareLaundryShipmentAction} refreshOnSuccess resetOnSuccess
      draftScope={`laundry-prepare:${requestKey}`}
      draftFields={['originLocationId','laundryLocationId','notes']}>
      <input type="hidden" name="requestKey" value={requestKey}/>
      <input type="hidden" name="lines" value={JSON.stringify(lines)}/>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Origen" name="originLocationId" required>
          <Select name="originLocationId" required placeholder="Ubicación de salida"
            options={locations.filter(location=>location.kind!=='LAVANDERIA').map(location=>({value:location.id,label:location.name}))}/>
        </Field>
        <Field label="Lavandería" name="laundryLocationId" required>
          <Select name="laundryLocationId" required placeholder="Destino"
            options={locations.filter(location=>location.kind==='LAVANDERIA').map(location=>({value:location.id,label:location.name}))}/>
        </Field>
      </div>
      <section className="space-y-2 rounded-lg border border-slate-200 p-3">
        <h3 className="text-sm font-semibold text-petrol-900">Artículos a preparar</h3>
        <div className="grid gap-2 sm:grid-cols-[1fr_7rem_7rem_auto]">
          <Select value={itemId} onChange={event=>setItemId(event.target.value)}
            options={washable.map(item=>({value:item.id,label:`${item.code} · ${item.name}`}))}/>
          <Input aria-label="Cantidad a preparar" type="number" min={1} step={1} value={quantity}
            onChange={event=>setQuantity(Number(event.target.value))}/>
          <Input aria-label="Peso informativo" inputMode="decimal" placeholder="kg opcional" value={weight}
            onChange={event=>setWeight(event.target.value)}/>
          <Button type="button" variant="secondary" onClick={add}>Añadir</Button>
        </div>
        {!lines.length ? <p className="text-xs text-slate-500">Añade al menos un artículo. Preparar todavía no mueve stock.</p> :
          <ul className="divide-y divide-slate-100 text-sm">{lines.map(line=>{
            const item=label(line.itemId);
            return <li key={line.itemId} className="flex items-center justify-between gap-3 py-2">
              <span>{item?.name ?? line.itemId} · {line.sentQuantity} {item?.unit ?? 'pieza(s)'}{line.weightSentKg!=null?` · ${line.weightSentKg} kg informativos`:''}</span>
              <button type="button" className="text-xs font-medium text-red-700 underline" onClick={()=>setLines(current=>current.filter(row=>row.itemId!==line.itemId))}>Quitar</button>
            </li>;
          })}</ul>}
      </section>
      <Field label="Observaciones del folio" name="notes"><Textarea name="notes" rows={2} maxLength={1000}/></Field>
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
        «Preparar» congela el folio, no acredita salida física. El stock cambia recién al confirmar «Entregar a lavandería».
      </p>
      <div className="flex justify-end"><SubmitButton disabled={!lines.length} pendingLabel="Preparando…">Preparar envío</SubmitButton></div>
    </ActionForm>
  );
}

export function LaundryDeliveryForm({id}:{id:string}) {
  return <ActionForm action={deliverLaundryShipmentAction} refreshOnSuccess>
    <input type="hidden" name="id" value={id}/>
    <Field label="Observación" name="note"><Input name="note" maxLength={1000} placeholder="Opcional"/></Field>
    <div className="flex justify-end"><SubmitButton pendingLabel="Confirmando…">Confirmar entrega física</SubmitButton></div>
  </ActionForm>;
}

type ReceiveLineState = {
  itemId:string;
  receivedNow:number;
  conformingNow:number;
  reprocessNow:number;
  reprocessResolvedNow:number;
  weightReceivedKg:number|null;
  notes:string|null;
};

export function LaundryReceiveForm({
  id,
  requestKey,
  lines,
}:{
  id:string;
  requestKey:string;
  lines:Array<{
    itemId:string;
    itemName:string;
    unit:string;
    sentQuantity:number;
    receivedQuantity:number;
    conformingQuantity:number;
    reprocessQuantity:number;
  }>;
}) {
  const [values,setValues]=useState<Record<string,ReceiveLineState>>(()=>Object.fromEntries(lines.map(line=>[line.itemId,{
    itemId:line.itemId,receivedNow:0,conformingNow:0,reprocessNow:0,reprocessResolvedNow:0,weightReceivedKg:null,notes:null,
  }])));
  const payload=useMemo(()=>Object.values(values).filter(line=>
    line.receivedNow>0||line.reprocessResolvedNow>0||line.reprocessNow>0||line.conformingNow>0
  ),[values]);
  const change=(id:string,patch:Partial<ReceiveLineState>)=>setValues(current=>({...current,[id]:{...current[id]!,...patch}}));

  return <ActionForm action={receiveLaundryShipmentAction} refreshOnSuccess
    draftScope={`laundry-receive:${requestKey}`}
    draftFields={['withDifferences','note']}>
    <input type="hidden" name="id" value={id}/>
    <input type="hidden" name="requestKey" value={requestKey}/>
    <input type="hidden" name="lines" value={JSON.stringify(payload)}/>
    <div className="space-y-3">
      {lines.map(line=>{
        const v=values[line.itemId]!;
        const pending=line.sentQuantity-line.receivedQuantity;
        return <section key={line.itemId} className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium text-petrol-900">{line.itemName}</h3>
            <p className="text-xs text-slate-500">Enviadas {line.sentQuantity} · recibidas {line.receivedQuantity} · pendientes {pending} · reproceso {line.reprocessQuantity}</p>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-xs text-slate-600">Llegan ahora
              <Input type="number" min={0} max={pending} step={1} value={v.receivedNow}
                onChange={e=>change(line.itemId,{receivedNow:Number(e.target.value)})}/>
            </label>
            <label className="text-xs text-slate-600">Conformes
              <Input type="number" min={0} step={1} value={v.conformingNow}
                onChange={e=>change(line.itemId,{conformingNow:Number(e.target.value)})}/>
            </label>
            <label className="text-xs text-slate-600">A reproceso
              <Input type="number" min={0} step={1} value={v.reprocessNow}
                onChange={e=>change(line.itemId,{reprocessNow:Number(e.target.value)})}/>
            </label>
            <label className="text-xs text-slate-600">Reproceso resuelto
              <Input type="number" min={0} max={line.reprocessQuantity} step={1} value={v.reprocessResolvedNow}
                onChange={e=>change(line.itemId,{reprocessResolvedNow:Number(e.target.value)})}/>
            </label>
          </div>
          <label className="mt-2 block text-xs text-slate-600">Peso recibido (informativo)
            <Input inputMode="decimal" placeholder="kg" onChange={e=>change(line.itemId,{weightReceivedKg:e.target.value?Number(e.target.value):null})}/>
          </label>
        </section>;
      })}
    </div>
    <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm">
      <input type="checkbox" name="withDifferences" value="true" className="mt-1"/>
      <span>Recibido con diferencias. Crear o conservar un único incidente vinculado.</span>
    </label>
    <Field label="Observación general" name="note"><Textarea name="note" rows={2} maxLength={1000}/></Field>
    <p className="text-xs text-slate-500">Cada pieza recibida debe quedar conforme o en reproceso. El peso no convierte ni ajusta piezas.</p>
    <div className="flex justify-end"><SubmitButton disabled={!payload.length} pendingLabel="Registrando…">Registrar recepción</SubmitButton></div>
  </ActionForm>;
}

export function LaundryCloseForm({id}:{id:string}) {
  return <ActionForm action={closeLaundryShipmentAction} refreshOnSuccess>
    <input type="hidden" name="id" value={id}/>
    <input type="hidden" name="note" value="Conciliación de folio confirmada"/>
    <SubmitButton size="sm" variant="secondary">Cerrar folio</SubmitButton>
  </ActionForm>;
}
