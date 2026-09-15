/**
 * Nombre de usuario a partir del nombre de la persona.
 *
 * Formato del hotel: inicial del nombre más el primer apellido, sin acentos ni
 * espacios, como @EHerrera. Se muestra con arroba, pero se guarda sin ella.
 */
export function suggestUsername(fullName: string): string {
  const clean = fullName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const parts = clean.split(' ').filter(Boolean);
  if (!parts.length) return 'Usuario';

  const first = parts[0] ?? '';
  const surname = parts[1] ?? '';

  const initial = (first[0] ?? '').toUpperCase();
  const family = surname
    ? surname[0]!.toUpperCase() + surname.slice(1).toLowerCase()
    : first[0]!.toUpperCase() + first.slice(1).toLowerCase();

  return surname ? `${initial}${family}` : family;
}

/** Con arroba, para mostrar. El almacenamiento nunca la lleva. */
export function displayUsername(username: string): string {
  return `@${username}`;
}

/** Quita la arroba y normaliza lo que escribió una persona. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').replace(/\s+/g, '');
}

export const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{2,29}$/;
