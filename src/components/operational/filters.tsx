import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, Filter, SlidersHorizontal, X } from 'lucide-react';
import { EntryStatus, EntryType, Priority, TaskStatus } from '@prisma/client';
import { ENTRY_STATUS_LABEL, ENTRY_TYPE_LABEL, PRIORITY_LABEL, TASK_STATUS_LABEL } from '@/domain/labels';
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

function FieldShell({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="label-base">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Búsqueda primero, filtros después.
 *
 * Los parámetros siguen siendo GET y conservan exactamente los mismos nombres:
 * agrupar un filtro en «Más filtros» no cambia contratos de URL, servicios ni
 * enlaces guardados.
 */
export function Filters({
  action,
  fields,
  secondaryFields = [],
  values,
  options,
  extraHidden,
}: {
  action: string;
  fields: FilterField[];
  secondaryFields?: FilterField[];
  values: Record<string, string | undefined>;
  options: { departments: Option[]; users: Option[]; shifts?: Option[] };
  extraHidden?: Record<string, string>;
}) {
  const secondary = new Set(secondaryFields.filter((field) => fields.includes(field)));
  const primaryFields = fields.filter((field) => !secondary.has(field));
  const secondaryActive = secondaryFields.filter((field) => Boolean(values[field])).length;
  const activeCount = fields.filter((field) => Boolean(values[field])).length;

  const renderField = (field: FilterField): ReactNode => {
    switch (field) {
      case 'q':
        return (
          <FieldShell key={field} label="Buscar" htmlFor="q" className="min-w-[220px] flex-1">
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={values.q ?? ''}
              placeholder="#ID, habitación, huésped, título o responsable"
              className="input-base w-full"
            />
          </FieldShell>
        );
      case 'clase':
        return (
          <FieldShell key={field} label="Qué mostrar" htmlFor="clase">
            <select id="clase" name="clase" defaultValue={values.clase ?? ''} className="input-base">
              <option value="">Todo</option>
              <option value="entry">Registros</option>
              <option value="task">Tareas</option>
              <option value="followup">Seguimientos</option>
              <option value="alert">Alertas</option>
            </select>
          </FieldShell>
        );
      case 'tipo':
        return (
          <FieldShell key={field} label="Tipo" htmlFor="tipo">
            <select id="tipo" name="tipo" defaultValue={values.tipo ?? ''} className="input-base">
              <option value="">Todos</option>
              {Object.values(EntryType).map((type) => (
                <option key={type} value={type}>{ENTRY_TYPE_LABEL[type]}</option>
              ))}
            </select>
          </FieldShell>
        );
      case 'estado':
        return (
          <FieldShell key={field} label="Estado" htmlFor="estado">
            <select id="estado" name="estado" defaultValue={values.estado ?? ''} className="input-base">
              <option value="">Todos</option>
              <option value="abiertos">Sólo abiertos</option>
              {Object.values(EntryStatus).map((status) => (
                <option key={status} value={status}>{ENTRY_STATUS_LABEL[status]}</option>
              ))}
            </select>
          </FieldShell>
        );
      case 'estadoTarea':
        return (
          <FieldShell key={field} label="Estado" htmlFor="estado">
            <select id="estado" name="estado" defaultValue={values.estado ?? ''} className="input-base">
              <option value="">Todos</option>
              <option value="abiertos">Sólo abiertas</option>
              {Object.values(TaskStatus).map((status) => (
                <option key={status} value={status}>{TASK_STATUS_LABEL[status]}</option>
              ))}
            </select>
          </FieldShell>
        );
      case 'prioridad':
        return (
          <FieldShell key={field} label="Prioridad" htmlFor="prioridad">
            <select id="prioridad" name="prioridad" defaultValue={values.prioridad ?? ''} className="input-base">
              <option value="">Todas</option>
              {Object.values(Priority).map((priority) => (
                <option key={priority} value={priority}>{PRIORITY_LABEL[priority]}</option>
              ))}
            </select>
          </FieldShell>
        );
      case 'area':
        return (
          <FieldShell key={field} label="Área" htmlFor="area">
            <select id="area" name="area" defaultValue={values.area ?? ''} className="input-base">
              <option value="">Todas</option>
              {options.departments.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FieldShell>
        );
      case 'responsable':
        return (
          <FieldShell key={field} label="Responsable" htmlFor="responsable">
            <select id="responsable" name="responsable" defaultValue={values.responsable ?? ''} className="input-base">
              <option value="">Cualquiera</option>
              {options.users.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FieldShell>
        );
      case 'usuario':
        return (
          <FieldShell key={field} label="Usuario" htmlFor="usuario">
            <select id="usuario" name="usuario" defaultValue={values.usuario ?? ''} className="input-base">
              <option value="">Cualquiera</option>
              {options.users.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FieldShell>
        );
      case 'turno':
        if (!options.shifts) return null;
        return (
          <FieldShell key={field} label="Turno" htmlFor="turno">
            <select id="turno" name="turno" defaultValue={values.turno ?? ''} className="input-base">
              <option value="">Todos</option>
              {options.shifts.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FieldShell>
        );
      case 'habitacion':
        return (
          <FieldShell key={field} label="Habitación" htmlFor="habitacion" className="w-32">
            <input id="habitacion" name="habitacion" defaultValue={values.habitacion ?? ''} className="input-base w-full" placeholder="617" />
          </FieldShell>
        );
      case 'reserva':
        return (
          <FieldShell key={field} label="Reserva" htmlFor="reserva" className="w-40">
            <input id="reserva" name="reserva" defaultValue={values.reserva ?? ''} className="input-base w-full" placeholder="RES-10241" />
          </FieldShell>
        );
      case 'desde':
        return (
          <FieldShell key={field} label="Desde" htmlFor="desde">
            <input id="desde" name="desde" type="date" defaultValue={values.desde ?? ''} className="input-base" />
          </FieldShell>
        );
      case 'hasta':
        return (
          <FieldShell key={field} label="Hasta" htmlFor="hasta">
            <input id="hasta" name="hasta" type="date" defaultValue={values.hasta ?? ''} className="input-base" />
          </FieldShell>
        );
      default:
        return null;
    }
  };

  return (
    <form action={action} className="card px-4 py-3">
      {extraHidden
        ? Object.entries(extraHidden).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))
        : null}

      <div className="flex flex-wrap items-end gap-3">
        {primaryFields.map(renderField)}

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

      {secondary.size > 0 ? (
        <details className="mt-3 border-t border-slate-100 pt-2" open={secondaryActive > 0}>
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-slate-600 hover:text-petrol-800">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Más filtros
            {secondaryActive > 0 ? (
              <span className="rounded-full bg-petrol-50 px-2 py-0.5 text-xs text-petrol-700">
                {secondaryActive}
              </span>
            ) : null}
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </summary>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {secondaryFields.filter((field) => secondary.has(field)).map(renderField)}
          </div>
        </details>
      ) : null}
    </form>
  );
}
