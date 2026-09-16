import 'server-only';
import { RoomStayStage, RoomStayStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  parseMentions,
  type ResolvedMentions,
  type RoomMention,
  type UserMention,
} from '@/domain/mentions';

/**
 * Resuelve las menciones de un texto contra la base.
 *
 * El reconocimiento vive en `@/domain/mentions` y no consulta nada; acá se
 * traduce lo reconocido a personas y estadías reales. La división importa
 * porque los casos difíciles del reconocimiento —correos, montos, fechas— se
 * prueban sin base, y lo que se prueba con base es sólo la traducción.
 */

/**
 * Estadías que cuentan como «hay alguien en la habitación».
 *
 * Las mismas que usa el pase de gimnasio, y a propósito: si `@401` dijera que
 * hay huéspedes donde el resto del sistema dice que no, el mesón tendría dos
 * verdades sobre la misma habitación. IN_HOUSE y CHECK_OUT con la salida sin
 * confirmar son las dos situaciones en que el huésped sigue dentro.
 */
const ESTADIAS_CON_HUESPED = [RoomStayStatus.IN_HOUSE, RoomStayStatus.CHECK_OUT];
const ETAPAS_ACTIVAS = [RoomStayStage.PENDIENTE, RoomStayStage.CONFIRMADO];

export async function resolveMentions(
  text: string | null | undefined,
): Promise<ResolvedMentions> {
  const { usuarios, habitaciones } = parseMentions(text);
  if (usuarios.length === 0 && habitaciones.length === 0) {
    return { usuarios: [], habitaciones: [] };
  }

  const [cuentas, piezas] = await Promise.all([
    usuarios.length > 0
      ? prisma.user.findMany({
          /*
            Se comparan en minúsculas porque nadie escribe el usuario con las
            mayúsculas exactas al mencionarlo: `@eherrera` y `@EHerrera` son la
            misma persona. Sólo cuentas activas y no eliminadas: mencionar a
            alguien que se fue del hotel no debe generarle un aviso que nadie
            va a leer.
          */
          where: {
            active: true,
            deletedAt: null,
            username: { in: usuarios, mode: 'insensitive' },
          },
          select: { id: true, name: true, username: true },
        })
      : Promise.resolve([]),
    habitaciones.length > 0
      ? prisma.room.findMany({
          where: { number: { in: habitaciones } },
          select: {
            number: true,
            stays: {
              where: {
                deletedAt: null,
                status: { in: ESTADIAS_CON_HUESPED },
                stage: { in: ETAPAS_ACTIVAS },
              },
              select: {
                id: true,
                status: true,
                reservationId: true,
                guestNames: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);

  const porNumero = new Map(piezas.map((room) => [room.number, room]));

  const usuariosResueltos: UserMention[] = cuentas.map((cuenta) => ({
    username: cuenta.username,
    id: cuenta.id,
    nombre: cuenta.name,
  }));

  const habitacionesResueltas: RoomMention[] = habitaciones.map((numero) => {
    const room = porNumero.get(numero);
    if (!room) return { numero, existe: false, estadia: null };

    /*
      Puede haber más de una estadía activa en una habitación durante el
      relevo: la que sale y la que entra. Se prefiere IN_HOUSE, que es quien
      está dentro AHORA. El mismo orden de preferencia que usa el pase de
      gimnasio, para que las dos pantallas nombren al mismo huésped.
    */
    const estadia =
      room.stays.find((s) => s.status === RoomStayStatus.IN_HOUSE) ??
      room.stays[0] ??
      null;

    return {
      numero,
      existe: true,
      estadia: estadia
        ? {
            id: estadia.id,
            reserva: estadia.reservationId,
            huespedes: estadia.guestNames.filter((n) => n.trim().length > 0),
          }
        : null,
    };
  });

  return { usuarios: usuariosResueltos, habitaciones: habitacionesResueltas };
}

/**
 * A quién hay que avisarle por una mención.
 *
 * Se excluye a quien escribe: mencionarse a sí mismo no genera aviso, y pasa
 * más de lo que parece al citarse en un cierre de turno.
 */
export async function mentionRecipients(
  text: string | null | undefined,
  authorId: string,
): Promise<UserMention[]> {
  const { usuarios } = await resolveMentions(text);
  return usuarios.filter((u) => u.id !== authorId);
}
