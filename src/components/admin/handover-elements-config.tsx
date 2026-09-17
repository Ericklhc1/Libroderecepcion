'use client';

import { ActionForm, Field, Input, Textarea } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { saveHandoverElementConfigurationAction } from '@/server/actions/handover-element-config';

export type HandoverElementTypeOption = {
  id: string;
  name: string;
  detail: string | null;
  required: boolean;
  active: boolean;
  order: number;
};

export function HandoverElementsConfig({
  elements,
}: {
  elements: HandoverElementTypeOption[];
}) {
  return (
    <ActionForm action={saveHandoverElementConfigurationAction} className="space-y-4">
      <div>
        <p className="text-sm font-medium text-petrol-900">Elementos que se entregan con Caja</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Define qué objetos debe declarar quien entrega y confirmar quien recibe. Desactivar un elemento sólo afecta entregas nuevas; el historial conserva lo que ya existía.
        </p>
      </div>

      {elements.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600">
          No hay elementos configurados. Puedes crear el primero abajo.
        </p>
      ) : (
        <div className="space-y-3">
          {elements.map((element) => (
            <fieldset key={element.id} className="rounded-lg border border-slate-200 p-3">
              <input type="hidden" name="elementId" value={element.id} />
              <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
                <Field label="Nombre" name={`name_${element.id}`} required>
                  <Input name={`name_${element.id}`} defaultValue={element.name} required />
                </Field>
                <Field label="Orden" name={`order_${element.id}`}>
                  <Input
                    name={`order_${element.id}`}
                    type="number"
                    min={0}
                    step={1}
                    defaultValue={element.order}
                  />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="Detalle" name={`detail_${element.id}`}>
                  <Textarea
                    name={`detail_${element.id}`}
                    rows={2}
                    defaultValue={element.detail ?? ''}
                    placeholder="Ej.: radio, teléfono, llavero, sobre, fondo documental…"
                  />
                </Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name={`active_${element.id}`}
                    defaultChecked={element.active}
                    className="h-4 w-4 rounded border-slate-300 text-petrol-700"
                  />
                  Activo
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name={`required_${element.id}`}
                    defaultChecked={element.required}
                    className="h-4 w-4 rounded border-slate-300 text-petrol-700"
                  />
                  Obligatorio para cerrar/recibir
                </label>
              </div>
            </fieldset>
          ))}
        </div>
      )}

      <fieldset className="rounded-lg border border-dashed border-slate-300 p-3">
        <legend className="px-1 text-sm font-medium text-petrol-900">Agregar elemento</legend>
        <div className="grid gap-3 sm:grid-cols-[1fr_6rem]">
          <Field label="Nombre" name="newName">
            <Input name="newName" placeholder="Ej.: Teléfono de recepción" />
          </Field>
          <Field label="Orden" name="newOrder">
            <Input name="newOrder" type="number" min={0} step={1} placeholder="0" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Detalle" name="newDetail">
            <Textarea name="newDetail" rows={2} placeholder="Descripción opcional" />
          </Field>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="newRequired"
            defaultChecked
            className="h-4 w-4 rounded border-slate-300 text-petrol-700"
          />
          Obligatorio
        </label>
      </fieldset>

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Guardando…">Guardar elementos</SubmitButton>
      </div>
    </ActionForm>
  );
}
