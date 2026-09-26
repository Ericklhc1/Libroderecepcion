'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { runAction, type ActionState } from '@/server/action';
import { requireUser } from '@/server/auth/guard';

/**
 * Marca el recorrido guiado como hecho.
 *
 * No exige permiso, sólo sesión: es sobre la propia cuenta, y exigir un
 * permiso dejaría a alguien atrapado en su propio tutorial.
 *
 * Terminarlo y saltarlo escriben lo mismo. La diferencia sería puro registro y
 * el recorrido se puede volver a abrir desde el perfil, así que guardar dos
 * estados no serviría para nada.
 */
export async function finishTutorialAction(): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { tutorialDoneAt: new Date() },
    });
    // El recorrido se decide en el layout, igual que el comunicado.
    revalidatePath('/', 'layout');
    return { ok: true as const, message: 'Ok, no volverás a ver el tutorial. Puedes activarlo cuando quieras desde Mi perfil.' };
  });
}

/** Vuelve a ofrecer el recorrido, desde el perfil. */
export async function restartTutorialAction(): Promise<ActionState> {
  return runAction(async () => {
    const user = await requireUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { tutorialDoneAt: null },
    });
    revalidatePath('/', 'layout');
    return { ok: true as const, message: 'El recorrido volverá a aparecer.' };
  });
}
