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
 * El panel se monta en `document.body`, pero su centro NO se calcula a partir
 * del contenedor de la aplicación. El Libro tiene una barra lateral fija en
 * escritorio y un centrado por flex podía terminar tomando como referencia la
 * columna de contenido, dejando la ventana corrida hacia la derecha.
 *
 * Por eso el panel se posiciona explícitamente en 50vw / 50dvh: son unidades
 * del viewport real. La barra lateral, el ancho del contenido y cualquier
 * wrapper de la página dejan de participar en el cálculo.
 *
 * Cuando el formulario es largo, sólo se desplaza el cuerpo del diálogo y la
 * cabecera permanece visible.
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
  open: controlledOpen,
  onOpenChange,
  dismissible = true,
}: {
  trigger?: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  width?: 'sm' | 'md' | 'lg';
  triggerVariant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold';
  triggerSize?: 'sm' | 'md' | 'lg';
  triggerClassName?: string;
  /** Permite que un flujo compuesto controle el diálogo desde fuera. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Cuando es false, sólo una acción explícita del contenido puede cerrarlo. */
  dismissible?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (dismissible && event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus({ preventScroll: true });

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, dismissible]);

  const overlay = (
    <div
      className="fixed inset-0 z-[100] bg-petrol-950/40 overscroll-contain"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          /*
            `vw` / `dvh` fuerzan el centro de la pantalla completa. No usar
            `items-center` acá: el diálogo no debe poder heredar el ancho útil
            de la columna principal del shell.

            Tampoco usamos `animate-fade-in` en este nodo: esa animación escribe
            `transform` y pisaría el `translate` que hace el centrado.
          */
          'fixed left-[50vw] top-[50dvh] flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl bg-white shadow-xl outline-none',
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
          {dismissible ? (
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar"
              className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-petrol-800"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <DialogProvider close={() => setOpen(false)}>{children}</DialogProvider>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {trigger !== undefined && trigger !== null ? (
        <Button
          type="button"
          variant={triggerVariant}
          size={triggerSize}
          className={triggerClassName}
          onClick={() => setOpen(true)}
        >
          {trigger}
        </Button>
      ) : null}

      {open && mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}
