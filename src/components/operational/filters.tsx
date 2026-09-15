import Link from 'next/link';
import { Filter, X } from 'lucide-react';
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

/**
 * Filtros combinables. Es un formulario GET: funciona sin JavaScript, los
 * filtros quedan en la URL (compartibles) y el servidor los valida.
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

  return (
    <form action={action} className="card px-4 py-3">
      {extraHidden
        ? Object.entries(extraHidden).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))
        : null}

      <div className="flex flex-wrap items-end gap-3">
        {has('q') ? (
          <div className="min-w-[200px] flex-1">
            <label htmlFor="q" className="label-base">
              Buscar
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={values.q ?? ''}
              placeholder="Título, descripción, huésped, reserva, etiqueta"
              className="input-base"
            />
          </div>
        ) : null}

        {has('clase') ? (
          <div>
            <label htmlFor="clase" className="label-base">
              Qué mostrar
            </label>
            <select id="clase" name="clase" defaultValue={values.clase ?? ''} className="input-base">
              <option value="">Todo</option>
              <option value="entry">Registros</option>
              <option value="task">Tareas</option>
              <option value="followup">Seguimientos</option>
              <option value="alert">Alertas</option>
            </select>
          </div>
        ) : null}

        {has('tipo') ? (
          <div>
            <label htmlFor="tipo" className="label-base">
              Tipo
            </label>
            <select id="tipo" name="tipo" defaultValue={values.tipo ?? ''} className="input-base">
              <option value="">Todos</option>
              {Object.values(EntryType).map((type) => (
                <option key={type} value={type}>
                  {ENTRY_TYPE_LABEL[type]}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {has('estado') ? (
          <div>
            <label htmlFor="estado" className="label-base">
              Estado
            </label>
            <select id="estado" name="estado" defaultValue={values.estado ?? ''} className="input-base">
              <option value="">Todos</option>
              <option value="abiertos">Sólo abiertos</option>
              {Object.values(EntryStatus).map((status) => (
                <option key={status} value={status}>
                  {ENTRY_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {has('estadoTarea') ? (
          <div>
            <label htmlFor="estado" className="label-base">
              Estado
            </label>
            <select id="estado" name="estado" defaultValue={values.estado ?? ''} className="input-base">
              <option value="">Todos</option>
              <option value="abiertos">Sólo abiertas</option>
              {Object.values(TaskStatus).map((status) => (
                <option key={status} value={status}>
                  {TASK_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {has('prioridad') ? (
          <div>
            <label htmlFor="prioridad" className="label-base">
              Prioridad
            </label>
            <select
              id="prioridad"
              name="prioridad"
              defaultValue={values.prioridad ?? ''}
              className="input-base"
            >
              <option value="">Todas</option>
              {Object.values(Priority).map((priority) => (
                <option key={priority} value={priority}>
                  {PRIORITY_LABEL[priority]}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {has('area') ? (
          <div>
            <label htmlFor="area" className="label-base">
              Área
            </label>
            <select id="area" name="area" defaultValue={values.area ?? ''} className="input-base">
              <option value="">Todas</option>
              {options.departments.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {has('responsable') ? (
          <div>
            <label htmlFor="responsable" className="label-base">
              Responsable
            </label>
            <select
              id="responsable"
              name="responsable"
              defaultValue={values.responsable ?? ''}
              className="input-base"
            >
              <option value="">Cualquiera</option>
              {options.users.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {has('usuario') ? (
          <div>
            <label htmlFor="usuario" className="label-base">
              Usuario
            </label>
            <select
              id="usuario"
              name="usuario"
              defaultValue={values.usuario ?? ''}
              className="input-base"
            >
              <option value="">Cualquiera</option>
              {options.users.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {has('turno') && options.shifts ? (
          <div>
            <label htmlFor="turno" className="label-base">
              Turno
            </label>
            <select id="turno" name="turno" defaultValue={values.turno ?? ''} className="input-base">
              <option value="">Todos</option>
              {options.shifts.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {has('habitacion') ? (
          <div className="w-28">
            <label htmlFor="habitacion" className="label-base">
              Habitación
            </label>
            <input
              id="habitacion"
              name="habitacion"
              defaultValue={values.habitacion ?? ''}
              className="input-base"
              placeholder="318"
            />
          </div>
        ) : null}

        {has('reserva') ? (
          <div className="w-36">
            <label htmlFor="reserva" className="label-base">
              Reserva
            </label>
            <input
              id="reserva"
              name="reserva"
              defaultValue={values.reserva ?? ''}
              className="input-base"
              placeholder="RES-10241"
            />
          </div>
        ) : null}

        {has('desde') ? (
          <div>
            <label htmlFor="desde" className="label-base">
              Desde
            </label>
            <input
              id="desde"
              name="desde"
              type="date"
              defaultValue={values.desde ?? ''}
              className="input-base"
            />
          </div>
        ) : null}

        {has('hasta') ? (
          <div>
            <label htmlFor="hasta" className="label-base">
              Hasta
            </label>
            <input
              id="hasta"
              name="hasta"
              type="date"
              defaultValue={values.hasta ?? ''}
              className="input-base"
            />
          </div>
        ) : null}

        <div className="flex items-center gap-2 pb-0.5">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-petrol-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-petrol-800"
          >
            <Filter className="h-4 w-4" aria-hidden="true" />
            Filtrar
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
    </form>
  );
}
