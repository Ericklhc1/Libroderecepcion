import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { detailHrefWithReturnContext, listRowAnchor, operationalListHref, safeListReturnHref } from '@/lib/list-navigation';

const page = readFileSync('src/app/(app)/novedades/habitacion/page.tsx', 'utf8');
describe('contexto de habitación y piso, sin reconstruir PMS', () => {
  it('mantiene habitación, piso y ancla al consultar un origen o tarea', () => {
    const context = operationalListHref('/novedades/habitacion', { habitacion: '512', piso: '5' }) + '#' + listRowAnchor('room', 'room-real');
    for (const href of ['/libro/origen', '/tareas/trabajo']) {
      const linked = new URL(detailHrefWithReturnContext(href, context), 'https://aroh.invalid');
      expect(linked.pathname).toBe(href);
      expect(safeListReturnHref(linked.searchParams.get('desdeLista'), '/libro')).toBe('/novedades/habitacion?habitacion=512&piso=5#registro-room-room-real');
    }
  });
  it('no amplía el retorno a rutas comerciales o información ajena', () => {
    expect(safeListReturnHref('/novedades/habitacion?habitacion=512&piso=5&reserva=privada&checkin=1', '/libro')).toBe('/novedades/habitacion?habitacion=512&piso=5');
    expect(safeListReturnHref('/habitaciones/512', '/libro')).toBe('/libro');
    expect(safeListReturnHref('/huespedes/importar', '/libro')).toBe('/libro');
  });
  it('usa los lectores originales y mantiene la autoridad del registro', () => {
    expect(page).toContain('await requirePageUser()');
    expect(page).toContain('await getRoomMonitorOverview(user)');
    expect(page).toContain('getRoomMonitorDetail(selectedTile.number,user)');
    expect(page).toContain('detailHrefWithReturnContext(`/libro/${entry.id}`, roomReturnHref)');
    expect(page).toContain('detailHrefWithReturnContext(`/tareas/${task.id}`, roomReturnHref)');
    expect(page).toContain("user.permissions.includes('cash.view')");
    expect(page).toContain('defaultRoomId={detail.room.id}');
  });
  it('el piso es un filtro de presentación y cerrar conserva el mapa filtrado', () => {
    expect(page).toContain("/^[456]$/.test(floorValue)");
    expect(page).toContain('[4, 5, 6].filter(floor => !selectedFloor || floor === selectedFloor)');
    expect(page).toContain('aria-label="Pisos del hotel"');
    expect(page).toContain('href={roomHref()}');
    expect(page).toContain('id="detalle-habitacion"');
    expect(page).toContain('AROH no deduce ocupación ni estado de estadía');
  });
});
