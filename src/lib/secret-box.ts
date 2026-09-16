import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { env } from './env';

/**
 * Cifrado de secretos guardados en la base.
 *
 * **Por qué existe.** La regla del proyecto es que los secretos viven en
 * variables de entorno. Configurar el correo desde la consola rompería esa
 * regla si la clave del buzón quedara en claro en una columna: la base se
 * ramifica —en este proyecto se ramificó dos veces con datos reales para
 * ensayar migraciones— y cada rama sería una copia más de esa clave.
 *
 * La reconciliación: lo que se guarda en la base es el **texto cifrado**, y la
 * llave con que se cifra **sigue viniendo del entorno** (`AUTH_SECRET`). El
 * hotel gana poder cambiar el servidor de correo sin desplegar; el secreto raíz
 * no entra nunca ni al repositorio ni a la base.
 *
 * AES-256-GCM: cifra y además autentica, así que un texto alterado falla al
 * abrirse en vez de devolver basura silenciosamente.
 *
 * ⚠️ **Rotar `AUTH_SECRET` vuelve ilegible lo guardado.** Es deliberado —esa es
 * la propiedad que hace que una copia de la base no sirva por sí sola— pero
 * significa que tras rotarlo hay que volver a escribir la clave del correo.
 * `openSecret` devuelve `null` en ese caso, nunca lanza: quien abra la pantalla
 * de correo tiene que poder verla y arreglarla, no encontrarse un error 500.
 */

const VERSION = 'v1';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;

/**
 * La llave de cifrado se DERIVA de `AUTH_SECRET`, no es `AUTH_SECRET`.
 *
 * Con el `info` de HKDF distinto por propósito, la llave del correo y la de las
 * sesiones son matemáticamente independientes: filtrar una no entrega la otra.
 */
function keyFor(purpose: string): Buffer {
  const secret = env().AUTH_SECRET;
  return Buffer.from(
    hkdfSync('sha256', secret, 'libro-operativo/secret-box', purpose, KEY_LENGTH),
  );
}

/** Cifra un secreto. Devuelve `v1.iv.tag.texto`, todo en base64url. */
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
 * Descifra. `null` si el texto no es legible con la llave actual —formato
 * desconocido, `AUTH_SECRET` rotado, o contenido alterado—.
 */
export function openSecret(sealed: string | null | undefined, purpose: string): string | null {
  if (!sealed) return null;

  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const [, ivPart, tagPart, payloadPart] = parts as [string, string, string, string];

  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      keyFor(purpose),
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    const opened = Buffer.concat([
      decipher.update(Buffer.from(payloadPart, 'base64url')),
      decipher.final(),
    ]);
    return opened.toString('utf8');
  } catch {
    // Texto alterado o llave distinta. Quien configura tiene que poder
    // reescribir la clave, no toparse con una excepción.
    return null;
  }
}
