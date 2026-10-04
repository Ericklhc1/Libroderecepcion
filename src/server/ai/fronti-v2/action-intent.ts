export type FrontiIntentMessage = { role: 'user' | 'assistant'; content: string };

function normalized(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/^fronti[\s,:]+/,'');
}

function explicitAction(text: string): boolean {
  return /\b(?:manda(?:lo|la)?|envia(?:lo|la)?|deriva(?:lo|la)?|solicita atencion|pide atencion)\b/.test(text) || (
    /(?:crea|registr|anot|genera|levanta|deja una)/.test(text) && /novedad|incidencia/.test(text)
  ) || /recuerdame|recordatorio|check.?out|confirmar salida|confirma la salida|multa/.test(text)
    || (/(?:completa|resuelve|resolver|marca como completada)/.test(text) && /tarea|#\d+/.test(text));
}

function topicBoundary(text: string): boolean {
  return /^(?:[¿?¡!]\s*)?(?:cancela|cancelar|olvida|olvidalo|mejor no|no lo hagas|no registres|no crees|otra cosa|cambiemos|cambia de tema|(?:ahora )?(?:que|como|cuando|quien|donde|por que|cual)\b)/.test(text);
}

/**
 * Seleccionar una herramienta no autoriza a ejecutarla. Conserva sólo contexto
 * literal reciente del usuario, no memoria, instrucciones del modelo ni datos
 * de otras personas. Una pregunta nueva o una cancelación corta la continuidad.
 */
export function buildFrontiToolIntent(messages: readonly FrontiIntentMessage[]): string {
  const turns = messages.filter((message) => message.role === 'user').slice(-8);
  const latest = turns.at(-1)?.content ?? '';
  const current = normalized(latest);
  if (!current || explicitAction(current) || topicBoundary(current)) return latest;

  const collected = [latest.slice(0, 4000)];
  for (let index = turns.length - 2; index >= 0; index -= 1) {
    const content = turns[index]!.content;
    const text = normalized(content);
    if (topicBoundary(text)) break;
    collected.unshift(content.slice(0, 2000));
    if (explicitAction(text)) return collected.join('\n').slice(-10_000);
  }
  return latest;
}
