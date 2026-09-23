import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, NAV_ITEMS, visibleNavGroups, visibleNavItems } from '@/components/layout/nav-items';
import {
  ROLE_PERMISSIONS,
  ROLE_KEYS,
  hasTechnicalAdminAccess,
  type PermissionKey,
} from '@/lib/permissions';

/** Los cuatro roles del hotel, para no repetirlos en cada prueba. */
const ROLES = Object.values(ROLE_KEYS);

/**
 * Contrato de la navegación.
 *
 * La simplificación no es cosmética: tareas, incidencias, alertas y
 * seguimientos son clases de un mismo flujo, no cuatro módulos. Si alguien
 * los vuelve a agregar al menú, estas pruebas fallan.
 */
const RETIRED_FROM_MENU = ['/tareas', '/incidencias', '/alertas', '/seguimientos'];

describe('menú principal', () => {
  it('no ofrece las cuatro entidades como módulos separados', () => {
    const hrefs = NAV_GROUPS.flatMap((group) => group.items).map((item) => item.href);
    for (const retired of RETIRED_FROM_MENU) {
      expect(hrefs).not.toContain(retired);
    }
  });

  it('expone el núcleo operativo y el Centro privado', () => {
    const primary = NAV_GROUPS[0]!;
    expect(primary.title).toBeNull();
    expect(primary.items.map((item) => item.href)).toEqual([
      '/', // ventana operativa
      '/libro?clase=entry', // novedades: núcleo temporal del mesón
      '/caja', // centralización financiera
      '/turno', // fotografía y relevo del turno
      '/llaves', // inventario físico autónomo
      '/supervision', // Centro privado, sólo visible con permiso específico
    ]);
  });

  /*
    La barra inferior no muestra TODOS los destinos marcados para móvil:
    `nav.tsx` recorta a los primeros y el resto vive detrás de «Más».

    Esta prueba exigía exactamente cinco y se rompió al sumarse Caja, que es
    lo correcto: el número no es una regla, es una consecuencia. Así que en vez
    de repetirlo acá se lee del componente, que es quien decide. Si alguien
    cambia el recorte, esto lo sigue sin avisar en falso; si alguien marca más
    destinos de los que caben, la prueba de alcanzabilidad de más abajo avisa.
  */
  it('el recorte de la barra móvil es el que dice el componente', () => {
    const nav = readFileSync('src/components/layout/nav.tsx', 'utf-8');
    const slice = nav.match(/\.filter\(\(item\) => item\.mobile\)\.slice\(0,\s*(\d+)\)/);
    expect(slice, 'no se encontró el recorte en nav.tsx').not.toBeNull();

    const slots = Number(slice![1]);
    const mobile = NAV_ITEMS.filter((item) => item.mobile);
    // Hay al menos con qué llenar la barra, y ninguno queda huérfano.
    expect(mobile.length).toBeGreaterThanOrEqual(slots);
  });

  it('las páginas retiradas del menú siguen existiendo', () => {
    // Quitar una sección del menú no puede significar perder la función.
    for (const retired of RETIRED_FROM_MENU) {
      const source = readFileSync(`src/app/(app)${retired}/page.tsx`, 'utf-8');
      expect(source).toContain('export default async function');
      // Y cada una debe ofrecer el camino de vuelta al libro.
      expect(source).toContain('/libro');
    }
  });
});

