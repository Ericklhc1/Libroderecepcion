'use client';

import { useId } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useAppearance } from './appearance-provider';

const OPTIONS = [
  { value: 'light', label: 'Claro', Icon: Sun },
  { value: 'dark', label: 'Oscuro', Icon: Moon },
  { value: 'system', label: 'Sistema', Icon: Monitor },
] as const;

/** Native radios retain Tab, arrow-key and screen-reader behavior. */
export function AppearancePreference() {
  const id = useId();
  const { preference, persisted, setPreference } = useAppearance();

  return (
    <fieldset className="appearance-preference min-w-0" aria-describedby={`${id}-hint`}>
      <legend className="mb-2 text-xs font-semibold text-petrol-800">Apariencia</legend>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
        {OPTIONS.map(({ value, label, Icon }) => (
          <label key={value} className="appearance-option relative min-w-0 cursor-pointer">
            <input
              type="radio"
              name={`${id}-appearance`}
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value)}
              className="peer sr-only"
            />
            <span className="flex min-h-11 items-center justify-center gap-1.5 rounded-md px-1 text-xs font-medium text-slate-600 peer-checked:bg-white peer-checked:text-petrol-900 peer-checked:shadow-sm">
              <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {label}
            </span>
          </label>
        ))}
      </div>
      <p id={`${id}-hint`} className="mt-2 text-xs leading-4 text-slate-500">
        Sistema sigue el aspecto de tu dispositivo.
      </p>
      <p role="status" aria-live="polite" className="mt-1 text-xs leading-4 text-slate-500">
        {!persisted ? 'No se pudo guardar. Se aplicará mientras esta página siga abierta.' : null}
      </p>
    </fieldset>
  );
}
