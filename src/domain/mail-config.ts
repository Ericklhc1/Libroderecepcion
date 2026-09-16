/**
 * Configuración de correo: las reglas, sin base de datos ni red.
 *
 * Lo que decide este archivo es **qué impide guardar** y **qué merece un
 * aviso**. Son cosas distintas y confundirlas hace daño en las dos
 * direcciones: un hotel puede tener el correo en un puerto raro y el sistema
 * no es quién para prohibírselo, pero tampoco puede callarse cuando lo que se
 * escribió no va a funcionar.
 *
 * Todo puro: se prueba sin servidor.
 */

export type InboundProtocolValue = 'IMAP' | 'POP3';

export const INBOUND_PROTOCOL_LABELS: Record<InboundProtocolValue, string> = {
  IMAP: 'IMAP (deja los mensajes en el servidor)',
  POP3: 'POP3 (los descarga y normalmente los borra)',
};

/** Puertos habituales, y lo que significa cada uno. */
export const SMTP_PORT_HINTS: Record<number, string> = {
  465: 'TLS directo (implícito). Es el que usa este hotel.',
  587: 'STARTTLS: la conexión empieza en claro y se cifra después.',
  25: 'Sin cifrado y bloqueado por casi todos los proveedores.',
  2525: 'Alternativo a 587, mismo STARTTLS.',
};

export const INBOUND_PORT_HINTS: Record<number, string> = {
  993: 'IMAP sobre SSL.',
  143: 'IMAP sin cifrar.',
  995: 'POP3 sobre SSL.',
  110: 'POP3 sin cifrar.',
};

/** Puerto esperado de cada protocolo de entrada, cifrado y en claro. */
const INBOUND_PORTS: Record<InboundProtocolValue, { secure: number; plain: number }> = {
  IMAP: { secure: 993, plain: 143 },
  POP3: { secure: 995, plain: 110 },
};

/**
 * El 465 usa TLS desde el primer byte; el resto negocia STARTTLS.
 *
 * Vive acá y no en el transporte para que la pantalla pueda mostrar lo mismo
 * que el servidor va a hacer, sin duplicar el criterio.
 */
export function smtpIsImplicitTls(port: number): boolean {
  return port === 465;
}

export function inboundIsSecurePort(protocol: InboundProtocolValue, port: number): boolean {
  return INBOUND_PORTS[protocol].secure === port;
}

export type MailConfigDraft = {
  smtpHost?: string | null;
  smtpPort?: number | null;
  smtpUser?: string | null;
  /** Vacío significa «conserva la que ya está guardada», no «bórrala». */
  smtpPassword?: string | null;
  mailFrom?: string | null;
  credentialsMailTo?: string | null;
  inboundProtocol?: InboundProtocolValue | null;
  inboundHost?: string | null;
  inboundPort?: number | null;
  inboundUser?: string | null;
  inboundPassword?: string | null;
};

export type ConfigProblem = { field: string; message: string };

/**
 * Un remitente válido: `alguien@dominio` o `Nombre <alguien@dominio>`.
 *
 * No se usa una validación de correo completa a propósito: `MAIL_FROM` admite
 * la forma con nombre, que una validación de dirección simple rechazaría.
 */
const ADDRESS = /^[^\s@<>]+@[^\s@<>.]+\.[^\s@<>]+$/;

export function extractAddress(from: string): string | null {
  const trimmed = from.trim();
  const angled = /<([^>]+)>\s*$/.exec(trimmed);
  const candidate = (angled ? angled[1] : trimmed)?.trim() ?? '';
  return ADDRESS.test(candidate) ? candidate : null;
}

function validPort(port: number | null | undefined): boolean {
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port <= 65535;
}

/**
 * Lo que impide guardar. Lista vacía = se guarda.
 *
 * Se devuelven **todos** los problemas, como en el resto del sistema: quien
 * configura no puede descubrirlos de uno en uno.
 */
