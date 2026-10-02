'use server';

import { redirect } from 'next/navigation';
import type { ActionState } from '@/server/action';
import { coordinateWorkAction } from './coordination';
import { changeTaskStatusAction } from './tasks';

/** Navigation is a UI concern; Fronti keeps the native, structured action result. */
function destination(form: FormData, fallback: string, roots: string[]) {
  const value = form.get('returnTo');
  if (typeof value !== 'string' || value.length > 2000 || !value.startsWith('/') || value.startsWith('//')) return fallback;
  const url = new URL(value, 'https://aroh.invalid');
  if (url.origin !== 'https://aroh.invalid' || !roots.some(root => url.pathname === root || url.pathname.startsWith(root + '/'))) return fallback;
  return url.pathname + url.search;
}

export async function coordinateWorkFormAction(state: ActionState | null, form: FormData): Promise<ActionState> {
  const result = await coordinateWorkAction(state, form);
  if (result.ok) redirect(destination(form, '/coordinacion', ['/coordinacion']));
  return result;
}

export async function changeTaskStatusFormAction(state: ActionState | null, form: FormData): Promise<ActionState> {
  const result = await changeTaskStatusAction(state, form);
  if (result.ok) redirect(destination(form, '/tareas', ['/tareas', '/libro', '/supervision']));
  return result;
}
