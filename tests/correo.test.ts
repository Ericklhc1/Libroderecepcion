import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  canSend,
  extractAddress,
  mailConfigProblems,
  mailConfigWarnings,
  smtpIsImplicitTls,
} from '@/domain/mail-config';
import { openSecret, sealSecret } from '@/lib/secret-box';
import {
  getMailConfigView,
  saveMailConfig,
  sendMailTest,
} from '@/server/services/mail-settings';
import { isMailConfigured, resolveMailConfig, credentialsRecipient } from '@/server/mail';
import { ROLE_KEYS } from '@/lib/permissions';
import { prisma, createUser, resetOperationalData, seedCatalog } from './helpers';

/**
 * Configuración del correo desde la consola.
 *
 * Lo que estas pruebas protegen, en orden de importancia:
 *
 * 1. **La clave nunca sale en claro.** Ni de la base, ni hacia el navegador,
 *    ni en la auditoría. Es la razón por la que la pantalla puede existir sin
 *    romper la regla de que los secretos viven en el entorno.
 * 2. **Guardar el puerto no borra la clave.** Es el gesto más común —corregir
 *    un dato— y si borrara la clave, el correo se caería en silencio.
 * 3. **El par protocolo/puerto se avisa pero no se bloquea.** El aviso de
 *    «IMAP + 995» es un error real de las credenciales que entregó el hotel.
 */

