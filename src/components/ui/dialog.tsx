'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { DialogProvider } from './form';
import { Button } from './button';

/**
 * Modal simple y accesible. Se usa sólo para acciones rápidas (crear novedad,
 * incidencia, tarea o seguimiento); los formularios largos viven en su página.
 *
 * Tres decisiones que parecen de detalle y son las que lo mantienen cuadrado.
 * Fallo reportado: al abrir cualquiera de los botones de arriba el diálogo se
 * veía descuadrado, con la cabecera cortada por el borde superior y un scroll
 * interno que no llevaba a ninguna parte.
 *
 * 1. VA EN UN PORTAL, colgado de `document.body`.
 *
 *    Antes se renderizaba donde estuviera el botón que lo abre. `position:
 *    fixed` no se mide siempre contra la ventana: cualquier ancestro con
 *    `transform`, `filter`, `perspective` o `contain` se convierte en su marco
 *    de referencia, y entonces `inset-0` cubre ESE ancestro y no la pantalla.
 *    Con el diálogo dentro del contenido de la página, eso depende de dónde se
 *    use —y cambia al tocar cualquier contenedor de arriba—. En el portal no
 *    hay ancestros, así que no puede volver a pasar.
 *
 * 2. EL SCROLL VIVE EN EL FONDO, NO EN EL PANEL.
 *
 *    Con `items-center` y el scroll en el panel, un formulario más alto que la
 *    ventana se centra desbordando por ARRIBA y por abajo a la vez, y el borde
 *    superior queda fuera de la pantalla, inalcanzable. Ahora desplaza el
 *    fondo: el panel se centra con `my-auto` mientras cabe, y cuando no cabe se
 *    apoya arriba y se baja con el scroll de la página del diálogo.
 *
 * 3. EL ENFOQUE NO ARRASTRA EL SCROLL.
 *
 *    `focus()` desplaza a todos los ancestros desplazables para traer el campo
 *    a la vista. Enfocar el primer campo empujaba la cabecera fuera del cuadro
 *    antes de que el usuario tocara nada. `preventScroll` lo evita, y el foco
 *    arranca en el propio panel, que es lo correcto para un lector de
 *    pantalla: anuncia el diálogo antes que el primer campo.
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

  // `document` no existe al renderizar en el servidor: el portal sólo puede
  // crearse una vez montado en el navegador.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);

    /*
      Se guarda el valor anterior en lugar de vaciarlo al cerrar: si alguna
      pantalla ya bloqueaba el scroll del cuerpo, cerrar el diálogo se lo
      devolvía desbloqueado.
    */
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
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-petrol-950/40"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      {/*
        El envoltorio mide `min-h-full` para que el centrado vertical funcione
        cuando el panel cabe, y para que el fondo siga siendo desplazable
        cuando no. El clic en esta zona también cierra: es el fondo visible.
      */}
      <div
        className="flex min-h-full items-end justify-center sm:items-center sm:p-4"
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
            'flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl outline-none animate-fade-in sm:my-auto sm:rounded-2xl',
            width === 'sm' ? 'sm:max-w-md' : width === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-xl',
          )}
        >
          {/*
            Cabecera y cuerpo son hermanos de un flex vertical, y el scroll está
            SÓLO en el cuerpo. Antes la cabecera era `sticky` dentro del panel
            desplazable, lo que funciona mientras nada empuje el panel fuera de
            la pantalla; siendo hermana, no hay forma de que desaparezca.
          */}
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
