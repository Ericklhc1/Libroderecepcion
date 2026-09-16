'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DialogProvider } from './form';
import { Button } from './button';

/**
 * Modal simple y accesible para las acciones rápidas del Libro.
 *
 * El panel siempre se monta en `document.body` y se centra contra el viewport,
 * no contra el contenedor donde vive el botón. El alto máximo usa `dvh` para
 * respetar la ventana visible real; cuando el formulario es largo, sólo se
 * desplaza el cuerpo del diálogo y la cabecera permanece visible.
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
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus({ preventScroll: true });

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const overlay = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-petrol-950/40 p-4 overscroll-contain"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-2xl bg-white shadow-xl outline-none animate-fade-in',
          width === 'sm' ? 'max-w-md' : width === 'lg' ? 'max-w-3xl' : 'max-w-xl',
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
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
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <DialogProvider close={() => setOpen(false)}>{children}</DialogProvider>
        </div>
      </div>
    </div>
  );

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

      {open && mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}
