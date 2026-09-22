import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Inicio como ventana operativa', () => {
  const page = readFileSync('src/app/(app)/page.tsx', 'utf-8');
  const service = readFileSync('src/server/services/dashboard.ts', 'utf-8');

  it('concentra la operación en una sola bandeja priorizada', () => {
    expect(page).toContain('title="Atención ahora"');
    expect(page).toContain('data.attention');
    expect(service).toContain('buildOperationalAttention');
  });

  it('no vuelve a duplicar el Libro por clases en Inicio', () => {
    for (const retiredBlock of [
      'Pendientes críticos',
      'Tareas para mí',
      'Habitaciones que requieren acción',
      'Próximos seguimientos',
      'Últimas novedades',
      'Entregas de turno',
      'Tareas vencidas de la operación',
    ]) {
      expect(page, retiredBlock).not.toContain(retiredBlock);
    }
  });

  it('mantiene accesos accionables al detalle sin replicarlo', () => {
    expect(page).toContain('href="/libro"');
    expect(page).toContain('href="/libro?clase=task"');
    expect(page).not.toContain("'/habitaciones'");
    expect(page).toContain('href="/turno"');
  });

  it('retira consultas que sólo alimentaban bloques eliminados', () => {
    expect(service).not.toContain('latestEntries');
    expect(service).not.toContain('lastReceivedHandover');
    expect(service).not.toContain('home.operationalFeedLimit');
    expect(service).toContain('openIncidents');
    expect(service).not.toContain('listRoomsWithState');
    expect(service).not.toContain('roomStay');
  });
});
