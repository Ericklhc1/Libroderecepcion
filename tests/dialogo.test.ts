import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * El diálogo de acciones rápidas, y por qué se veía descuadrado.
 *
 * Fallo reportado: «todos los botones de arriba hacen que vea feo-descuadrado».
 * Al abrir Nueva novedad o Nueva incidencia el panel salía cortado por el
 * borde superior, sin cabecera, con un scroll interno que no llevaba a
 * ninguna parte.
 *
 * Eran tres causas sumadas, y las tres son estructurales —dónde vive el nodo,
 * dónde vive el scroll y qué hace el foco—, no cuestión de píxeles. Por eso se
 * comprueban sobre el código: lo que hay que impedir es que alguien las
 * reintroduzca sin darse cuenta.
 */
const source = readFileSync('src/components/ui/dialog.tsx', 'utf-8');

describe('el diálogo vive en un portal', () => {
  /*
    `position: fixed` NO se mide siempre contra la ventana: cualquier ancestro
    con transform, filter, perspective o contain se convierte en su marco de
    referencia, y entonces `inset-0` cubre ese ancestro en vez de la pantalla.
    Renderizado dentro del contenido, eso depende de dónde se use el diálogo y
    cambia al tocar cualquier contenedor de arriba.
  */
  it('se cuelga de document.body', () => {
    expect(source).toContain('createPortal');
    expect(source).toMatch(/createPortal\(\s*overlay,\s*document\.body\s*\)/);
  });

  it('espera a estar montado antes de crear el portal', () => {
    // `document` no existe al renderizar en el servidor.
    expect(source).toMatch(/open && mounted/);
  });
});

describe('el scroll vive en el fondo, no en el panel', () => {
  /*
    Con el scroll en el panel y centrado vertical, un formulario más alto que
    la ventana se centra desbordando por arriba Y por abajo: el borde superior
    queda fuera de la pantalla y no hay forma de alcanzarlo.
  */
  it('el fondo es el contenedor desplazable', () => {
    const overlay = source.slice(source.indexOf('fixed inset-0'));
    expect(overlay.slice(0, 200)).toContain('overflow-y-auto');
  });

  it('el envoltorio mide min-h-full para poder centrar y desplazar', () => {
    expect(source).toContain('min-h-full');
  });

  it('el panel ya no es el que desplaza', () => {
    // El panel es un flex vertical: cabecera fija y cuerpo desplazable.
    const panel = source.slice(source.indexOf('max-h-[92vh]'));
    expect(panel.slice(0, 160)).toContain('flex-col');
  });

  it('sólo el cuerpo desplaza, y la cabecera no se encoge', () => {
    expect(source).toContain('shrink-0');
    expect(source).toMatch(/min-h-0 flex-1 overflow-y-auto/);
  });

  /*
    La cabecera era `sticky top-0` dentro del panel desplazable. Eso funciona
    mientras nada empuje el panel fuera de la pantalla; siendo hermana del
    cuerpo en un flex, no hay forma de que desaparezca.
  */
  it('la cabecera ya no depende de sticky', () => {
    const header = source.slice(source.indexOf('text-base font-semibold'));
    expect(header).not.toContain('sticky');
  });
});

describe('el enfoque no arrastra el scroll', () => {
  /*
    `focus()` desplaza a TODOS los ancestros desplazables para traer el campo a
    la vista. Enfocar el primer campo empujaba la cabecera fuera del cuadro
    antes de que el usuario tocara nada.
  */
  it('enfoca sin desplazar', () => {
    expect(source).toContain('preventScroll: true');
  });

  it('el foco arranca en el panel, no en el primer campo', () => {
    // Es lo correcto para un lector de pantalla: anuncia el diálogo primero.
    expect(source).toMatch(/panelRef\.current\?\.focus/);
    expect(source).not.toMatch(/querySelector<HTMLElement>\('input/);
  });

  it('el panel es enfocable y se anuncia como diálogo', () => {
    expect(source).toContain('tabIndex={-1}');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('role="dialog"');
  });
});

describe('al cerrar, la página queda como estaba', () => {
  /*
    Vaciar `overflow` al cerrar le devolvía el scroll a pantallas que lo tenían
    bloqueado a propósito —el comunicado obligatorio, por ejemplo—. Se guarda
    el valor anterior y se restaura ése.
  */
  it('restaura el overflow anterior en vez de vaciarlo', () => {
    expect(source).toContain('previousOverflow');
    expect(source).not.toMatch(/document\.body\.style\.overflow = ''/);
  });
});
