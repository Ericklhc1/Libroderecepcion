import { NotificationType } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  resetRoomsAndKeys,
  seedCatalog,
} from './helpers';
import { addComment, listCommentThreads } from '@/server/services/comments';
import { resolveMentions } from '@/server/services/mentions';
import type { CurrentUser } from '@/server/auth/current-user';

let autor: CurrentUser;
let mencionado: CurrentUser & { username: string };
let entryId: string;
let roomId: string;

async function crearRegistro(ownerId: string) {
  const entry = await prisma.operationalEntry.create({
    data: {
      type: 'NOVEDAD',
      status: 'ABIERTO',
      title: 'Novedad con hilo',
      description: 'Base para probar hilos y menciones.',
      priority: 'MEDIA',
      occurredAt: new Date(),
      createdById: ownerId,
      ownerId,
      roomId,
      tags: [],
      requiresFollowUp: false,
    },
    select: { id: true },
  });
  return entry.id;
}

beforeAll(async () => {
  await resetOperationalData();
  await resetRoomsAndKeys();
  await seedCatalog();
  const room = await prisma.room.findFirstOrThrow({ select: { id: true, number: true } });
  roomId = room.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetOperationalData();
  autor = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST, name: 'Quien escribe' });
  mencionado = await createUser({
    roleKey: ROLE_KEYS.SUPERVISOR,
    name: 'Elena Herrera',
    username: 'EHerrera',
  });
  entryId = await crearRegistro(autor.id);
});

describe('hilos de conversación', () => {
  it('una respuesta cuelga de su comentario, no de la lista', async () => {
    const raiz = await addComment(autor, { entryId, body: 'La ducha pierde agua.' });
    await addComment(mencionado, {
      entryId,
      body: 'Ya avisé a mantención.',
      parentId: raiz.id,
    });

    const hilos = await listCommentThreads({ entryId });
    expect(hilos).toHaveLength(1);
    expect(hilos[0]!.replies).toHaveLength(1);
    expect(hilos[0]!.replies[0]!.body).toBe('Ya avisé a mantención.');
  });

  /*
    Un solo nivel, a propósito. Responder a una respuesta aplana el hilo hacia
    el comentario raíz: es lo que hace legible una novedad larga. Los hilos de
    hilos convierten el mesón en un foro.
  */
  it('responder a una respuesta aplana al hilo raíz', async () => {
    const raiz = await addComment(autor, { entryId, body: 'Raíz' });
    const respuesta = await addComment(mencionado, {
      entryId,
      body: 'Primera respuesta',
      parentId: raiz.id,
    });
    const anidada = await addComment(autor, {
      entryId,
      body: 'Respuesta a la respuesta',
      parentId: respuesta.id,
    });

    expect(anidada.parentId).toBe(raiz.id);

    const hilos = await listCommentThreads({ entryId });
    expect(hilos).toHaveLength(1);
    expect(hilos[0]!.replies).toHaveLength(2);
  });

  /*
    Sin esta comprobación, una respuesta podía colgar de un comentario de OTRA
    novedad y el hilo aparecería en dos fichas a la vez.
  */
  it('no se puede responder a un comentario de otro registro', async () => {
    const otro = await crearRegistro(autor.id);
    const ajeno = await addComment(autor, { entryId: otro, body: 'De otra novedad' });

    await expect(
      addComment(autor, { entryId, body: 'Colgada donde no va', parentId: ajeno.id }),
    ).rejects.toThrow(/otro registro/i);
  });

  it('eliminar el comentario raíz se lleva sus respuestas', async () => {
    const raiz = await addComment(autor, { entryId, body: 'Raíz' });
    await addComment(mencionado, { entryId, body: 'Respuesta', parentId: raiz.id });

    // Cascada en la base: una respuesta sin su comentario no significa nada.
    await prisma.comment.delete({ where: { id: raiz.id } });
    expect(await prisma.comment.count({ where: { entryId } })).toBe(0);
  });
});

