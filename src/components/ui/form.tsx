'use client';

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { ActionState, RevealedCredentials } from '@/server/action';

type FormErrors = Record<string, string[]>;

const FormContext = createContext<{ errors: FormErrors }>({ errors: {} });
const DialogContext = createContext<{ close: () => void } | null>(null);

export function useDialogClose() {
  return useContext(DialogContext)?.close;
}

export function DialogProvider({
  close,
  children,
}: {
  close: () => void;
  children: React.ReactNode;
}) {
  return <DialogContext.Provider value={{ close }}>{children}</DialogContext.Provider>;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type ControlValue = { value: string; checked: boolean; selected: string[] | null };

/** Campos cuyo contenido tiene sentido devolver a la pantalla tras un error. */
function isRestorable(element: Element): element is Control {
  if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName)) return false;
  const control = element as Control;
  // Los campos internos de las acciones de servidor empiezan con "$ACTION".
  if (!control.name || control.name.startsWith('$ACTION')) return false;
  if (control instanceof HTMLInputElement) {
    return !['file', 'hidden', 'submit', 'button', 'image', 'reset'].includes(control.type);
  }
  return true;
}

/**
 * Recorre los campos del formulario en orden y les asigna una clave estable
 * (nombre + repetición), de modo que lo escrito pueda devolverse al mismo
 * campo aunque existan varios con el mismo nombre.
 */
function eachControl(
  form: HTMLFormElement,
  visit: (control: Control, key: string) => void,
): void {
  const seen = new Map<string, number>();
  for (const element of Array.from(form.elements)) {
    if (!isRestorable(element)) continue;
    const repetition = seen.get(element.name) ?? 0;
    seen.set(element.name, repetition + 1);
    visit(element, `${element.name}#${repetition}`);
  }
}

function readControls(form: HTMLFormElement): Map<string, ControlValue> {
  const values = new Map<string, ControlValue>();
  eachControl(form, (control, key) => {
    values.set(key, {
      value: control.value,
      checked: control instanceof HTMLInputElement ? control.checked : false,
      selected:
        control instanceof HTMLSelectElement && control.multiple
          ? Array.from(control.selectedOptions, (option) => option.value)
          : null,
    });
  });
  return values;
}

function writeControls(form: HTMLFormElement, values: Map<string, ControlValue>): void {
  eachControl(form, (control, key) => {
    const stored = values.get(key);
    if (!stored) return;
    if (control instanceof HTMLInputElement && ['checkbox', 'radio'].includes(control.type)) {
      control.checked = stored.checked;
      return;
    }
    if (control instanceof HTMLSelectElement && control.multiple && stored.selected) {
      for (const option of Array.from(control.options)) {
        option.selected = stored.selected.includes(option.value);
      }
      return;
    }
    control.value = stored.value;
  });
}

/**
 * Credenciales de una sola lectura.
 *
 * La clave que genera el sistema no se guarda en claro en ninguna parte: si
 * esta pantalla se cierra sin copiarla, hay que restablecerla. Por eso se
 * muestra en un bloque propio, seleccionable, con copia al portapapeles y un
 * aviso explícito, en lugar de ir dentro de una frase.
 */
