import { randomUUID } from 'node:crypto';
import { InventoryBehavior, InventoryLocationKind } from '@prisma/client';
import { requirePagePermission } from '@/server/auth/guard';
import { hasPermission } from '@/server/auth/current-user';
import { inventoryDepartmentIds, listInventory } from '@/server/services/inventory';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState } from '@/components/ui/card';
import { Chip } from '@/components/ui/badge';
import { ActionForm, Field, Input, Select } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { InventoryMovementDialog } from '@/components/inventory/inventory-forms';
import {
  saveInventoryCategoryAction,
  saveInventoryItemAction,
  saveInventoryLocationAction,
} from '@/server/actions/inventory';
import type { RawSearchParams } from '@/lib/search-params';

export const metadata = { title: 'Inventario' };
export const dynamic = 'force-dynamic';

const BEHAVIOR_LABEL: Record<string,string> = {
  CONSUMIBLE:'Consumible', PRESTAMO:'Préstamo', LAVABLE:'Lavable', ACTIVO:'Activo',
};
const LOCATION_LABEL: Record<string,string> = {
  BODEGA:'Bodega', CARRO:'Carro', AREA:'Área', HABITACION:'Habitación',
  LAVANDERIA:'Lavandería', REPARACION:'Reparación', OTRO:'Otro',
};

