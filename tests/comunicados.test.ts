import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnnouncementScope } from '@prisma/client';
import {
  ROLE_KEYS,
  createUser,
  prisma,
  resetOperationalData,
  seedCatalog,
} from './helpers';
import {
  closeAnnouncement,
  confirmAnnouncement,
  createAnnouncement,
  getBlockingAnnouncements,
  listAnnouncements,
} from '@/server/services/announcements';
import { NotFoundError, RuleError } from '@/server/errors';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import type { CurrentUser } from '@/server/auth/current-user';

/**
 * Comunicados obligatorios.
 *
 * Lo que estas pruebas protegen no es que el aviso se muestre, sino que NO se
 * pueda esquivar: que bloquee a quien debe, que deje de bloquear sólo cuando
 * hay confirmación escrita, y que quien lo emite no se bloquee a sí mismo.
 */
describe('comunicados obligatorios', () => {
  let supervisor: CurrentUser & { username: string };
  let recepcion: CurrentUser & { username: string };
  let otro: CurrentUser & { username: string };

  beforeAll(async () => {
    await seedCatalog();
  });

  beforeEach(async () => {
    await resetOperationalData();
    supervisor = await createUser({ roleKey: ROLE_KEYS.SUPERVISOR });
    recepcion = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
    otro = await createUser({ roleKey: ROLE_KEYS.RECEPTIONIST });
  });

  it('el permiso de emitir lo tienen el administrador y el supervisor', () => {
    const conPermiso = Object.entries(ROLE_PERMISSIONS)
      .filter(([, p]) => (p as readonly string[]).includes('announcement.manage'))
      .map(([role]) => role)
      .sort();
    expect(conPermiso).toEqual([ROLE_KEYS.SYSTEM_ADMIN, ROLE_KEYS.SUPERVISOR].sort());
  });

  it('un comunicado para todos bloquea a todo el personal', async () => {
    await createAnnouncement(supervisor, {
      title: 'Corte de agua en el piso 5',
      body: 'No asignar habitaciones del piso 5 hasta nuevo aviso.',
      scope: AnnouncementScope.TODOS,
    });

    for (const persona of [recepcion, otro]) {
      const pendientes = await getBlockingAnnouncements(persona.id);
      expect(pendientes).toHaveLength(1);
      expect(pendientes[0]?.title).toBe('Corte de agua en el piso 5');
      expect(pendientes[0]?.personal).toBe(false);
    }
  });

  it('quien lo emite NO se bloquea a sí mismo', async () => {
    /*
      Si se bloqueara, el Supervisor no podría ni corregir su propio aviso.
      Por eso `createAnnouncement` escribe su confirmación de entrada.
    */
    await createAnnouncement(supervisor, {
      title: 'Aviso',
      body: 'Contenido suficiente para pasar la validación.',
      scope: AnnouncementScope.TODOS,
    });
    expect(await getBlockingAnnouncements(supervisor.id)).toHaveLength(0);
  });

  it('un comunicado dirigido a una persona no bloquea a las demás', async () => {
    await createAnnouncement(supervisor, {
      title: 'Revisa tu arqueo de ayer',
      body: 'Faltan 5.000 pesos en el cierre del turno de tarde.',
      scope: AnnouncementScope.USUARIO,
      targetUserId: recepcion.id,
    });

    const suyos = await getBlockingAnnouncements(recepcion.id);
    expect(suyos).toHaveLength(1);
    expect(suyos[0]?.personal).toBe(true);

    expect(await getBlockingAnnouncements(otro.id)).toHaveLength(0);
  });

  it('confirmar con texto lo deja de bloquear, y sólo a quien confirmó', async () => {
    await createAnnouncement(supervisor, {
      title: 'Aviso',
      body: 'Contenido suficiente para pasar la validación.',
      scope: AnnouncementScope.TODOS,
    });

    const [pendiente] = await getBlockingAnnouncements(recepcion.id);
    await confirmAnnouncement(recepcion, {
      announcementId: pendiente!.id,
      text: 'Entendido: no asigno el piso 5.',
    });

    expect(await getBlockingAnnouncements(recepcion.id)).toHaveLength(0);
    // El otro sigue bloqueado: la confirmación es personal.
    expect(await getBlockingAnnouncements(otro.id)).toHaveLength(1);
  });

  it('una confirmación vacía o de dos letras no vale', async () => {
    await createAnnouncement(supervisor, {
      title: 'Aviso',
      body: 'Contenido suficiente para pasar la validación.',
      scope: AnnouncementScope.TODOS,
    });
    const [pendiente] = await getBlockingAnnouncements(recepcion.id);

    for (const texto of ['', '   ', 'ok']) {
      await expect(
        confirmAnnouncement(recepcion, { announcementId: pendiente!.id, text: texto }),
        `aceptó «${texto}»`,
      ).rejects.toBeInstanceOf(RuleError);
    }
    // Y sigue bloqueando.
    expect(await getBlockingAnnouncements(recepcion.id)).toHaveLength(1);
  });

  it('el texto de la confirmación se guarda y se puede leer', async () => {
    const creado = await createAnnouncement(supervisor, {
      title: 'Aviso',
      body: 'Contenido suficiente para pasar la validación.',
      scope: AnnouncementScope.TODOS,
    });
    await confirmAnnouncement(recepcion, {
      announcementId: creado.id,
      text: 'Leído. Aviso a housekeeping.',
    });

    const [listado] = await listAnnouncements();
    const suya = listado?.reads.find((read) => read.name === recepcion.name);
    expect(suya?.text).toBe('Leído. Aviso a housekeeping.');
  });

  it('confirmar dos veces no duplica ni pisa la primera confirmación', async () => {
    const creado = await createAnnouncement(supervisor, {
      title: 'Aviso',
      body: 'Contenido suficiente para pasar la validación.',
      scope: AnnouncementScope.TODOS,
    });

    await confirmAnnouncement(recepcion, { announcementId: creado.id, text: 'Primera.' });
    await confirmAnnouncement(recepcion, { announcementId: creado.id, text: 'Segunda.' });

    const filas = await prisma.announcementRead.findMany({
      where: { announcementId: creado.id, userId: recepcion.id },
    });
    expect(filas).toHaveLength(1);
    // La primera es la que ocurrió, así que es la que vale.
    expect(filas[0]?.confirmationText).toBe('Primera.');
  });

  it('nadie confirma un comunicado que no le tocaba', async () => {
    const creado = await createAnnouncement(supervisor, {
      title: 'Personal',
      body: 'Contenido suficiente para pasar la validación.',
      scope: AnnouncementScope.USUARIO,
      targetUserId: recepcion.id,
    });

    await expect(
      confirmAnnouncement(otro, { announcementId: creado.id, text: 'Me entero por casualidad.' }),
    ).rejects.toThrow(/no está dirigido a ti/);
  });

  it('un comunicado retirado deja de bloquear y conserva las confirmaciones', async () => {
    const creado = await createAnnouncement(supervisor, {
      title: 'Aviso',
      body: 'Contenido suficiente para pasar la validación.',
      scope: AnnouncementScope.TODOS,
    });
    await confirmAnnouncement(recepcion, { announcementId: creado.id, text: 'Confirmado.' });

    await closeAnnouncement(supervisor, {
      announcementId: creado.id,
      reason: 'Se resolvió el corte de agua.',
    });

    expect(await getBlockingAnnouncements(otro.id)).toHaveLength(0);
    expect(
      await prisma.announcementRead.count({ where: { announcementId: creado.id } }),
    ).toBeGreaterThan(0);
  });

  it('un comunicado caducado no bloquea', async () => {
    const creado = await createAnnouncement(supervisor, {
      title: 'Aviso corto',
      body: 'Contenido suficiente para pasar la validación.',
      scope: AnnouncementScope.TODOS,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await getBlockingAnnouncements(otro.id)).toHaveLength(1);

    // Se mueve la caducidad al pasado, como si hubiera transcurrido el tiempo.
    await prisma.announcement.update({
      where: { id: creado.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(await getBlockingAnnouncements(otro.id)).toHaveLength(0);
  });

  it('rechaza un comunicado mal formado en vez de emitirlo a medias', async () => {
    const base = {
      title: 'Aviso',
      body: 'Contenido suficiente para pasar la validación.',
    };

    // Dirigido a una persona sin decir a quién.
    await expect(
      createAnnouncement(supervisor, { ...base, scope: AnnouncementScope.USUARIO }),
    ).rejects.toThrow(/necesita a quién/);

    // Para todos, pero con destinatario.
    await expect(
      createAnnouncement(supervisor, {
        ...base,
        scope: AnnouncementScope.TODOS,
        targetUserId: recepcion.id,
      }),
    ).rejects.toThrow(/no puede tener destinatario/);

    // Dirigido a alguien que no existe.
    await expect(
      createAnnouncement(supervisor, {
        ...base,
        scope: AnnouncementScope.USUARIO,
        targetUserId: 'no-existe',
      }),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Caducidad ya pasada: no bloquearía a nadie.
    await expect(
      createAnnouncement(supervisor, {
        ...base,
        scope: AnnouncementScope.TODOS,
        expiresAt: new Date(Date.now() - 60_000),
      }),
    ).rejects.toThrow(/ya pasó/);

    expect(await prisma.announcement.count()).toBe(0);
  });

  it('lo personal se muestra antes que lo general', async () => {
    await createAnnouncement(supervisor, {
      title: 'Para todos',
      body: 'Contenido suficiente para pasar la validación.',
      scope: AnnouncementScope.TODOS,
    });
    await createAnnouncement(supervisor, {
      title: 'Para ti',
      body: 'Contenido suficiente para pasar la validación.',
      scope: AnnouncementScope.USUARIO,
      targetUserId: recepcion.id,
    });

    const pendientes = await getBlockingAnnouncements(recepcion.id);
    expect(pendientes).toHaveLength(2);
    // Lo que se le dijo a él, no al mesón entero, va primero.
    expect(pendientes[0]?.title).toBe('Para ti');
  });

  it('el avance de lectura cuenta al personal operativo, no al administrador', async () => {
    await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN });
    await createAnnouncement(supervisor, {
      title: 'Aviso',
      body: 'Contenido suficiente para pasar la validación.',
      scope: AnnouncementScope.TODOS,
    });

    const [listado] = await listAnnouncements();
    /*
      El Administrador de sistema no opera el mesón, así que no debería
      contarse como moroso de un comunicado operativo. Quedan el supervisor y
      los dos recepcionistas.
      */
    expect(listado?.expected).toBe(3);
  });
});