function CredentialsPanel({ credentials }: { credentials: RevealedCredentials }) {
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  const plain = [
    `Nombre: ${credentials.name}`,
    `Usuario: @${credentials.username}`,
    `Clave temporal: ${credentials.password}`,
  ].join('\n');

  async function copy() {
    try {
      // Puede no existir fuera de un contexto seguro: nunca debe romper la
      // pantalla, porque el texto igual se puede seleccionar a mano.
      await navigator.clipboard.writeText(plain);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
  }

  const rows: Array<[string, string]> = [
    ['Nombre', credentials.name],
    ['Usuario', `@${credentials.username}`],
    ['Clave temporal', credentials.password],
  ];

  return (
    <div className="rounded-lg border border-gold-400 bg-gold-50/60 p-3" role="group">
      <p className="text-sm font-semibold text-petrol-900">
        Credenciales de {credentials.name}
      </p>

      {credentials.sent ? (
        <p className="mt-1 text-xs text-slate-600">
          Se enviaron a {credentials.recipient}. Quedan también aquí por si hace falta
          entregarlas en persona.
        </p>
      ) : (
        <p className="mt-1 text-xs text-slate-700">
          <strong className="font-semibold">No se pudo enviar el correo</strong> a{' '}
          {credentials.recipient}
          {credentials.reason ? `: ${credentials.reason}` : '.'} Cópialas ahora y entrégalas
          en persona.
        </p>
      )}

      <dl className="mt-3 space-y-1">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-wrap items-baseline gap-2">
            <dt className="w-32 shrink-0 text-xs font-medium text-slate-500">{label}</dt>
            <dd className="min-w-0 flex-1 break-all font-mono text-sm text-petrol-900">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-petrol-700 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-petrol-800 active:bg-petrol-900"
        >
          Copiar credenciales
        </button>
        <span aria-live="polite" className="text-xs text-slate-600">
          {copied === 'ok' ? 'Copiadas al portapapeles.' : null}
          {copied === 'fail' ? 'No se pudo copiar: selecciona el texto a mano.' : null}
        </span>
      </div>

      <p className="mt-3 border-t border-gold-300 pt-2 text-xs text-slate-600">
        La clave no se guarda en claro y no se puede volver a consultar. Si se pierde, usa
        «Contraseña» en la fila del usuario para asignarle una nueva.
      </p>
    </div>
  );
}

/**
 * Formulario conectado a una acción de servidor.
 *
 * Muestra el resultado (éxito o error) y los errores por campo que devuelve la
 * validación de servidor, de modo que la interfaz nunca queda en un estado
 * ambiguo. La validación real siempre ocurre en el servidor.
 *
 * React vacía el formulario en cuanto la acción termina. Eso es correcto
 * cuando el registro se guardó, pero no cuando la validación falló: en plena
 * recepción, quien está registrando una novedad larga no puede perder el texto
 * por haber olvidado un campo. Por eso se guarda lo escrito al enviar y se
 * devuelve a la pantalla si la respuesta trae un error.
 */
export function ActionForm({
  action,
  children,
  className,
  closeOnSuccess = false,
  resetOnSuccess = false,
  hideSuccess = false,
  refreshOnSuccess = false,
  onSuccess,
}: {
  action: (state: ActionState | null, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  closeOnSuccess?: boolean;
  resetOnSuccess?: boolean;
  hideSuccess?: boolean;
  /**
   * Vuelve a pedir la pantalla al servidor cuando la acción tiene éxito.
   *
   * Hace falta cuando lo que cambia se calcula en el LAYOUT, no en la página:
   * `revalidatePath` invalida la caché del servidor, pero el router del
   * cliente sigue mostrando el árbol que ya tenía. Fue un fallo real: al
   * confirmar un comunicado obligatorio la confirmación se guardaba en la
   * base y la pantalla seguía bloqueada.
   */
  refreshOnSuccess?: boolean;
  /** Callback cliente para encadenar un flujo visual después de guardar. */
  onSuccess?: (state: Extract<ActionState, { ok: true }>) => void;
}) {
  const [state, formAction] = useActionState(action, null);
  const router = useRouter();
  const close = useDialogClose();
  const formId = useId();
  const submitted = useRef<Map<string, ControlValue> | null>(null);
  const handledSuccess = useRef<ActionState | null>(null);

  /*
    Si la respuesta trae credenciales, el formulario NO se cierra ni se vacía
    por su cuenta. Fue un error real: la clave generada viajaba en el mensaje,
    el diálogo se cerraba al tener éxito y la clave —que no se puede
    recuperar— desaparecía antes de que nadie la leyera. El usuario quedaba
    creado y sin forma de entrar.
  */
  const reveals = state?.ok === true && state.credentials !== undefined;

  useEffect(() => {
    if (!state) return;
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (state.ok) {
      submitted.current = null;
      if (state.credentials) return;
      if (resetOnSuccess) form?.reset();
      if (closeOnSuccess && close) close();
      if (refreshOnSuccess) router.refresh();
      if (handledSuccess.current !== state) {
        handledSuccess.current = state;
        onSuccess?.(state);
      }
      return;
    }
    if (form && submitted.current) writeControls(form, submitted.current);
  }, [state, close, closeOnSuccess, resetOnSuccess, refreshOnSuccess, router, formId, onSuccess]);

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <FormContext.Provider value={{ errors }}>
      <form
        id={formId}
        action={formAction}
        onSubmit={(event) => {
          submitted.current = readControls(event.currentTarget);
        }}
        className={cn('space-y-4', className)}
      >
        {/*
          El aviso vive en un contenedor que siempre está presente para que el
          lector de pantalla anuncie el cambio sin que se reordene el resto.
        */}
        <div aria-live="polite">
          {state && !state.ok ? (
            <p
              role="alert"
              className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 ring-1 ring-red-200"
            >
              {state.error}
            </p>
          ) : null}
          {state?.ok && !hideSuccess ? (
            <p
              role="status"
              className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-200"
            >
              {state.message}
            </p>
          ) : null}
          {state?.ok && state.credentials ? (
            <div className="mt-2">
              <CredentialsPanel credentials={state.credentials} />
            </div>
          ) : null}
        </div>

        {/*
          Con credenciales en pantalla, los campos ya no sirven: lo único que
          queda por hacer es copiarlas y cerrar deliberadamente.
        */}
        {reveals ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => close?.()}
              className="rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-petrol-800 ring-1 ring-slate-300 transition-colors hover:bg-slate-50"
            >
              Ya las copié, cerrar
            </button>
          </div>
        ) : null}
        {reveals ? null : children}
      </form>
    </FormContext.Provider>
  );
}

function FieldErrors({ name }: { name: string }) {
  const { errors } = useContext(FormContext);
  const list = errors[name];
  return (
    <div aria-live="polite">
      {list && list.length > 0 ? (
        <p className="mt-1 text-xs text-red-700" role="alert">
          {list.join(' · ')}
        </p>
      ) : null}
    </div>
  );
}

export function Field({
  label,
  name,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  name: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className="label-base">
        {label}
        {required ? <span className="ml-1 text-red-600">*</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      <FieldErrors name={name} />
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} id={props.id ?? props.name} className={cn('input-base', props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      id={props.id ?? props.name}
      className={cn('input-base min-h-[88px]', props.className)}
    />
  );
}

export function Select({
  options,
  placeholder,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  placeholder?: string;
}) {
  return (
    <select
      {...props}
      id={props.id ?? props.name}
      className={cn('input-base', props.className)}
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  label,
  hint,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <div>
      <label className="flex items-start gap-2 text-sm text-petrol-900">
        <input
          type="checkbox"
          {...props}
          id={props.id ?? props.name}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-petrol-700 focus:ring-gold-500"
        />
        <span>
          {label}
          {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
        </span>
      </label>
      <FieldErrors name={props.name ?? ''} />
    </div>
  );
}