export default async function InventoryPage({searchParams}:{searchParams:Promise<RawSearchParams>}) {
  const user=await requirePagePermission('inventory.view');
  const params=await searchParams;
  const requestedArea=typeof params.area==='string'?params.area:'';
  const query=typeof params.q==='string'?params.q.trim().toLowerCase():'';
  const scope=await inventoryDepartmentIds(user);
  const canManage=hasPermission(user,'inventory.manage');
  const canMove=hasPermission(user,'inventory.move');
  const departments=await prisma.department.findMany({
    where:{active:true,...(canManage?{}:{id:{in:scope}})},
    select:{id:true,name:true},
    orderBy:{order:'asc'},
  });
  const area=departments.some(row=>row.id===requestedArea)?requestedArea:undefined;
  const data=await listInventory(user,area);
  const items=data.items.filter(item=>!query||[
    item.code,item.name,item.category.name,item.category.department.name,...item.balances.map(row=>row.location.name),
  ].join(' ').toLowerCase().includes(query));
  const itemOptions=items.map(item=>({
    id:item.id,code:item.code,name:item.name,unit:item.unit,behavior:item.behavior,total:item.total,
    balances:item.balances.map(row=>({locationId:row.locationId,quantity:row.quantity})),
  }));
  const locations=data.locations.map(location=>({id:location.id,name:location.name,kind:location.kind}));

  return <div className="mx-auto max-w-6xl space-y-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-semibold text-petrol-900">Inventario</h1>
        <p className="mt-1 text-sm text-slate-600">Una fuente común por artículo y ubicación. Trasladar cambia custodia; consumir o dar de baja cambia el total.</p>
      </div>
      {canMove&&data.items.length>0&&data.locations.length>0
        ? <InventoryMovementDialog requestKey={randomUUID()} items={itemOptions} locations={locations}/>
        : null}
    </header>

    <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
      <p className="font-semibold text-petrol-900">Qué necesita atención</p>
      <p className="mt-1 text-slate-600">Revisa saldos por ubicación y registra sólo el hecho físico ocurrido. Las discrepancias no se convierten automáticamente en pérdidas.</p>
      <p className="mt-2 text-petrol-800"><strong>Siguiente acción:</strong> {canMove?'seleccionar artículo, operación y ubicaciones para registrar el movimiento.':'consultar disponibilidad y avisar al responsable autorizado si necesitas un movimiento.'}</p>
    </section>

    <form className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <label className="min-w-0 flex-1 text-xs font-medium text-slate-600">Buscar
        <Input name="q" defaultValue={typeof params.q==='string'?params.q:''} placeholder="Código, artículo, categoría o ubicación"/>
      </label>
      <label className="min-w-[12rem] text-xs font-medium text-slate-600">Departamento
        <Select name="area" defaultValue={area??''} placeholder="Todos"
          options={departments.map(row=>({value:row.id,label:row.name}))}/>
      </label>
      <SubmitButton>Aplicar</SubmitButton>
    </form>

    {!items.length?<EmptyState message="No hay artículos que coincidan con esta vista." hint={canManage?'Configura una categoría y un artículo para empezar sin inventar stock.':'Tu acceso no tiene artículos configurados todavía.'}/>:
      <div className="grid gap-3 md:grid-cols-2">
        {items.map(item=><Card key={item.id}>
          <div className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-semibold text-petrol-900">#{item.humanId} · {item.code} · {item.name}</p>
                <p className="mt-1 text-xs text-slate-500">{item.category.department.name} · {item.category.name} · {item.presentation??item.unit}</p>
              </div>
              <div className="text-right"><p className="text-xl font-semibold tabular text-petrol-900">{item.total.toLocaleString('es-CL')} {item.unit}</p><Chip>{BEHAVIOR_LABEL[item.behavior]??item.behavior}</Chip></div>
            </div>
            <dl className="mt-3 space-y-2 text-sm">
              {item.balances.length?item.balances.map(row=><div key={row.locationId} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2">
                <dt className="text-slate-600">{row.location.name} · {LOCATION_LABEL[row.location.kind]??row.location.kind}</dt>
                <dd className="font-semibold tabular text-petrol-900">{row.quantity.toLocaleString('es-CL')} {item.unit}</dd>
              </div>):<p className="text-sm text-slate-500">Sin existencias registradas. Un catálogo no implica stock.</p>}
            </dl>
            {item.replacementEstimate!=null?<p className="mt-3 text-xs text-slate-600">Reposición estimada: {item.replacementCurrency??''} {Number(item.replacementEstimate).toLocaleString('es-CL')} · fuente {item.replacementSource??'sin fuente documentada'}{item.replacementDate?` · ${item.replacementDate.toISOString().slice(0,10)}`:''}</p>:null}
            {item.accountingValue!=null?<p className="mt-1 text-xs text-slate-600">Valor contable aportado: {item.accountingCurrency??''} {Number(item.accountingValue).toLocaleString('es-CL')}</p>:null}
          </div>
        </Card>)}
      </div>}

    {canManage?<details className="rounded-xl border border-slate-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 font-semibold text-petrol-900">Configurar catálogo y ubicaciones</summary>
      <div className="grid gap-4 border-t border-slate-200 p-4 lg:grid-cols-3">
        <section><h2 className="font-semibold text-petrol-900">Nueva categoría</h2>
          <p className="mt-1 text-xs text-slate-500">La categoría organiza; no define cómo se mueve el artículo.</p>
          <ActionForm action={saveInventoryCategoryAction} refreshOnSuccess className="mt-3">
            <Field label="Departamento" name="departmentId" required><Select name="departmentId" required options={departments.map(row=>({value:row.id,label:row.name}))}/></Field>
            <Field label="Nombre" name="name" required><Input name="name" required maxLength={100}/></Field>
            <SubmitButton>Crear categoría</SubmitButton>
          </ActionForm>
        </section>
        <section><h2 className="font-semibold text-petrol-900">Nuevo artículo</h2>
          <ActionForm action={saveInventoryItemAction} refreshOnSuccess className="mt-3">
            <Field label="Categoría" name="categoryId" required><Select name="categoryId" required options={data.categories.map(row=>({value:row.id,label:`${row.department.name} · ${row.name}`}))}/></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Código interno" name="code" required><Input name="code" required maxLength={80}/></Field><Field label="Nombre" name="name" required><Input name="name" required maxLength={160}/></Field></div>
            <Field label="Comportamiento" name="behavior" required><Select name="behavior" required options={Object.values(InventoryBehavior).map(value=>({value,label:BEHAVIOR_LABEL[value]??value}))}/></Field>
            <div className="grid grid-cols-2 gap-2"><Field label="Unidad" name="unit"><Input name="unit" defaultValue="pieza" maxLength={60}/></Field><Field label="Presentación" name="presentation"><Input name="presentation" maxLength={100}/></Field></div>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="trackIndividually" value="true" className="mt-1"/><span>Identificar cada unidad individualmente</span></label>
            <details className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm font-medium">Valorización opcional</summary>
              <div className="mt-3 grid gap-2"><Field label="Costo registrado" name="cost"><Input name="cost" inputMode="decimal"/></Field><Field label="Moneda costo" name="costCurrency"><Input name="costCurrency" maxLength={3}/></Field><Field label="Reposición estimada" name="replacementEstimate"><Input name="replacementEstimate" inputMode="decimal"/></Field><Field label="Moneda reposición" name="replacementCurrency"><Input name="replacementCurrency" maxLength={3}/></Field><Field label="Fuente" name="replacementSource"><Input name="replacementSource" maxLength={300}/></Field><Field label="Fecha de la fuente" name="replacementDate"><Input name="replacementDate" type="date"/></Field><Field label="Valor contable validado" name="accountingValue"><Input name="accountingValue" inputMode="decimal"/></Field><Field label="Moneda contable" name="accountingCurrency"><Input name="accountingCurrency" maxLength={3}/></Field></div>
            </details>
            <SubmitButton disabled={!data.categories.length}>Crear artículo</SubmitButton>
          </ActionForm>
        </section>
        <section><h2 className="font-semibold text-petrol-900">Nueva ubicación</h2>
          <ActionForm action={saveInventoryLocationAction} refreshOnSuccess className="mt-3">
            <Field label="Nombre" name="name" required><Input name="name" required maxLength={120}/></Field>
            <Field label="Código interno" name="key"><Input name="key" maxLength={80}/></Field>
            <Field label="Tipo" name="kind" required><Select name="kind" required options={Object.values(InventoryLocationKind).map(value=>({value,label:LOCATION_LABEL[value]??value}))}/></Field>
            <Field label="Departamento" name="departmentId" hint="Vacío sólo para destinos compartidos, como lavandería externa."><Select name="departmentId" placeholder="Compartida / externa" options={departments.map(row=>({value:row.id,label:row.name}))}/></Field>
            <SubmitButton>Crear ubicación</SubmitButton>
          </ActionForm>
        </section>
      </div>
    </details>:null}
  </div>;
}
