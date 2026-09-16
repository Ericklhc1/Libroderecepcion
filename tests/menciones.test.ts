import { describe, expect, it } from 'vitest';
import { describeRoomMention, hasMentions, parseMentions } from '@/domain/mentions';

/**
 * Reconocimiento de menciones, sin base de datos.
 *
 * Acá viven los casos difíciles, y no son los obvios: son los textos
 * operativos reales donde aparece un arroba que NO es una mención. Un correo
 * de huésped, un precio, una hora. Si el sistema los tomara por menciones,
 * cada novedad generaría avisos a usuarios inexistentes.
 */
describe('reconocer menciones', () => {
  it('reconoce a una persona', () => {
    expect(parseMentions('Avísale a @EHerrera').usuarios).toEqual(['eherrera']);
  });

  it('reconoce una habitación', () => {
    expect(parseMentions('Revisar @401').habitaciones).toEqual(['401']);
  });

  it('reconoce las dos clases en el mismo texto', () => {
    const r = parseMentions('@EHerrera revisa @401 y @404 antes del cierre');
    expect(r.usuarios).toEqual(['eherrera']);
    expect(r.habitaciones).toEqual(['401', '404']);
  });

  /*
    EL caso que importa. En las novedades se anotan casillas de huéspedes y de
    proveedores todo el tiempo, y `recepcion@hoteleshw.com` tiene un arroba en
    medio. Sin esta regla, cada correo anotado intentaría notificar a un
    usuario llamado «hoteleshw.com».
  */
  it('un correo NO es una mención', () => {
    const r = parseMentions('Escribir a recepcion@hoteleshw.com por la factura');
    expect(r.usuarios).toEqual([]);
    expect(r.habitaciones).toEqual([]);
  });

  it('varios correos seguidos tampoco', () => {
    const r = parseMentions('cc: a@b.cl, juan.perez@gmail.com y ventas@proveedor.cl');
    expect(r.usuarios).toEqual([]);
  });

  it('un monto o una fecha con arroba no son personas', () => {
    // Pasa al escribir rápido: «@1.500» por «$1.500».
    expect(parseMentions('cobrar @1.500 de garantía').usuarios).toEqual([]);
    expect(parseMentions('vence @2026-09-16').usuarios).toEqual([]);
  });

  it('no repite una mención nombrada dos veces', () => {
    // Mencionar a alguien tres veces no son tres avisos.
    const r = parseMentions('@EHerrera y de nuevo @eherrera, y @EHERRERA');
    expect(r.usuarios).toEqual(['eherrera']);
  });

  it('la puntuación final no forma parte del usuario', () => {
    expect(parseMentions('Pregúntale a @EHerrera.').usuarios).toEqual(['eherrera']);
    expect(parseMentions('¿Fue @EHerrera?').usuarios).toEqual(['eherrera']);
  });

  it('funciona al principio del texto y tras un salto de línea', () => {
    expect(parseMentions('@EHerrera al inicio').usuarios).toEqual(['eherrera']);
    expect(parseMentions('Nota:\n@401 sin toallas').habitaciones).toEqual(['401']);
  });

  it('el arroba solo, sin nada detrás, no es nada', () => {
    expect(parseMentions('el correo lleva @ en medio').usuarios).toEqual([]);
    expect(hasMentions('@')).toBe(false);
  });

  it('un texto sin menciones no obliga a consultar la base', () => {
    // `hasMentions` existe justo para poder saltarse la consulta.
    expect(hasMentions('Todo normal en el turno')).toBe(false);
    expect(hasMentions(null)).toBe(false);
    expect(hasMentions('Revisar @401')).toBe(true);
  });

  it('no se come media línea si no hay espacios', () => {
    const largo = 'a'.repeat(120);
    expect(parseMentions(`@${largo}`).usuarios[0]?.length).toBeLessThanOrEqual(40);
  });
});

/**
 * Cómo se lee una habitación mencionada.
 *
 * El texto se arma en el dominio para que el chat, el correo y el PDF del
 * cierre digan lo MISMO. El orden es el que pidió el mesón: habitación,
 * reserva, huéspedes.
 */
describe('describir una habitación mencionada', () => {
  it('trae habitación, reserva y huéspedes', () => {
    const texto = describeRoomMention({
      numero: '401',
      existe: true,
      estadia: { id: 'x', reserva: 'RSV-1234', huespedes: ['Ana Soto', 'Luis Díaz'] },
    });
    expect(texto).toBe('Habitación 401 · reserva RSV-1234 · Ana Soto, Luis Díaz');
  });

  it('dice que está vacía en vez de inventar un huésped', () => {
    expect(describeRoomMention({ numero: '401', existe: true, estadia: null })).toBe(
      'Habitación 401 (vacía)',
    );
  });

  it('dice que no existe cuando el número está mal escrito', () => {
    // Pasa: se escribe @410 por @401 y hay que notarlo, no fallar en silencio.
    expect(describeRoomMention({ numero: '999', existe: false, estadia: null })).toBe(
      'Habitación 999 (no existe)',
    );
  });

  it('con estadía pero sin nombres, lo dice', () => {
    const texto = describeRoomMention({
      numero: '404',
      existe: true,
      estadia: { id: 'x', reserva: 'RSV-9', huespedes: [] },
    });
    expect(texto).toContain('sin nombre registrado');
    expect(texto).toContain('RSV-9');
  });
});
