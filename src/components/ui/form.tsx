'use client';

import { createContext, useActionState, useContext, useEffect, useId } from 'react';
import { cn } from '@/lib/cn';
import type { ActionState } from '@/server/action';

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

/**
 * Formulario conectado a una acción de servidor.
 *
 * Muestra el resultado (éxito o error) y los errores por campo que devuelve la
 * validación de servidor, de modo que la interfaz nunca queda en un estado
 * ambiguo. La validación real siempre ocurre en el servidor.
 */
export function ActionForm({
  action,
  children,
  className,
  closeOnSuccess = false,
  resetOnSuccess = false,
  hideSuccess = false,
}: {
  action: (state: ActionState | null, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  className?: string;
  closeOnSuccess?: boolean;
  resetOnSuccess?: boolean;
  hideSuccess?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const close = useDialogClose();
  const formId = useId();

  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) {
        const form = document.getElementById(formId) as HTMLFormElement | null;
        form?.reset();
      }
      if (closeOnSuccess && close) close();
    }
  }, [state, close, closeOnSuccess, resetOnSuccess, formId]);

  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <FormContext.Provider value={{ errors }}>
      <form id={formId} action={formAction} className={cn('space-y-4', className)}>
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
        {children}
      </form>
    </FormContext.Provider>
  );
}

function FieldErrors({ name }: { name: string }) {
  const { errors } = useContext(FormContext);
  const list = errors[name];
  if (!list || list.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-red-700" role="alert">
      {list.join(' · ')}
    </p>
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
