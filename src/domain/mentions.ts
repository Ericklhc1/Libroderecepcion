/**
 * Etiquetado con «@» en cualquier campo de texto del Libro.
 *
 * Dos clases, y se distinguen por lo que va después del arroba:
 *
 *   @EHerrera  → una persona. Se le notifica.
 *   @401       → una habitación. Se resuelve a habitación, reserva y huéspedes.
 *
 * La segunda es la que pidió el mesón: escribir `@401` en un comentario de
 * cierre y que el sistema traiga solo el id, la habitación y los nombres, en
 * vez de tener que ir a buscarlos y copiarlos a mano —que es donde se
 * equivocan los números—.
 *
 * Este archivo es dominio puro: reconoce y clasifica, no consulta nada. La
 * resolución contra la base vive en `@/server/services/mentions`, y así el
 * reconocimiento se puede probar sin base, que es donde están los casos
 * difíciles (correos, precios, horas).
 */

/**
 * Qué puede seguir a un arroba.
 *
 * Letras, números, punto, guión y guión bajo, hasta 40 caracteres. El límite
 * existe para que un texto sin espacios no se coma media línea como si fuera
 * un nombre de usuario.
 */
const TOKEN = /[A-Za-z0-9._-]{1,40}/;

/**
 * El arroba sólo cuenta si NO viene pegado a algo antes.
 *
 * Es lo que evita el falso positivo que importa: en `recepcion@hoteleshw.com`
 * el arroba está precedido por una letra, así que no es una mención sino un
 * correo. Los correos aparecen constantemente en las novedades —se anotan
 * casillas de huéspedes y de proveedores— y convertirlos en menciones
 * generaría avisos a usuarios inexistentes en cada registro.
 */
const MENTION = new RegExp(`(^|[^A-Za-z0-9._@-])@(${TOKEN.source})`, 'g');

/** Sólo dígitos: es un número de habitación. */
const SOLO_DIGITOS = /^\d{1,5}$/;

export type ParsedMentions = {
  /** Nombres de usuario mencionados, sin el arroba, en minúsculas. */
  usuarios: string[];
  /** Números de habitación mencionados, tal como se escribieron. */
  habitaciones: string[];
};

/**
 * Encuentra las menciones de un texto.
 *
 * Devuelve cada una una sola vez: mencionar a alguien tres veces en el mismo
 * comentario no le manda tres avisos.
 */
export function parseMentions(text: string | null | undefined): ParsedMentions {
  const usuarios = new Set<string>();
  const habitaciones = new Set<string>();
  if (!text) return { usuarios: [], habitaciones: [] };

  for (const match of text.matchAll(MENTION)) {
    const token = match[2];
    if (!token) continue;

    if (SOLO_DIGITOS.test(token)) {
      habitaciones.add(token);
      continue;
    }

    /*
      Un nombre de usuario tiene que tener alguna letra. Descarta cosas como
      `@1.500` o `@2026-09-16`, que son un monto y una fecha escritos con
      arroba por error y no una persona.
    */
    if (!/[A-Za-z]/.test(token)) continue;

    // Se limpia la puntuación final: «avísale a @EHerrera.» no es «EHerrera.».
    usuarios.add(token.replace(/[._-]+$/, '').toLowerCase());
  }

  return {
    usuarios: Array.from(usuarios),
    habitaciones: Array.from(habitaciones),
  };
}

/** ¿Hay alguna mención? Sirve para no consultar la base si no hace falta. */
export function hasMentions(text: string | null | undefined): boolean {
  const { usuarios, habitaciones } = parseMentions(text);
  return usuarios.length > 0 || habitaciones.length > 0;
}

/** Una habitación mencionada, ya resuelta contra la base. */
export type RoomMention = {
  numero: string;
  /** `null` cuando la habitación existe pero no hay nadie dentro. */
  estadia: {
    id: string;
    reserva: string;
    huespedes: string[];
  } | null;
  /** `false` cuando el número no corresponde a ninguna habitación del hotel. */
  existe: boolean;
};

/** Una persona mencionada, ya resuelta. */
export type UserMention = {
  username: string;
  id: string;
  nombre: string;
};

export type ResolvedMentions = {
  usuarios: UserMention[];
  habitaciones: RoomMention[];
};

/**
 * Cómo se lee una habitación mencionada, en una línea.
 *
 * Se arma acá y no en la pantalla para que el correo, el PDF del cierre y el
 * chat digan exactamente lo mismo. El orden es el que pidió el mesón:
 * habitación, reserva, huéspedes.
 */
export function describeRoomMention(mention: RoomMention): string {
  if (!mention.existe) return `Habitación ${mention.numero} (no existe)`;
  if (!mention.estadia) return `Habitación ${mention.numero} (vacía)`;

  const huespedes = mention.estadia.huespedes.filter(Boolean);
  const quienes = huespedes.length > 0 ? huespedes.join(', ') : 'sin nombre registrado';
  return `Habitación ${mention.numero} · reserva ${mention.estadia.reserva} · ${quienes}`;
}