describe('menciones resueltas contra la base', () => {
  it('@usuario encuentra a la persona por su usuario, sin importar mayúsculas', async () => {
    const r = await resolveMentions('Confirma con @eherrera antes del cierre');
    expect(r.usuarios).toHaveLength(1);
    expect(r.usuarios[0]!.id).toBe(mencionado.id);
    expect(r.usuarios[0]!.nombre).toBe('Elena Herrera');
  });

  it('una cuenta desactivada no se menciona', async () => {
    // Mencionar a quien ya no trabaja acá generaría un aviso que nadie lee.
    await prisma.user.update({ where: { id: mencionado.id }, data: { active: false } });
    const r = await resolveMentions('@EHerrera ¿lo viste?');
    expect(r.usuarios).toEqual([]);
  });

  it('@habitación trae el id, la reserva y los nombres de los huéspedes', async () => {
    const room = await prisma.room.findUniqueOrThrow({
      where: { id: roomId },
      select: { number: true },
    });
    const batch = await prisma.pmsImportBatch.create({
      data: {
        createdById: autor.id,
        businessDate: new Date(),
        /*
          El lote NO lleva `sourceReport` —eso es de la estadía— y sí lleva
          los tres Json obligatorios: metadatos por informe, estadías
          normalizadas y recuentos.
        */
        reports: [],
        payload: [],
        summary: {},
      },
      select: { id: true },
    });
    await prisma.roomStay.create({
      data: {
        room: { connect: { id: roomId } },
        batch: { connect: { id: batch.id } },
        sourceReport: 'IN_HOUSE',
        businessDate: new Date(),
        status: 'IN_HOUSE',
        stage: 'CONFIRMADO',
        reservationId: 'RSV-4417',
        guestNames: ['Ana Soto', 'Luis Díaz'],
      },
    });

    const r = await resolveMentions(`Revisar @${room.number}`);
    expect(r.habitaciones).toHaveLength(1);
    const pieza = r.habitaciones[0]!;
    expect(pieza.existe).toBe(true);
    expect(pieza.estadia?.reserva).toBe('RSV-4417');
    expect(pieza.estadia?.huespedes).toEqual(['Ana Soto', 'Luis Díaz']);
  });

  it('una habitación vacía lo dice, en vez de inventar un huésped', async () => {
    const room = await prisma.room.findUniqueOrThrow({
      where: { id: roomId },
      select: { number: true },
    });
    const r = await resolveMentions(`Revisar @${room.number}`);
    expect(r.habitaciones[0]!.existe).toBe(true);
    expect(r.habitaciones[0]!.estadia).toBeNull();
  });

  it('un número que no es habitación se marca como inexistente', async () => {
    // Se escribe @410 por @401 y hay que notarlo, no fallar en silencio.
    const r = await resolveMentions('Revisar @99999');
    expect(r.habitaciones[0]).toEqual({ numero: '99999', existe: false, estadia: null });
  });

  it('un correo en el texto no menciona a nadie', async () => {
    const r = await resolveMentions('Escribir a recepcion@hoteleshw.com');
    expect(r.usuarios).toEqual([]);
    expect(r.habitaciones).toEqual([]);
  });
});

describe('avisos de una mención', () => {
  it('a quien se menciona le llega un aviso de MENCION, no de comentario', async () => {
    await addComment(autor, { entryId, body: 'Ojo @EHerrera con la 401' });

    const avisos = await prisma.notification.findMany({
      where: { userId: mencionado.id },
      select: { type: true, title: true },
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.type).toBe(NotificationType.MENCION);
    expect(avisos[0]!.title).toContain('te mencionó');
  });

  /*
    La mención manda sobre el aviso de comentario: si el responsable del
    registro además fue mencionado, recibe UN aviso, el específico, no dos por
    el mismo comentario.
  */
  it('no llegan dos avisos por el mismo comentario', async () => {
    const registroDeElena = await crearRegistro(mencionado.id);
    await addComment(autor, { entryId: registroDeElena, body: '@EHerrera revisa esto' });

    const avisos = await prisma.notification.findMany({
      where: { userId: mencionado.id },
      select: { type: true },
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.type).toBe(NotificationType.MENCION);
  });

  it('mencionarse a sí mismo no genera aviso', async () => {
    // Pasa al citarse en un cierre de turno.
    const propio = await createUser({
      roleKey: ROLE_KEYS.RECEPTIONIST,
      name: 'Solo',
      username: 'Solitario',
    });
    const suyo = await crearRegistro(propio.id);
    await addComment(propio, { entryId: suyo, body: 'Yo, @Solitario, lo revisé' });

    expect(await prisma.notification.count({ where: { userId: propio.id } })).toBe(0);
  });
});
