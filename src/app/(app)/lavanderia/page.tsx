import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { requirePagePermission } from '@/server/auth/guard';
import { listInventory } from '@/server/services/inventory';
import { listLaundryShipments } from '@/server/services/laundry';
import { Card, CardHeader, EmptyState } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import {
  LaundryCloseForm,
  LaundryDeliveryForm,
  LaundryPrepareForm,
  LaundryReceiveForm,
} from '@/components/inventory/inventory-forms';

export const metadata = { title: 'Lavandería' };
export const dynamic = 'force-dynamic';

const STATUS:Record<string,string>={
  PREPARADO:'Preparado',ENTREGADO:'Entregado',PARCIAL:'Recepción parcial',
  RECIBIDO_DIFERENCIAS:'Recibido con diferencias',RECIBIDO:'Recibido',CERRADO:'Cerrado',
};

export default async function LaundryPage(){
  const user=await requirePagePermission('laundry.manage');
  const [inventory,shipments]=await Promise.all([listInventory(user),listLaundryShipments(user)]);
  const items=inventory.items.filter(item=>item.behavior==='LAVABLE').map(item=>({
    id:item.id,code:item.code,name:item.name,unit:item.unit,behavior:item.behavior,total:item.total,
    balances:item.balances.map(row=>({locationId:row.locationId,quantity:row.quantity})),
  }));
  const locations=inventory.locations.map(location=>({id:location.id,name:location.name,kind:location.kind}));

  return <div className="mx-auto max-w-6xl space-y-4">
    <header><h1 className="text-xl font-semibold text-petrol-900">Lavandería</h1>
      <p className="mt-1 text-sm text-slate-600">Preparar → entregar físicamente → recibir parcial o totalmente → conciliar. Las diferencias continúan sin bloquear nuevos folios.</p>
    </header>

    <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="font-semibold text-petrol-900">Qué necesita atención</p>
      <p className="mt-1 text-slate-600">Los folios abiertos muestran piezas pendientes y en reproceso. La ropa en lavandería sigue siendo propiedad del hotel y permanece en el inventario.</p>
    </section>

    <Card><CardHeader title="Preparar envío"/>
      <div className="p-4">
        {items.length&&locations.some(location=>location.kind==='LAVANDERIA')
          ? <LaundryPrepareForm requestKey={randomUUID()} items={items} locations={locations}/>
          : <EmptyState message="Falta configuración para preparar lavandería." hint="Necesitas al menos un artículo lavable, una ubicación de origen y una ubicación tipo Lavandería. Configúralos en Inventario."/>}
      </div>
    </Card>

    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-petrol-900">Folios recientes</h2><Link href="/inventario" className="text-sm font-medium text-petrol-700 underline">Ver inventario</Link></div>
      {!shipments.length?<EmptyState message="Todavía no hay folios de lavandería."/>:
        shipments.map(shipment=>{
          const pending=shipment.lines.reduce((sum,line)=>sum+Math.max(0,line.sentQuantity-line.receivedQuantity),0);
          const reprocess=shipment.lines.reduce((sum,line)=>sum+line.reprocessQuantity,0);
          const canReceive=['ENTREGADO','PARCIAL','RECIBIDO_DIFERENCIAS'].includes(shipment.status);
          return <Card key={shipment.id}>
            <div className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-semibold text-petrol-900">Folio {String(shipment.folio).padStart(4,'0')} · {shipment.originLocation.name} → {shipment.laundryLocation.name}</p>
                  <p className="mt-1 text-xs text-slate-500">Preparó {shipment.preparedBy.name} · {formatDateTime(shipment.preparedAt)}</p>
                </div>
                <Badge tone={shipment.status==='CERRADO'||shipment.status==='RECIBIDO'?'resuelto':shipment.status==='RECIBIDO_DIFERENCIAS'?'atencion':'pendiente'}>{STATUS[shipment.status]??shipment.status}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Pendientes</p><p className="mt-1 text-lg font-semibold">{pending}</p></div>
                <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Reproceso</p><p className="mt-1 text-lg font-semibold">{reprocess}</p></div>
                <div className="rounded-lg bg-slate-50 p-2"><p className="text-slate-500">Líneas</p><p className="mt-1 text-lg font-semibold">{shipment.lines.length}</p></div>
              </div>
              <ul className="mt-3 divide-y divide-slate-100 text-sm">
                {shipment.lines.map(line=><li key={line.id} className="py-2">
                  <p className="font-medium">{line.item.code} · {line.item.name}</p>
                  <p className="text-xs text-slate-600">Enviadas {line.sentQuantity} · recibidas {line.receivedQuantity} · conformes {line.conformingQuantity} · reproceso {line.reprocessQuantity} · pendientes {Math.max(0,line.sentQuantity-line.receivedQuantity)}</p>
                  {(line.weightSentKg!=null||line.weightReceivedKg!=null)?<p className="text-xs text-slate-500">Peso informativo: salida {line.weightSentKg!=null?Number(line.weightSentKg):'—'} kg · recepción acumulada {line.weightReceivedKg!=null?Number(line.weightReceivedKg):'—'} kg. No convierte piezas.</p>:null}
                </li>)}
              </ul>
              {shipment.differenceEntry?<p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Diferencias vinculadas al asunto #{shipment.differenceEntry.humanId}. <Link className="font-semibold underline" href={`/libro/${shipment.differenceEntry.id}`}>Abrir seguimiento</Link></p>:null}
              <div className="mt-4 space-y-3">
                {shipment.status==='PREPARADO'?<details open><summary className="cursor-pointer font-semibold text-petrol-900">Siguiente acción · Entregar físicamente</summary><div className="mt-3"><LaundryDeliveryForm id={shipment.id}/></div></details>:null}
                {canReceive?<details open={shipment.status!=='ENTREGADO'}><summary className="cursor-pointer font-semibold text-petrol-900">Siguiente acción · Registrar recepción</summary><div className="mt-3"><LaundryReceiveForm id={shipment.id} requestKey={randomUUID()} lines={shipment.lines.map(line=>({itemId:line.itemId,itemName:line.item.name,unit:line.item.unit,sentQuantity:line.sentQuantity,receivedQuantity:line.receivedQuantity,conformingQuantity:line.conformingQuantity,reprocessQuantity:line.reprocessQuantity}))}/></div></details>:null}
                {shipment.status==='RECIBIDO'?<div className="flex justify-end"><LaundryCloseForm id={shipment.id}/></div>:null}
              </div>
            </div>
          </Card>;
        })}
    </section>
  </div>;
}