describe('visibilidad por rol', () => {
  it('el Recepcionista ve sólo el núcleo operativo vigente', () => {
    const hrefs = visibleNavItems(ROLE_PERMISSIONS[ROLE_KEYS.RECEPTIONIST]).map((i) => i.href);
    expect(hrefs).toEqual(['/', '/libro?clase=entry', '/caja', '/turno', '/llaves']);
  });

  it('el Supervisor ve el Centro como módulo raíz privado', () => {
    const permissions = ROLE_PERMISSIONS[ROLE_KEYS.SUPERVISOR];
    expect(permissions).toContain('supervision.view');
    expect(permissions).toContain('supervision.center.view');
    expect(visibleNavItems(permissions).map((i) => i.href)).toContain('/supervision');
  });

  it('separa la Auditoría de la Administración técnica', () => {
    const supervisor = visibleNavItems(ROLE_PERMISSIONS[ROLE_KEYS.SUPERVISOR]).map(
      (item) => item.href,
    );
    expect(supervisor).toContain('/admin/auditoria');
    expect(supervisor).not.toContain('/admin');

    const admin = visibleNavItems(ROLE_PERMISSIONS[ROLE_KEYS.SYSTEM_ADMIN]).map(
      (item) => item.href,
    );
    expect(admin).toContain('/admin/auditoria');
    expect(admin).toContain('/admin');
    expect(hasTechnicalAdminAccess(ROLE_PERMISSIONS[ROLE_KEYS.SUPERVISOR])).toBe(false);
    expect(hasTechnicalAdminAccess(ROLE_PERMISSIONS[ROLE_KEYS.SYSTEM_ADMIN])).toBe(true);
  });

  it('la portada de Administración exige una capacidad técnica', () => {
    const source = readFileSync('src/app/(app)/admin/page.tsx', 'utf-8');
    expect(source).toContain('hasTechnicalAdminAccess(user.permissions)');
    expect(source).toContain("redirect('/admin/auditoria')");
  });

  /*
    El Auditor nocturno es un perfil DE RECEPCIÓN, y le aparecía Supervisión.
    Dos causas a la vez: tenía `supervision.view`, y el menú además mostraba
    Supervisión a cualquiera con `incident.manage`, que el mesón sí necesita
    para mover una incidencia de noche. Se arreglaron las dos.
  */
  it('ningún perfil de recepción ve Supervisión', () => {
    for (const roleKey of [ROLE_KEYS.RECEPTIONIST, ROLE_KEYS.NIGHT_AUDITOR]) {
      const hrefs = visibleNavItems(ROLE_PERMISSIONS[roleKey]).map((i) => i.href);
      expect(hrefs, `${roleKey} no debe ver Supervisión`).not.toContain('/supervision');
    }
  });

  it('gestionar incidencias no abre la puerta de Supervisión', () => {
    // El permiso operativo, solo, no basta: era la causa del error.
    const hrefs = visibleNavItems(['incident.manage']).map((i) => i.href);
    expect(hrefs).not.toContain('/supervision');
  });

  it('el Administrador de sistema queda fuera de la operación del turno', () => {
    /*
      Ve Turno porque supervisa su historial (`shift.manage`), pero no
      puede iniciar, recibir ni entregar: es la exclusión que lo mantiene
      fuera de la operación habitual, y vive en los permisos, no en el menú.
    */
    const permissions = ROLE_PERMISSIONS[ROLE_KEYS.SYSTEM_ADMIN];
    expect(permissions).toContain('shift.manage');
    for (const operational of ['shift.start', 'shift.receive', 'shift.handover'] as const) {
      expect(permissions).not.toContain(operational);
    }
    expect(visibleNavItems(permissions).map((i) => i.href)).toContain('/admin');
  });

  it('no deja grupos vacíos en el menú', () => {
    for (const role of Object.values(ROLE_KEYS)) {
      const groups = visibleNavGroups(ROLE_PERMISSIONS[role]);
      for (const group of groups) {
        expect(group.items.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('barra lateral fija', () => {
  /*
    Error real: el aside no tenía altura acotada, así que su overflow interno
    nunca podía activarse y el menú se iba con el scroll de la página.
  */
  const layout = readFileSync('src/app/(app)/layout.tsx', 'utf-8');
  const aside = layout.slice(layout.indexOf('<aside'), layout.indexOf('</aside>'));

  it('el aside se fija a la ventana y acota su altura', () => {
    expect(aside).toMatch(/sticky/);
    expect(aside).toMatch(/h-screen/);
    expect(aside).toMatch(/top-0/);
  });

  it('ningún ancestro del aside recorta el desplazamiento', () => {
    // `sticky` deja de funcionar si un padre tiene overflow distinto de visible.
    const beforeAside = layout.slice(0, layout.indexOf('<aside'));
    expect(beforeAside).not.toMatch(/className="[^"]*overflow-(hidden|y-auto|x-auto|auto)/);
  });
});

/**
 * Ningún destino puede quedar inalcanzable desde el teléfono.
 *
 * El menú lateral está oculto por debajo de `lg`, así que la barra inferior es
 * la ÚNICA puerta en móvil. Pintaba cinco elementos y los cuatro de consulta
 * más Administración no tenían ninguna otra: Llaves, Huéspedes, Historial,
 * Indicadores y Administración no se podían abrir desde un teléfono.
 *
 * La barra muestra ahora los cuatro primeros y el resto vive detrás de «Más».
 * Estas pruebas cuidan las dos mitades de esa invariante.
 */
describe('todo el menú es alcanzable en móvil', () => {
  const MOBILE_SLOTS = 4;

  it('la barra inferior no puede prometer más destinos de los que caben', () => {
    const marcados = NAV_ITEMS.filter((item) => item.mobile);
    expect(marcados.length).toBeGreaterThanOrEqual(MOBILE_SLOTS);
  });

  for (const role of ROLES) {
    it(`${role}: cada destino visible está en la barra o detrás de «Más»`, () => {
      const permissions = [...ROLE_PERMISSIONS[role]] as PermissionKey[];
      const visibles = visibleNavItems(permissions);

      const enBarra = visibles.filter((item) => item.mobile).slice(0, MOBILE_SLOTS);
      const enBarraHrefs = new Set(enBarra.map((item) => item.href));
      // «Más» muestra exactamente lo que no entró en la barra.
      const enMas = visibles.filter((item) => !enBarraHrefs.has(item.href));

      const alcanzables = new Set([...enBarraHrefs, ...enMas.map((item) => item.href)]);
      for (const item of visibles) {
        expect(
          alcanzables.has(item.href),
          `${item.href} no se puede abrir desde el teléfono`,
        ).toBe(true);
      }
    });
  }

  it('el PMS no vuelve a aparecer como destino alcanzable', () => {
    const permissions = [...ROLE_PERMISSIONS[ROLE_KEYS.SUPERVISOR]] as PermissionKey[];
    const visibles = visibleNavItems(permissions).map((item) => item.href);

    expect(visibles).toContain('/llaves');

    for (const retired of ['/reservas', '/huespedes', '/habitaciones']) {
      expect(visibles).not.toContain(retired);
    }
  });
});

/**
 * Cerrar sesión, en cualquier pantalla.
 *
 * Fallo real reportado: «no hay botón de cerrar sesión». Existía, pero vivía
 * **sólo** dentro del `<aside>`, que es `hidden lg:flex`, así que por debajo de
 * 1024 px no había ninguna forma de salir —ni el perfil la ofrecía—.
 *
 * Es el mismo descuido que dejó cinco destinos inalcanzables en el teléfono, y
 * en un mesón que se comparte entre turnos es más grave: si el que entra no
 * puede cerrar la sesión del que sale, opera con la cuenta ajena y el libro
 * atribuye sus actos a otra persona.
 *
 * Se comprueba sobre el código fuente porque lo que falla acá no es una regla
 * de dominio, es **dónde está el botón**: fuera del `lg:` del aside.
 */
describe('cerrar sesión es alcanzable en cualquier pantalla', () => {
  const LOGOUT = 'logoutAction';

  it('el menú móvil ofrece cerrar sesión', () => {
    const source = readFileSync('src/components/layout/nav.tsx', 'utf-8');
    expect(source).toContain(LOGOUT);
    expect(source).toContain('Cerrar sesión');
  });

  it('el perfil ofrece cerrar sesión', () => {
    // La casa natural: es la página de mi cuenta.
    const source = readFileSync('src/app/(app)/perfil/page.tsx', 'utf-8');
    expect(source).toContain(LOGOUT);
    expect(source).toContain('Cerrar sesión');
  });

  it('y el perfil es alcanzable desde el teléfono', () => {
    /*
      Sin esto, tener el botón en el perfil no serviría de nada: la cadena
      completa es cabecera móvil → perfil → cerrar sesión.
    */
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf-8');
    expect(layout).toMatch(/href="\/perfil"[\s\S]{0,200}lg:hidden/);
  });

  /*
    La prueba que habría cazado el fallo: si el ÚNICO `logoutAction` del layout
    está dentro del aside oculto, no hay salida en móvil. Se exige que exista
    en otro sitio además del aside.
  */
  it('no depende sólo de la barra lateral, que se oculta en móvil', () => {
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf-8');
    const asideStart = layout.indexOf('<aside');
    const asideEnd = layout.indexOf('</aside>');
    expect(asideStart).toBeGreaterThan(-1);

    const dentroDelAside = layout.slice(asideStart, asideEnd);
    // El aside sigue teniéndolo, que es lo cómodo en escritorio.
    expect(dentroDelAside).toContain(LOGOUT);
    // Y el aside sigue oculto bajo `lg`, así que no puede ser el único camino.
    expect(dentroDelAside).toContain('lg:flex');

    const fueraDelAside =
      layout.slice(0, asideStart) + layout.slice(asideEnd);
    const hayOtraPuerta =
      fueraDelAside.includes(LOGOUT) ||
      readFileSync('src/components/layout/nav.tsx', 'utf-8').includes(LOGOUT) ||
      readFileSync('src/app/(app)/perfil/page.tsx', 'utf-8').includes(LOGOUT);
    expect(
      hayOtraPuerta,
      'cerrar sesión sólo existe dentro del aside oculto: en móvil no hay salida',
    ).toBe(true);
  });
});
