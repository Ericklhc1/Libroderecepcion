import bcrypt from 'bcryptjs';
import { z } from 'zod';

const ROUNDS = 12;

/**
 * Política de contraseñas: longitud mínima 10, mayúscula, minúscula y dígito.
 * Se valida en servidor tanto al crear usuarios como al cambiar contraseña.
 */
export const passwordSchema = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .max(128, 'La contraseña es demasiado larga')
  .refine((v) => /[a-z]/.test(v), 'Debe incluir al menos una minúscula')
  .refine((v) => /[A-Z]/.test(v), 'Debe incluir al menos una mayúscula')
  .refine((v) => /[0-9]/.test(v), 'Debe incluir al menos un número');

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}
