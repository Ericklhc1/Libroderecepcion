import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from './env';

/**
 * Cifrado de secretos guardados en la base.
 *
 * La base guarda sólo el texto cifrado. La llave se deriva de AUTH_SECRET y
 * permanece en el entorno. AES-256-GCM aporta confidencialidad e integridad.
 */
const VERSION = 'v1';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function keyFor(purpose: string): Buffer {
  const secret = env().AUTH_SECRET;
  return Buffer.from(
    hkdfSync('sha256', secret, 'libro-operativo/secret-box', purpose, KEY_LENGTH),
  );
}

/** Cifra un secreto. Devuelve `v1.iv.tag.texto`, todo en base64url canónico. */
export function sealSecret(plaintext: string, purpose: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', keyFor(purpose), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

/**
 * Decodifica base64url sólo si su representación es canónica. Node acepta
 * algunas variantes distintas que producen los mismos bytes; permitirlas haría
 * que una cadena textual manipulada pudiera seguir abriéndose correctamente.
 */
function decodeCanonical(part: string): Buffer | null {
  if (!part || !/^[A-Za-z0-9_-]+$/.test(part)) return null;
  try {
    const decoded = Buffer.from(part, 'base64url');
    return decoded.toString('base64url') === part ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * Descifra. Devuelve null ante formato desconocido, propósito/llave distintos
 * o cualquier alteración de la representación, IV, tag o ciphertext.
 */
export function openSecret(sealed: string | null | undefined, purpose: string): string | null {
  if (!sealed) return null;

  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, ivPart, tagPart, payloadPart] = parts as [string, string, string, string];

  const iv = decodeCanonical(ivPart);
  const tag = decodeCanonical(tagPart);
  const payload = decodeCanonical(payloadPart);
  if (!iv || !tag || !payload || iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) return null;

  try {
    const decipher = createDecipheriv('aes-256-gcm', keyFor(purpose), iv);
    decipher.setAuthTag(tag);
    const opened = Buffer.concat([decipher.update(payload), decipher.final()]);
    return opened.toString('utf8');
  } catch {
    return null;
  }
}