export function mailConfigProblems(draft: MailConfigDraft): ConfigProblem[] {
  const problems: ConfigProblem[] = [];

  const hasSmtpHost = Boolean(draft.smtpHost?.trim());

  /*
    Un host sin puerto no es una configuración a medias que el sistema pueda
    completar adivinando: el 465 y el 587 hablan protocolos distintos.
  */
  if (hasSmtpHost && !validPort(draft.smtpPort)) {
    problems.push({
      field: 'smtpPort',
      message: 'Indica el puerto de salida: del puerto depende cómo se cifra la conexión.',
    });
  }
  if (!hasSmtpHost && draft.smtpPort) {
    problems.push({
      field: 'smtpHost',
      message: 'Indica el servidor de salida, o deja también el puerto vacío.',
    });
  }
  if (hasSmtpHost && !draft.mailFrom?.trim()) {
    problems.push({
      field: 'mailFrom',
      message: 'Indica el remitente: sin él el servidor rechaza el envío.',
    });
  }
  if (draft.mailFrom?.trim() && !extractAddress(draft.mailFrom)) {
    problems.push({
      field: 'mailFrom',
      message: 'El remitente debe ser una dirección, con o sin nombre: Libro <correo@hotel.com>.',
    });
  }
  if (draft.credentialsMailTo?.trim() && !ADDRESS.test(draft.credentialsMailTo.trim())) {
    problems.push({
      field: 'credentialsMailTo',
      message: 'La casilla que recibe las credenciales debe ser una dirección válida.',
    });
  }

  const hasInboundHost = Boolean(draft.inboundHost?.trim());
  if (hasInboundHost && !validPort(draft.inboundPort)) {
    problems.push({ field: 'inboundPort', message: 'Indica el puerto del servidor de entrada.' });
  }
  if (hasInboundHost && !draft.inboundProtocol) {
    problems.push({
      field: 'inboundProtocol',
      message: 'Indica si la casilla se lee por IMAP o por POP3.',
    });
  }
  if (!hasInboundHost && (draft.inboundPort || draft.inboundUser?.trim())) {
    problems.push({
      field: 'inboundHost',
      message: 'Indica el servidor de entrada, o deja vacío el resto de la entrada.',
    });
  }

  return problems;
}

export type ConfigWarning = { field: string; message: string };

/**
 * Avisos: lo que se guarda igual pero probablemente no funcione.
 *
 * **No bloquean.** Un hotel puede tener el correo donde quiera, y un sistema
 * que se niega a guardar lo que su proveedor le indicó sólo obliga a saltárselo.
 * Lo que sí hace es decirlo antes de que alguien pase una tarde buscando por
 * qué no llegan los correos.
 */
export function mailConfigWarnings(draft: MailConfigDraft): ConfigWarning[] {
  const warnings: ConfigWarning[] = [];

  const smtpPort = draft.smtpPort;
  if (validPort(smtpPort) && smtpPort === 25) {
    warnings.push({
      field: 'smtpPort',
      message:
        'El puerto 25 va sin cifrar y casi todos los proveedores lo bloquean. Lo habitual es 465 o 587.',
    });
  }

  /*
    Éste es el aviso que justifica el archivo. Las credenciales que entrega un
    proveedor suelen venir rotuladas «IMAP: 995», y 995 es POP3 sobre SSL: con
    ese par la casilla no se lee y el error que devuelve el servidor no lo
    explica.
  */
  const protocol = draft.inboundProtocol;
  const inboundPort = draft.inboundPort;
  if (protocol && validPort(inboundPort)) {
    const other: InboundProtocolValue = protocol === 'IMAP' ? 'POP3' : 'IMAP';
    const expected = INBOUND_PORTS[protocol];
    const belongsToOther =
      inboundPort === INBOUND_PORTS[other].secure || inboundPort === INBOUND_PORTS[other].plain;

    if (belongsToOther) {
      warnings.push({
        field: 'inboundPort',
        message:
          `El puerto ${inboundPort} es de ${other}, no de ${protocol}. ` +
          `${protocol} sobre SSL es el ${expected.secure} (sin cifrar, el ${expected.plain}).`,
      });
    } else if (inboundPort !== expected.secure && inboundPort !== expected.plain) {
      warnings.push({
        field: 'inboundPort',
        message: `Puerto poco habitual para ${protocol}: lo normal es ${expected.secure} con SSL.`,
      });
    } else if (inboundPort === expected.plain) {
      warnings.push({
        field: 'inboundPort',
        message: `El puerto ${inboundPort} va sin cifrar. Con SSL, ${protocol} usa el ${expected.secure}.`,
      });
    }
  }

  return warnings;
}

/** ¿Alcanza para enviar? Es lo único que el sistema hace hoy con el correo. */
export function canSend(config: {
  smtpHost?: string | null;
  smtpPort?: number | null;
  mailFrom?: string | null;
}): boolean {
  return Boolean(config.smtpHost?.trim() && validPort(config.smtpPort) && config.mailFrom?.trim());
}
