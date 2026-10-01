import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  compactNotificationText,
  groupNotificationItems,
  notificationDeviceItems,
  notificationPresentation,
  parseFrontiNotificationSummary,
} from '@/domain/notification-summary';
import type { NotificationFeedItem } from '@/domain/notifications';
import { NotificationMessage } from '@/components/layout/notification-message';

const legacyBody = 'Área: Inventario de llaves · Prioridad: ALTA · Qué pasó: El conteo físico cmupqiokk001ajq04ny5lwbsg registró diferencias · piso 6 · el inventario esperado y lo encontrado no coinciden. Qué está mal / qué revisar: la señal cumple una regla de atención de AROH. Qué hacer: abre el origen y confirma la corrección antes de cerrar el caso.';
function keyNotice(id: string, floor: number, createdAt = '2026-10-01T15:00:00.000Z'): NotificationFeedItem {
  return { id, type: 'FRONTI_HALLAZGO', title: `Fronti · Inventario de llaves con diferencias · piso ${floor}`,
    body: legacyBody, link: `/llaves?piso=${floor}`, entity: 'FrontiProactiveSignal', entityId: id, readAt: null, createdAt };
}

describe('resúmenes operativos de notificaciones', () => {
  it('presenta el hecho y la acción en avisos históricos sin IDs ni la plantilla repetida', () => {
    const result = notificationPresentation(keyNotice('a', 6));
    expect(result.title).toBe('Inventario de llaves con diferencias · piso 6');
    expect(result.body).toBe('El conteo físico registró diferencias. Revisa las llaves y contrasta el conteo guardado.');
    expect(result.body).not.toContain('cmupqiokk');
    expect(result.body).not.toContain('abre el origen');
  });

  it('distingue faltantes y sobrantes sin sumar arqueos distintos', () => {
    const input = { type: 'FRONTI_HALLAZGO', body: 'Qué pasó: arqueo #123 · diferencia CLP -1.000. Qué hacer: abre el origen.' };
    expect(notificationPresentation({ ...input, title: 'Fronti · Arqueo #123 con diferencia CLP -1.000' }).title).toBe('Faltan CLP 1.000 · arqueo #123');
    expect(notificationPresentation({ ...input, title: 'Fronti · Arqueo #124 con diferencia USD +10' }).title).toBe('Sobran USD 10 · arqueo #124');
  });

  it('conserva las condiciones del registro y evita repetir sus metadatos', () => {
    const result = notificationPresentation({ type: 'FRONTI_HALLAZGO', title: 'Fronti · #123 · Multa por fumar',
      body: 'Área: Novedades · Prioridad: ALTA · Qué pasó: tipo NOVEDAD · prioridad ALTA · requiere seguimiento · Hab. 512: informar a la huésped antes de aplicar el cargo a la garantía. Qué está mal / qué revisar: revisar el origen. Qué hacer: abre el origen.' });
    expect(result.body).toBe('Hab. 512: informar a la huésped antes de aplicar el cargo a la garantía.');
  });

  it('descarta las inferencias históricas sin evidencia', () => {
    const result = notificationPresentation({ type: 'FRONTI_HALLAZGO', title: 'Fronti · Novedad requiere seguimiento: PRENDA OLVIDADA EN 606',
      body: 'Área: Alertas operativas · Evidencia: El registro sigue abierto. · Lectura de Fronti: verificar el equipo 606 y el objeto crítico.' });
    expect(result.body).not.toMatch(/equipo|crítico/);
    expect(result.title).toBe('PRENDA OLVIDADA EN 606');
  });

  it('expresa el vencimiento histórico en la zona del hotel', () => {
    const result = notificationPresentation({ type: 'FRONTI_HALLAZGO', title: 'Fronti · Tarea #123 vencida · Revisar registro',
      body: 'Qué pasó: tarea #123 · fecha límite 2026-09-30T15:30:00.000Z · responsable Persona asignada · la fecha límite ya pasó. Qué hacer: abre el origen.' });
    expect(result.body).toContain('12:30');
    expect(result.body).toContain('Persona asignada');
    expect(result.body).not.toContain('T15:30');
  });

  it('admite un resumen del modelo que conserva la condición y rechaza respuestas no sustentadas', () => {
    const evidence = 'Hab. 512: multa pendiente. Informar a la huésped antes de aplicar el cargo.';
    const summary = 'Informar a la huésped de la habitación 512 antes de aplicar el cargo por fumar.';
    expect(parseFrontiNotificationSummary(JSON.stringify({ summary }), evidence)).toBe(summary);
    for (const invalid of ['Revisar equipo 512.', 'Cobrar 50.000 CLP.', 'Aplicar el cargo a la habitación 512.', 'Qué pasó: multa pendiente.', 'x'.repeat(241)]) {
      expect(parseFrontiNotificationSummary(JSON.stringify({ summary: invalid }), evidence)).toBeNull();
    }
    expect(parseFrontiNotificationSummary('respuesta sin JSON', evidence)).toBeNull();
    expect(parseFrontiNotificationSummary(JSON.stringify({ summary: 'Esperar al huésped.' }), 'Llega a las 15:00hrs; si no llega antes de 16:00hrs, revisar la reserva.')).toBeNull();
  });

  it('agrupa avisos de llaves por día sin alterar identidades, lectura ni otras notificaciones', () => {
    const a = keyNotice('a', 6);
    const b = { ...keyNotice('b', 5), readAt: '2026-10-01T15:00:00.000Z' };
    const other = { ...keyNotice('c', 4), type: 'ACCION_REQUERIDA' };
    const nextDay = keyNotice('d', 6, '2026-10-02T15:00:00.000Z');
    const groups = groupNotificationItems([a, other, b, nextDay]);
    expect(groups).toHaveLength(3);
    expect(groups[0]!.title).toBe('Llaves · 2 avisos de diferencias');
    expect(groups[0]!.body).toContain('Pisos 5 y 6.');
    expect(groups[0]!.items).toEqual([a, b]);
    expect(groups[1]!.items).toEqual([other]);
    expect(groups[2]!.title).toBeNull();
    expect(a.readAt).toBeNull();
    expect(b.readAt).not.toBeNull();
  });

  it('agrupa el push y conserva el ID del aviso más reciente', () => {
    const result = notificationDeviceItems([keyNotice('a', 6), keyNotice('b', 5, '2026-10-01T15:01:00.000Z')]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('b');
    expect(result[0]!.title).toBe('Llaves · 2 avisos de diferencias');
    expect(result[0]!.link).toBe('/llaves?piso=todos');
    expect(notificationDeviceItems([])).toEqual([]);
  });

  it('mantiene el texto original detrás de un detalle accesible', () => {
    const html = renderToStaticMarkup(createElement(NotificationMessage, { notification: keyNotice('a', 6) }));
    const preview = html.split('<details')[0]!;
    expect(preview).toContain('El conteo físico registró diferencias.');
    expect(preview).not.toContain('cmupqiokk');
    expect(html).toContain('<summary');
    expect(html).toContain('Ver detalle');
    expect(html).toContain('cmupqiokk');
  });

  it('acota textos largos en el límite de una palabra', () => {
    const result = compactNotificationText('palabra '.repeat(100));
    expect(result.length).toBeLessThanOrEqual(240);
    expect(result).toMatch(/palabra…$/);
  });
});
