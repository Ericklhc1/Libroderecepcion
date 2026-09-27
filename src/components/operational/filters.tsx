import Link from 'next/link';
import { ChevronDown, Filter, X } from 'lucide-react';
import { EntryStatus, EntryType, Priority, TaskStatus } from '@prisma/client';
import {
  ENTRY_STATUS_LABEL,
  ENTRY_TYPE_LABEL,
  PRIORITY_LABEL,
  TASK_STATUS_LABEL,
} from '@/domain/labels';
import type { Option } from '@/server/services/options';

export type FilterField =
  | 'q'
  | 'tipo'
  | 'estado'
  | 'estadoTarea'
  | 'prioridad'
  | 'area'
  | 'responsable'
  | 'usuario'
  | 'turno'
  | 'habitacion'
  | 'reserva'
  | 'desde'
  | 'hasta'
  | 'clase';

const PRIMARY_FIELDS = new Set<FilterField>(['q', 'estado', 'estadoTarea', 'responsable']);

/**
 * Búsqueda primero, filtros después.
 *
 * Estado y responsable quedan a mano porque son los filtros de mayor utilidad
 * diaria. El resto sigue disponible, compartible por URL y validado en servidor,
 * pero agrupado bajo «Más filtros» para no convertir cada lista en un formulario.
 */
export function Filters({
  action,
  fields,
  values,
  options,
  extraHidden,
}: {
  action: string;
  fields: FilterField[];
  values: Record<string, string | undefined>;
  options: { departments: Option[]; users: Option[]; shifts?: Option[] };
  extraHidden?: Record<string, string>;
}) {
  const has = (field: FilterField) => fields.includes(field);
  const activeCount = fields.filter((field) => values[field]).length;
  const secondary = fields.filter((field) => !PRIMARY_FIELDS.has(field));

  const control = (field: FilterField) => {
    if (field === 'q') {
      return (
        <div key={field} className="min-w-[220px] flex-1">
          <label htmlFor="q" className="label-base">Buscar</label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={values.q ?? ''}
            placeholder="#ID, título, descripción, categoría o responsable"
            className="input-base"
          />
        </div>
      );
    }

    if (field === 'clase') {
      return (
        <div key={field}>
          <label htmlFor="clase" className="label-base">Qué mostrar</label>
          <select id="clase" name="clase" defaultValue={values.clase ?? ''} className="input-base">
            <option value="">Todo</option>
            <option value="entry">Registros</option>
            <option value="task">Tareas</option>
            <option value="followup">Seguimientos</option>
            <option value="alert">Alertas</option>
          </select>
        </div>
      );
    }

    if (field === 'tipo') {
      return (
        <div key={field}>
          <label htmlFor="tipo" className="label-base">Tipo</label>
          <select id="tipo" name="tipo" defaultValue={values.tipo ?? ''} className="input-base">
            <option value="">Todos</option>
            {Object.values(EntryType).map((type) => (
              <option key={type} value={type}>{ENTRY_TYPE_LABEL[type]}</option>
            ))}
          </select>
        </div>
      );
    }

    if (field === 'estado') {
      return (
        <div key={field}>
          <label htmlFor="estado" className="label-base">Estado</label>
          <select id="estado" name="estado" defaultValue={values.estado ?? ''} className="input-base">
            <option value="">Todos</option>
            <option value="abiertos">Sólo abiertos</option>
            {Object.values(EntryStatus).map((status) => (
              <option key={status} value={status}>{ENTRY_STATUS_LABEL[status]}</option>
            ))}
          </select>
        </div>
      );
    }

    if (field === 'estadoTarea') {
      return (
        <div key={field}>
          <label htmlFor="estado" className="label-base">Estado</label>
          <select id="estado" name="estado" defaultValue={values.estado ?? ''} className="input-base">
            <option value="">Todos</option>
            <option value="abiertos">Sólo abiertas</option>
            {Object.values(TaskStatus).map((status) => (
              <option key={status} value={status}>{TASK_STATUS_LABEL[status]}</option>
            ))}
          </select>
        </div>
      );
    }

    if (field === 'prioridad') {
      return (
        <div key={field}>
          <label htmlFor="prioridad" className="label-base">Prioridad</label>
          <select id="prioridad" name="prioridad" defaultValue={values.prioridad ?? ''} className="input-base">
            <option value="">Todas</option>
            {Object.values(Priority).map((priority) => (
              <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>
            ))}
          </select>
        </div>
      );
    }

    if (field === 'area') {
      return (
        <div key={field}>
          <label htmlFor="area" className="label-base">Área</label>
          <select id="area" name="area" defaultValue={values.area ?? ''} className="input-base">
            <option value="">Todas</option>
            {options.departments.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      );
    }

    if (field === 'responsable' || field === 'usuario') {
      const name = field === 'responsable' ? 'responsable' : 'usuario';
      return (
        <div key={field}>
          <label htmlFor={name} className="label-base">
            {field === 'responsable' ? 'Responsable' : 'Usuario'}
          </label>
          <select id={name} name={name} defaultValue={values[name] ?? ''} className="input-base">
            <option value="">Cualquiera</option>
            {options.users.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      );
    }

    if (field === 'turno' && options.shifts) {
      return (
        <div key={field}>
          <label htmlFor="turno" className="label-base">Turno</label>
          <select id="turno" name="turno" defaultValue={values.turno ?? ''} className="input-base">
            <option value="">Todos</option>
            {options.shifts.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      );
    }

    if (field === 'habitacion' || field === 'reserva') {
      return (
        <div key={field} className={field === 'habitacion' ? 'w-28' : 'w-36'}>
          <label htmlFor={field} className="label-base">
            {field === 'habitacion' ? 'Habitación' : 'Reserva'}
          </label>
          <input
            id={field}
            name={field}
            defaultValue={values[field] ?? ''}
            className="input-base"
            placeholder={field === 'habitacion' ? '617' : 'RES-10241'}
          />
        </div>
      );
    }

    if (field === 'desde' || field === 'hasta') {
      return (
        <div key={field}>
          <label htmlFor={field} className="label-base">
            {field === 'desde' ? 'Desde' : 'Hasta'}
          </label>
          <input
            id={field}
            name={field}
            type="date"
            defaultValue={values[field] ?? ''}
            className="input-base"
          />
        </div>
      );
    }

    return null;
  };

  return (
    <form action={action} className="card px-4 py-3">
      {extraHidden
        ? Object.entries(extraHidden).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))
        : null}

      <div className="flex flex-wrap items-end gap-3">
        {fields.filter((field) => PRIMARY_FIELDS.has(field)).map(control)}

        <div className="flex items-center gap-2 pb-0.5">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-petrol-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-petrol-800"
          >
            <Filter className="h-4 w-4" aria-hidden="true" />
            Buscar
          </button>
          {activeCount > 0 ? (
            <Link
              href={action}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Limpiar ({activeCount})
            </Link>
          ) : null}
        </div>
      </div>

      {secondary.length > 0 ? (
        <details className="mt-3 border-t border-slate-100 pt-2" open={secondary.some((field) => Boolean(values[field]))}>
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-petrol-700">
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
            Más filtros
          </summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {secondary.map(control)}
          </div>
        </details>
      ) : null}
    </form>
  );
}
