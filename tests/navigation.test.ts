import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, visibleNavGroups, visibleNavItems } from '@/components/layout/nav-items';
import { ROLE_PERMISSIONS, ROLE_KEYS } from '@/lib/permissions';

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

  it('responde a las cinco preguntas operativas en el grupo principal', () => {
    const primary = NAV_GROUPS[0];
    expect(primary.title).toBeNull();
    expect(primary.items.map((item) => item.href)).toEqual([
      '/', // qué ocurre ahora
      '/libro', // qué tengo pendiente
      '/habitaciones', // qué ocurre en cada habitación
      '/turno', // qué debo entregar
      '/supervision', // qué debo revisar
    ]);
  });

  it('cabe en la barra inferior móvil sin recortar destinos principales', () => {
    const mobile = NAV_GROUPS.flatMap((group) => group.items).filter((item) => item.mobile);
    // MobileNav muestra cinco: si hubiera más, alguno quedaría invisible.
    expect(mobile).toHaveLength(5);
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
  it('el Recepcionista no ve Supervisión', () => {
    const hrefs = visibleNavItems(ROLE_PERMISSIONS[ROLE_KEYS.RECEPTIONIST]).map((i) => i.href);
    expect(hrefs).not.toContain('/supervision');
    expect(hrefs).toContain('/libro');
    expect(hrefs).toContain('/habitaciones');
  });

  it('el Supervisor ve Supervisión', () => {
    const hrefs = visibleNavItems(ROLE_PERMISSIONS[ROLE_KEYS.SUPERVISOR]).map((i) => i.href);
    expect(hrefs).toContain('/supervision');
  });

  it('el Administrador de sistema queda fuera de la operación del turno', () => {
    /*
      Ve Turno porque administra la programación (`shift.manage`), pero no
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
