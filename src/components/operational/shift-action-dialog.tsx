'use client';

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { useFormStatus } from 'react-dom';
import { ActionForm } from '@/components/ui/form';
import { SubmitButton } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

type ShiftActionDialogProps = Pick<
  ComponentProps<typeof ActionForm>,
  'action' | 'onSuccess' | 'refreshOnSuccess'
> & {
  shiftId: string;
  trigger: string;
  triggerClassName?: string;
  triggerVariant?: ComponentProps<typeof Dialog>['triggerVariant'];
  title: string;
  description: string;
  children?: React.ReactNode;
  backLabel: string;
  confirmLabel: string;
  pendingLabel: string;
  variant?: ComponentProps<typeof SubmitButton>['variant'];
};

function ConfirmationControls({
  backLabel,
  confirmLabel,
  pendingLabel,
  variant,
  onBack,
  onPendingChange,
}: Pick<ShiftActionDialogProps, 'backLabel' | 'confirmLabel' | 'pendingLabel' | 'variant'> & {
  onBack: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { pending } = useFormStatus();
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);

  return (
    <>
      {pending ? (
        <p role="status" className="text-sm text-slate-600">
          {pendingLabel} Espera el resultado. La operación ya está en curso.
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={onBack}
          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-petrol-800 ring-1 ring-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          {backLabel}
        </button>
        <SubmitButton variant={variant} pendingLabel={pendingLabel}>
          {confirmLabel}
        </SubmitButton>
      </div>
    </>
  );
}

/** El formulario completo viaja al portal: campos, validación y error siguen juntos. */
export function ShiftActionDialog({
  action,
  onSuccess,
  refreshOnSuccess,
  shiftId,
  trigger,
  triggerVariant = 'gold',
  triggerClassName,
  title,
  description,
  children,
  backLabel,
  confirmLabel,
  pendingLabel,
  variant = 'gold',
}: ShiftActionDialogProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const submittedRef = useRef(false);
  const onPendingChange = useCallback((next: boolean) => {
    // Un efecto inicial de FormStatus no puede desbloquear una acción ya enviada.
    if (!next && (pendingRef.current || submittedRef.current)) return;
    setPending(next);
  }, []);
  const guardedAction = useCallback<ShiftActionDialogProps['action']>(async (state, formData) => {
    // Impide descartar desde que se envía, antes del efecto de useFormStatus.
    pendingRef.current = true;
    onPendingChange(true);
    try {
      return await action(state, formData);
    } catch (error) {
      // redirect/notFound siguen perteneciendo al control de flujo de Next.
      if (error && typeof error === 'object' && 'digest' in error
        && typeof error.digest === 'string' && error.digest.startsWith('NEXT_')) {
        throw error;
      }
      // Un fallo de transporte no prueba que el servidor no haya guardado.
      return {
        ok: false,
        error: 'No se pudo confirmar el resultado. La operación podría haberse completado; revisa el estado del turno antes de volver a enviarla.',
      };
    } finally {
      pendingRef.current = false;
    }
  }, [action, onPendingChange]);
  const onOpenChange = useCallback((next: boolean) => {
    if (!submittedRef.current && !pendingRef.current && !pending) setOpen(next);
  }, [pending]);

  return (
    <Dialog
      trigger={trigger}
      triggerVariant={triggerVariant}
      triggerClassName={triggerClassName}
      overlayClassName="no-print"
      title={title}
      description={description}
      open={open}
      onOpenChange={onOpenChange}
      dismissible={!pending}
    >
      <div onSubmitCapture={(event) => {
        // Two clicks can arrive before React paints disabled. Stop the second
        // native submit before useActionState can queue another server call.
        if (submittedRef.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        submittedRef.current = true;
        onPendingChange(true);
      }}>
      <ActionForm
        action={guardedAction}
        hideSuccess
        refreshOnSuccess={refreshOnSuccess}
        onError={() => {
          submittedRef.current = false;
          onPendingChange(false);
        }}
        onSuccess={(state) => {
          submittedRef.current = false;
          onPendingChange(false);
          setOpen(false);
          onSuccess?.(state);
        }}
      >
        <input type="hidden" name="shiftId" value={shiftId} />
        {children}
        <ConfirmationControls
          backLabel={backLabel}
          confirmLabel={confirmLabel}
          pendingLabel={pendingLabel}
          variant={variant}
          onBack={() => onOpenChange(false)}
          onPendingChange={onPendingChange}
        />
      </ActionForm>
      </div>
    </Dialog>
  );
}
