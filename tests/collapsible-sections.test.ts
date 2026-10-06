import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const read=(path:string)=>readFileSync(path,'utf8');

describe('secciones desplegables del sistema',()=>{
  it('usa un patrón nativo accesible y sin overlay global',()=>{
    const source=read('src/components/ui/card.tsx');
    expect(source).toContain('export function DisclosureCard');
    expect(source).toContain('<details');
    expect(source).toContain('data-disclosure-summary');
    expect(source).toContain('<summary');
    expect(source).toContain('group-open:rotate-180');
    expect(source).not.toContain("'use client'");
  });

  it('cubre las pantallas con mayor densidad vertical',()=>{
    const pages=[
      'src/app/(app)/admin/page.tsx',
      'src/app/(app)/admin/fronti/page.tsx',
      'src/app/(app)/admin/diagnostico/page.tsx',
      'src/app/(app)/admin/parametros/page.tsx',
      'src/app/(app)/admin/correo/page.tsx',
      'src/app/(app)/admin/usuarios/page.tsx',
      'src/app/(app)/admin/areas/page.tsx',
      'src/app/(app)/admin/roles/page.tsx',
      'src/app/(app)/admin/turnos/page.tsx',
      'src/app/(app)/admin/auditoria/page.tsx',
      'src/app/(app)/admin/eliminados/page.tsx',
      'src/app/(app)/admin/puesta-en-cero/page.tsx',
      'src/app/(app)/gerencia/page.tsx',
      'src/app/(app)/supervision/page.tsx',
      'src/app/(app)/equipo/page.tsx',
      'src/app/(app)/coordinacion/page.tsx',
      'src/app/(app)/coordinacion/indicadores/page.tsx',
      'src/app/(app)/fronti/procedimientos/page.tsx',
      'src/app/(app)/indicadores/page.tsx',
      'src/app/(app)/supervision/salud/page.tsx',
      'src/app/(app)/coordinacion/automatizaciones/page.tsx',
    ];
    for(const page of pages)expect(read(page),page).toContain('DisclosureCard');
  });

  it('conserva impresión, enlaces dirigidos, filtros solicitados y conteos visibles',()=>{
    const card=read('src/components/ui/card.tsx');
    const css=read('src/app/globals.css');
    const supervision=read('src/app/(app)/supervision/page.tsx');
    const fronti=read('src/app/(app)/fronti/procedimientos/page.tsx');
    const diagnostics=read('src/app/(app)/admin/diagnostico/page.tsx');
    expect(card).toContain('data-disclosure-card');
    expect(css).toContain('details[data-disclosure-card] > :not(summary)');
    expect(supervision).toContain("sectionHref('pendientes')");
    expect(supervision).toContain("defaultOpen={requestedSection === 'seguimientos'}");
    expect(supervision).toContain("defaultOpen={requestedSection === 'senales'||!!exception}");
    expect(fronti).toContain("defaultOpen={delegaciones === '1'}");
    expect(diagnostics).toContain('count={visibleDuplicateAlerts.length}');
    expect(diagnostics).toContain('count={visibleMismatches.length}');
    expect(diagnostics).toContain('count={visibleDuplicateStays.length}');
    expect(diagnostics).toContain('count={visibleRuntimeErrors.length}');
  });

  it('agrupa Administración y no vuelve a cargar todos los accesos como una lista abierta',()=>{
    const source=read('src/app/(app)/admin/page.tsx');
    expect(source).toContain('ADMIN_GROUPS');
    expect(source).toContain("title: 'Departamentos'");
    expect(source).toContain("title: 'Personas y acceso'");
    expect(source).toContain("title: 'Reglas de trabajo'");
    expect(source).toContain("title: 'Estado operativo'");
    expect(source).not.toContain('className="grid gap-3 sm:grid-cols-2">\n        {allowed.map');
  });
});
