import 'server-only';
import { randomInt } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { credentialsRecipient, isMailConfigured, sendMail } from '@/server/mail';
import { normalizeUsername, suggestUsername } from '@/domain/username';

/**
 * Credenciales de los usuarios nuevos.
 *
 * El sistema genera la clave —nadie la elige— y la envía al correo de
 * recepción. La clave en claro sólo existe el tiempo que dura la operación: no
 * se guarda en la base ni en la auditoría, que redacta ese campo.
 */

// Sin caracteres que se confundan al dictar por teléfono: O/0, I/l/1.
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%&*?';

function pick(alphabet: string): string {
  return alphabet[randomInt(alphabet.length)] ?? alphabet[0]!;
}

/**
 * Clave temporal de 14 caracteres con mayúscula, minúscula, número y símbolo.
 * Cumple la política del sistema por construcción, no por casualidad.
 */
export function generatePassword(): string {
  const required = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  const pool = UPPER + LOWER + DIGITS + SYMBOLS;
  const rest = Array.from({ length: 10 }, () => pick(pool));
  const characters = [...required, ...rest];

  // Mezcla de Fisher-Yates con aleatoriedad criptográfica.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    const a = characters[index]!;
    characters[index] = characters[swap]!;
    characters[swap] = a;
  }
  return characters.join('');
}

/**
 * Nombre de usuario libre a partir del nombre. Si ya existe, agrega un número:
 * EHerrera, EHerrera2, EHerrera3.
 */
export async function allocateUsername(
  fullName: string,
  preferred?: string | null,
): Promise<string> {
  const base = preferred ? normalizeUsername(preferred) : suggestUsername(fullName);
  let candidate = base;
  let suffix = 1;

  // El bucle termina: cada intento prueba un nombre distinto.
  while (await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

export type CredentialDelivery = {
  recipient: string;
  sent: boolean;
  reason: string | null;
};

/** Envía las credenciales al correo de recepción. */
export async function deliverCredentials(input: {
  name: string;
  username: string;
  email: string;
  password: string;
  roleName: string;
  hotelName: string;
}): Promise<CredentialDelivery> {
  const recipient = credentialsRecipient();

  const result = await sendMail({
    to: recipient,
    subject: `Credenciales de acceso · ${input.name} · Libro Operativo de Recepción`,
    text: [
      `Se creó una cuenta en el Libro Operativo de Recepción de ${input.hotelName}.`,
      '',
      `Nombre:          ${input.name}`,
      `Usuario:         @${input.username}`,
      `Correo de acceso: ${input.email}`,
      `Rol:             ${input.roleName}`,
      `Clave temporal:  ${input.password}`,
      '',
      'La clave es de un solo uso: el sistema pide cambiarla en el primer ingreso.',
      'Entrégala en persona y no la reenvíes por otros canales.',
    ].join('\n'),
  });

  return {
    recipient,
    sent: result.sent,
    reason: result.sent ? null : result.reason,
  };
}

export { isMailConfigured };