describe('reglas de configuración de correo (dominio puro)', () => {
  it('el puerto decide el cifrado, no una casilla aparte', () => {
    expect(smtpIsImplicitTls(465)).toBe(true);
    expect(smtpIsImplicitTls(587)).toBe(false);
    expect(smtpIsImplicitTls(25)).toBe(false);
  });

  it('un servidor sin puerto no se puede guardar: 465 y 587 no hablan igual', () => {
    const problems = mailConfigProblems({ smtpHost: 'mail.hoteleshw.com' });
    expect(problems.map((problem) => problem.field)).toContain('smtpPort');
  });

  it('devuelve todos los problemas, no el primero', () => {
    // Host sin puerto y sin remitente: dos cosas que faltan a la vez.
    const problems = mailConfigProblems({ smtpHost: 'mail.hoteleshw.com' });
    expect(problems.length).toBeGreaterThanOrEqual(2);
    expect(problems.map((problem) => problem.field)).toEqual(
      expect.arrayContaining(['smtpPort', 'mailFrom']),
    );
  });

  it('un puerto suelto sin servidor tampoco pasa', () => {
    const problems = mailConfigProblems({ smtpPort: 465 });
    expect(problems.map((problem) => problem.field)).toContain('smtpHost');
  });

  it('el remitente admite la forma con nombre', () => {
    expect(extractAddress('Libro Operativo <recepcion@hoteleshw.com>')).toBe(
      'recepcion@hoteleshw.com',
    );
    expect(extractAddress('recepcion@hoteleshw.com')).toBe('recepcion@hoteleshw.com');
    expect(extractAddress('no es un correo')).toBeNull();
  });

  it('un remitente inválido no se guarda', () => {
    const problems = mailConfigProblems({
      smtpHost: 'mail.hoteleshw.com',
      smtpPort: 465,
      mailFrom: 'esto no es una direccion',
    });
    expect(problems.map((problem) => problem.field)).toContain('mailFrom');
  });

  it('una configuración completa no tiene problemas', () => {
    expect(
      mailConfigProblems({
        smtpHost: 'mail.hoteleshw.com',
        smtpPort: 465,
        smtpUser: 'recepcion@hoteleshw.com',
        mailFrom: 'Libro Operativo <recepcion@hoteleshw.com>',
      }),
    ).toEqual([]);
  });

  /*
    El aviso que justifica el archivo: el hotel entregó «IMAP, puerto 995», y
    995 es POP3 sobre SSL. Con ese par la casilla no se lee nunca.
  */
  it('avisa que 995 es POP3, no IMAP, y dice el puerto correcto', () => {
    const warnings = mailConfigWarnings({ inboundProtocol: 'IMAP', inboundPort: 995 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toContain('POP3');
    expect(warnings[0]!.message).toContain('993');
  });

  it('avisa al revés también: 993 con POP3', () => {
    const warnings = mailConfigWarnings({ inboundProtocol: 'POP3', inboundPort: 993 });
    expect(warnings[0]!.message).toContain('995');
  });

  it('el par correcto no genera aviso', () => {
    expect(mailConfigWarnings({ inboundProtocol: 'IMAP', inboundPort: 993 })).toEqual([]);
    expect(mailConfigWarnings({ inboundProtocol: 'POP3', inboundPort: 995 })).toEqual([]);
  });

  it('avisa del puerto sin cifrar, pero no lo prohíbe', () => {
    const warnings = mailConfigWarnings({ inboundProtocol: 'IMAP', inboundPort: 143 });
    expect(warnings[0]!.message).toContain('sin cifrar');
    // Y no bloquea: el aviso no es un problema.
    expect(
      mailConfigProblems({ inboundProtocol: 'IMAP', inboundPort: 143, inboundHost: 'mail.x.com' }),
    ).toEqual([]);
  });

  it('avisa del puerto 25 de salida', () => {
    const warnings = mailConfigWarnings({ smtpPort: 25 });
    expect(warnings[0]!.message).toContain('465');
  });

  it('canSend exige servidor, puerto y remitente', () => {
    expect(canSend({ smtpHost: 'x', smtpPort: 465, mailFrom: 'a@b.com' })).toBe(true);
    expect(canSend({ smtpHost: 'x', smtpPort: null, mailFrom: 'a@b.com' })).toBe(false);
    expect(canSend({ smtpHost: '', smtpPort: 465, mailFrom: 'a@b.com' })).toBe(false);
    expect(canSend({ smtpHost: 'x', smtpPort: 465, mailFrom: '' })).toBe(false);
  });
});

describe('cifrado de secretos en reposo', () => {
  it('lo cifrado no contiene el texto original', () => {
    const sealed = sealSecret('KYq1sqlrdGf8', 'mail/smtp');
    expect(sealed).not.toContain('KYq1sqlrdGf8');
    expect(openSecret(sealed, 'mail/smtp')).toBe('KYq1sqlrdGf8');
  });

  it('dos cifrados del mismo texto son distintos', () => {
    // Si fueran iguales, quien viera la base sabría que dos buzones comparten
    // la clave sin necesidad de descifrar nada.
    const a = sealSecret('misma-clave', 'mail/smtp');
    const b = sealSecret('misma-clave', 'mail/smtp');
    expect(a).not.toBe(b);
    expect(openSecret(a, 'mail/smtp')).toBe(openSecret(b, 'mail/smtp'));
  });

  it('un propósito distinto no abre el secreto', () => {
    const sealed = sealSecret('clave-de-salida', 'mail/smtp');
    expect(openSecret(sealed, 'mail/inbound')).toBeNull();
  });

  it('un texto alterado no se abre: devuelve null, no basura', () => {
    const sealed = sealSecret('clave', 'mail/smtp');
    const parts = sealed.split('.');
    // Se cambia un carácter del texto cifrado.
    const tampered = [parts[0], parts[1], parts[2], `${parts[3]!.slice(0, -1)}A`].join('.');
    expect(openSecret(tampered, 'mail/smtp')).toBeNull();
  });

  it('un formato desconocido devuelve null en lugar de lanzar', () => {
    expect(openSecret('no-es-un-secreto', 'mail/smtp')).toBeNull();
    expect(openSecret('', 'mail/smtp')).toBeNull();
    expect(openSecret(null, 'mail/smtp')).toBeNull();
  });
});

describe('consola de correo', () => {
  let admin: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    await resetOperationalData();
    await seedCatalog();
  });

  beforeEach(async () => {
    await prisma.mailSettings.deleteMany();
    admin = await createUser({ roleKey: ROLE_KEYS.SYSTEM_ADMIN, name: 'Ana Sistema' });
  });

  it('sin configurar, no se puede enviar y lo dice', async () => {
    const view = await getMailConfigView();
    expect(view.canSend).toBe(false);
    expect(view.source).toBe('sin-configurar');
    expect(await isMailConfigured()).toBe(false);
  });

  it('lo guardado en la base manda, y la vista lo refleja', async () => {
    await saveMailConfig(admin, {
      smtpHost: 'mail.hoteleshw.com',
      smtpPort: 465,
      smtpUser: 'recepcion@hoteleshw.com',
      smtpPassword: 'ClaveDelBuzon1',
      mailFrom: 'Libro Operativo <recepcion@hoteleshw.com>',
    });

    const view = await getMailConfigView();
    expect(view.canSend).toBe(true);
    expect(view.source).toBe('base');
    expect(view.smtpHost).toBe('mail.hoteleshw.com');
    expect(view.smtpPort).toBe(465);
    expect(await isMailConfigured()).toBe(true);
  });

  /* Lo más importante del archivo. */
  it('la clave no aparece en la base en claro ni en la vista', async () => {
    await saveMailConfig(admin, {
      smtpHost: 'mail.hoteleshw.com',
      smtpPort: 465,
      smtpUser: 'recepcion@hoteleshw.com',
      smtpPassword: 'ClaveDelBuzon1',
      mailFrom: 'recepcion@hoteleshw.com',
    });

    const row = await prisma.mailSettings.findUnique({ where: { id: 'default' } });
    expect(row!.smtpPasswordEnc).toBeTruthy();
    expect(row!.smtpPasswordEnc).not.toContain('ClaveDelBuzon1');
    // La fila completa, serializada, tampoco la contiene por ninguna otra vía.
    expect(JSON.stringify(row)).not.toContain('ClaveDelBuzon1');

    const view = await getMailConfigView();
    expect(view.hasSmtpPassword).toBe(true);
    expect(view.smtpPasswordUnreadable).toBe(false);
    // La vista es lo que viaja al navegador: no puede llevar la clave.
    expect(JSON.stringify(view)).not.toContain('ClaveDelBuzon1');
  });

  it('pero el servidor sí la puede usar para enviar', async () => {
    await saveMailConfig(admin, {
      smtpHost: 'mail.hoteleshw.com',
      smtpPort: 465,
      smtpUser: 'recepcion@hoteleshw.com',
      smtpPassword: 'ClaveDelBuzon1',
      mailFrom: 'recepcion@hoteleshw.com',
    });

    const resolved = await resolveMailConfig();
    expect(resolved?.password).toBe('ClaveDelBuzon1');
    expect(resolved?.source).toBe('base');
  });

  it('la auditoría registra el cambio sin la clave', async () => {
    await saveMailConfig(admin, {
      smtpHost: 'mail.hoteleshw.com',
      smtpPort: 465,
      smtpPassword: 'ClaveDelBuzon1',
      mailFrom: 'recepcion@hoteleshw.com',
    });

    const logs = await prisma.auditLog.findMany({ where: { entity: 'MailSettings' } });
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain('ClaveDelBuzon1');
    // Sí queda constancia de que hay clave.
    expect(JSON.stringify(logs)).toContain('guardada (cifrada)');
  });

  /*
    El gesto más común: alguien entra a corregir el puerto. Si eso borrara la
    clave, el correo se caería y nada en la pantalla lo explicaría.
  */
  it('guardar sin escribir la clave conserva la guardada', async () => {
    await saveMailConfig(admin, {
      smtpHost: 'mail.hoteleshw.com',
      smtpPort: 465,
      smtpUser: 'recepcion@hoteleshw.com',
      smtpPassword: 'ClaveDelBuzon1',
      mailFrom: 'recepcion@hoteleshw.com',
    });

    await saveMailConfig(admin, {
      smtpHost: 'mail.hoteleshw.com',
      smtpPort: 587,
      smtpUser: 'recepcion@hoteleshw.com',
      smtpPassword: '',
      mailFrom: 'recepcion@hoteleshw.com',
    });

    const resolved = await resolveMailConfig();
    expect(resolved?.port).toBe(587);
    expect(resolved?.password).toBe('ClaveDelBuzon1');
  });

  it('para quitar la clave hay un gesto explícito', async () => {
    await saveMailConfig(admin, {
      smtpHost: 'mail.hoteleshw.com',
      smtpPort: 465,
      smtpPassword: 'ClaveDelBuzon1',
      mailFrom: 'recepcion@hoteleshw.com',
    });

    await saveMailConfig(admin, {
      smtpHost: 'mail.hoteleshw.com',
      smtpPort: 465,
      mailFrom: 'recepcion@hoteleshw.com',
      clearSmtpPassword: true,
    });

    const view = await getMailConfigView();
    expect(view.hasSmtpPassword).toBe(false);
  });

  it('una configuración inválida se rechaza y no deja nada a medias', async () => {
    await expect(
      saveMailConfig(admin, { smtpHost: 'mail.hoteleshw.com' }),
    ).rejects.toThrow(/puerto/i);

    expect(await prisma.mailSettings.findUnique({ where: { id: 'default' } })).toBeNull();
  });

  it('los avisos se devuelven al guardar, sin impedirlo', async () => {
    const result = await saveMailConfig(admin, {
      smtpHost: 'mail.hoteleshw.com',
      smtpPort: 465,
      mailFrom: 'recepcion@hoteleshw.com',
      inboundProtocol: 'IMAP',
      inboundHost: 'mail.hoteleshw.com',
      inboundPort: 995,
      inboundUser: 'recepcion@hoteleshw.com',
      inboundPassword: 'ClaveEntrada1',
    });

    expect(result.canSend).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.message).toContain('POP3');

    // Se guardó de verdad, aviso incluido.
    const view = await getMailConfigView();
    expect(view.inboundPort).toBe(995);
    expect(view.hasInboundPassword).toBe(true);
  });

  it('la clave de entrada se cifra con un propósito distinto a la de salida', async () => {
    await saveMailConfig(admin, {
      smtpHost: 'mail.hoteleshw.com',
      smtpPort: 465,
      smtpPassword: 'ClaveSalida1',
      mailFrom: 'recepcion@hoteleshw.com',
      inboundHost: 'mail.hoteleshw.com',
      inboundProtocol: 'IMAP',
      inboundPort: 993,
      inboundPassword: 'ClaveEntrada1',
    });

    const row = await prisma.mailSettings.findUnique({ where: { id: 'default' } });
    // La de entrada NO se abre con el propósito de la de salida.
    expect(openSecret(row!.inboundPasswordEnc, 'mail/smtp')).toBeNull();
    expect(openSecret(row!.inboundPasswordEnc, 'mail/inbound')).toBe('ClaveEntrada1');
  });

  it('la casilla de credenciales se puede cambiar desde la consola', async () => {
    await saveMailConfig(admin, {
      credentialsMailTo: 'gerencia@hoteleshw.com',
    });
    expect(await credentialsRecipient()).toBe('gerencia@hoteleshw.com');
  });

  /*
    Una prueba contra un servidor que no existe DEBE fallar y dejar constancia,
    no romperse. Es el caso normal: se configura mal y hay que poder leer por
    qué.
  */
  it('una prueba fallida se guarda con el detalle del servidor', async () => {
    await saveMailConfig(admin, {
      smtpHost: 'servidor.que.no.existe.invalido',
      smtpPort: 465,
      mailFrom: 'recepcion@hoteleshw.com',
    });

    const result = await sendMailTest(admin, { to: 'recepcion@hoteleshw.com' });
    expect(result.ok).toBe(false);
    expect(result.detail).toBeTruthy();

    const view = await getMailConfigView();
    expect(view.lastTestOk).toBe(false);
    expect(view.lastTestAt).toBeTruthy();
    expect(view.lastTestTo).toBe('recepcion@hoteleshw.com');
    expect(view.lastTestDetail).toBeTruthy();
  }, 30_000);

  it('sin destino, la prueba no se intenta', async () => {
    await expect(sendMailTest(admin, { to: '   ' })).rejects.toThrow(/dirección/i);
  });

  it('vaciar el servidor de salida devuelve el correo a «sin configurar»', async () => {
    await saveMailConfig(admin, {
      smtpHost: 'mail.hoteleshw.com',
      smtpPort: 465,
      mailFrom: 'recepcion@hoteleshw.com',
    });
    expect((await getMailConfigView()).canSend).toBe(true);

    await saveMailConfig(admin, {});
    const view = await getMailConfigView();
    expect(view.canSend).toBe(false);
    expect(view.source).toBe('sin-configurar');
  });
});

describe('sólo el administrador configura el correo', () => {
  it('la acción exige system.configure', () => {
    const source = readFileSync('src/server/actions/mail.ts', 'utf-8');
    const guards = source.match(/requirePermission\('([^']+)'\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
    for (const guard of guards) {
      expect(guard).toContain('system.configure');
    }
  });

  it('la pantalla también, en el servidor', () => {
    const source = readFileSync(
      'src/app/(app)/admin/correo/page.tsx',
      'utf-8',
    );
    expect(source).toContain("requirePagePermission('system.configure')");
  });

  /*
    El formulario no puede tener un campo que devuelva la clave: sería dejarla
    en el código de la página y en el historial del navegador.
  */
  it('el formulario no rellena ningún campo de clave', () => {
    const source = readFileSync(
      'src/components/admin/mail-form.tsx',
      'utf-8',
    );
    expect(source).not.toMatch(/name="smtpPassword"[^>]*defaultValue/);
    expect(source).not.toMatch(/name="inboundPassword"[^>]*defaultValue/);
    // Y lo que llega al componente es sólo si hay clave, no cuál.
    expect(source).toContain('hasSmtpPassword');
  });
});
