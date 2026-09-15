'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DialogProvider } from './form';
import { Button } from './button';

/**
 * Modal simple y accesible. Se usa sólo para acciones rápidas (crear novedad,
 * incidencia, tarea o seguimiento); los formularios largos viven en su página.
 */
export function Dialog({
  trigger,
  title,
  description,
  children,
  width = 'md',
  triggerVariant = 'primary',
  triggerSize = 'md',
  triggerClassName,
}: {
  trigger: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  width?: 'sm' | 'md' | 'lg';
  triggerVariant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
  triggerSize?: 'sm' | 'md' | 'lg';
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>('input, textarea, select, button')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        className={triggerClassName}
        onClick={() => setOpen(true)}
      >
        {trigger}
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-petrol-950/40 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={panelRef}
            className={cn(
              'max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl animate-fade-in sm:rounded-2xl',
              width === 'sm' ? 'sm:max-w-md' : width === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-xl',
            )}
          >
            <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-petrol-900">{title}</h2>
                {description ? (
                  <p className="mt-0.5 text-xs text-slate-500">{description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-petrol-800"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="px-5 py-4">
              <DialogProvider close={() => setOpen(false)}>{children}</DialogProvider>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
