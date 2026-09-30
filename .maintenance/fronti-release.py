from pathlib import Path
import hashlib
import json
import re


def replace_once(text, old, new):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'Expected exactly one match, found {count}: {old[:120]!r}')
    return text.replace(old, new, 1)


def read_verified(path, expected):
    data = Path(path).read_bytes()
    digest = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if digest != expected:
        raise RuntimeError(f'Unexpected source version: {path}: {digest}')
    return data.decode()


path = 'src/server/ai/reception-assistant.ts'
s = read_verified(path, '6c3a83ef141d5882858edd284bce9651b714c39a')
s = replace_once(s, "import 'server-only';", """import 'server-only';

import { revalidatePath } from 'next/cache';
import { parseFrontiDueAt } from '@/domain/fronti-due-date';
import { buildFrontiToolIntent } from './fronti-v2/action-intent';
import {
  prepareFrontiEntryDraft,
  validateFrontiEntryAssignment,
  type FrontiEntryDraft,
} from './fronti-v2/entry-draft';""")
s = replace_once(s, '  assertFrontiToolEnabled,\n', '  assertFrontiToolEnabled,\n  canFrontiUseTool,\n')
s = replace_once(s, """      args: {
        type: 'NOVEDAD' | 'INCIDENCIA';
        title: string;
        description: string;
        roomNumber?: string | null;
        priority: 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA';
        severity?: 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA' | null;
        requiresFollowUp: boolean;
      };""", '      args: FrontiEntryDraft;')
start = s.index('async function entryProposalTool(')
end = s.index('async function completeTaskProposalTool(', start)
s = s[:start] + """async function entryProposalTool(user: CurrentUser, args: Record<string, unknown>) {
  const type = args.type === 'INCIDENCIA' ? EntryType.INCIDENCIA : EntryType.NOVEDAD;
  requireToolPermission(user, type === EntryType.INCIDENCIA ? 'incident.create' : 'entry.create');
  const { draft, detail } = await prepareFrontiEntryDraft(user, args);
  const confirmation = makeConfirmation(
    user,
    'create_entry',
    draft,
    type === EntryType.INCIDENCIA ? 'Crear incidencia' : 'Crear novedad',
    detail,
    draft.priority === 'CRITICA' ? 'high' : 'normal',
  );
  return {
    status: 'confirmation_required',
    message: 'El registro está preparado y todavía no se ha creado.',
    confirmation,
  };
}

""" + s[end:]
s = replace_once(s, "  const date = new Date(dueAt);\n", "  const date = parseFrontiDueAt(dueAt);\n")
s = replace_once(s, "  if (!dueAt || Number.isNaN(date.getTime())) {", "  if (!date || Number.isNaN(date.getTime())) {")
s = replace_once(s, '...(taskId ? { id: taskId } : { seq: taskSeq as number }),', '...(taskId ? { id: taskId } : { humanId: taskSeq as number }),')
s = replace_once(s, "  assertFrontiToolEnabled(config, name);\n", """  assertFrontiToolEnabled(config, name);
  if (!canFrontiUseTool(user, name)) {
    throw new Error('Tu cuenta no tiene permiso para realizar esa acción.');
  }
""")
s = replace_once(s, "    'Cuando indique needs_info, pide sólo lo que falta. Si falta un permiso, dilo sin sugerir cómo saltarlo. ' +", """    'Cuando indique needs_info, pide sólo lo que falta. Si falta un permiso, dilo sin sugerir cómo saltarlo. ' +
    'Para crear una novedad usa proponer_registro: basta una descripción breve de lo ocurrido; puedes usar ese mismo texto como título y descripción. No obligues a rellenar un formulario en el chat. Habitación, responsable y vencimiento son opcionales; usa null si no se indicaron. Prioridad no indicada: null, el sistema mostrará la predeterminada en la tarjeta. Para incidencias pregunta sólo la gravedad si falta. ' +
    'Conserva todos los datos que el usuario ya dio en mensajes anteriores. Si pide responsable por persona o área, envía el nombre literal en responsible; no inventes IDs ni confundas un área con una persona. Envía el vencimiento literal en dueAt: el servidor interpreta «hoy a las 21:00» en la hora del hotel. Nunca pidas ISO 8601 al usuario. ' +
    'Cuando tengas datos suficientes, prepara la tarjeta con la herramienta disponible en esta solicitud; no digas que falta habilitar una integración ni ofrezcas registrar sin llamar la herramienta. Una tarjeta es una propuesta, no una escritura: sólo la confirmación en pantalla guarda. Un sí escrito en el chat no sustituye esa confirmación. ' +""")
s = replace_once(s, "    'Para recordatorios con fechas relativas, conviértelas a ISO 8601 con la zona horaria del hotel. ' +", "    'Para recordatorios conserva la fecha relativa aportada por el usuario: el servidor la interpreta con la zona horaria del hotel. ' +")
s = replace_once(s, '    const tools = chatTools(config, user, latestUserMessage, runtimeContext);', '    const tools = chatTools(config, user, buildFrontiToolIntent(messages), runtimeContext);')
s = replace_once(s, '    const confirmations: AssistantConfirmation[] = [];', '    const confirmations: AssistantConfirmation[] = [];\n    const proposalFingerprints = new Set<string>();')
s = replace_once(s, '          args = JSON.parse(call.function.arguments) as Record<string, unknown>;', """          const parsed: unknown = JSON.parse(call.function.arguments);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('La acción necesita parámetros válidos.');
          }
          args = parsed as Record<string, unknown>;""")
s = replace_once(s, '        try {\n          const result = await executeTool(', """        try {
          if (!tools.some((tool) => tool.function.name === call.function.name)) {
            throw new Error('Esta acción no está disponible en esta solicitud con tus permisos.');
          }
          const proposalKey = call.function.name + ':' + JSON.stringify(
            Object.entries(args).sort(([left], [right]) => left.localeCompare(right)),
          );
          if (proposalFingerprints.has(proposalKey)) {
            toolMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ status: 'confirmation_required', message: 'La misma propuesta ya está preparada. No se duplicó.' }),
            });
            continue;
          }
          const result = await executeTool(""")
s = replace_once(s, '            confirmations.push(card);', '            confirmations.push(card);\n            proposalFingerprints.add(proposalKey);')
s = replace_once(s, '      chat = [...chat, response.assistantMessage, ...toolMessages];', """      // La tarjeta ya es un resultado verificado del servidor. No necesitamos
      // otra inferencia que pueda perderla, fingir éxito o agotar el proveedor.
      if (confirmations.length) {
        recordFrontiAgentRun(telemetry, {
          provider: modelTrace.at(-1)?.provider ?? config.provider,
          model: modelTrace.at(-1)?.model ?? config.model,
          configuredProvider: config.provider,
          configuredModel: config.model,
          models: modelTrace,
          durationMs: Date.now() - startedAt,
          loops,
          tools: toolTrace,
          outcome: toolTrace.some((item) => !item.ok) ? 'partial' : 'success',
        });
        return {
          reply: 'La propuesta está preparada, pero todavía no se ha guardado ningún cambio. Revisa los datos de la tarjeta y pulsa «Confirmar».' +
            (toolTrace.some((item) => !item.ok) ? ' Otra parte de la solicitud necesita revisión; sólo están preparadas las acciones que aparecen en las tarjetas.' : ''),
          confirmations,
        };
      }
      chat = [...chat, response.assistantMessage, ...toolMessages];""")
s = replace_once(s, '  await claimConfirmation(pending);\n\n  try {', '  await claimConfirmation(pending);\n  let actionCommitted = false;\n\n  try {')
start = s.index("  if (pending.action === 'create_entry') {")
end = s.index("  if (pending.action === 'complete_task') {", start)
block = s[start:end]
block = replace_once(block, '    const room = pending.args.roomNumber', '    await validateFrontiEntryAssignment(pending.args);\n\n    const room = pending.args.roomNumber')
block = replace_once(block, '      departmentId: user.departmentId,', '      departmentId: pending.args.departmentId === undefined ? user.departmentId : pending.args.departmentId,')
block = replace_once(block, '      ownerId: null,', '      ownerId: pending.args.ownerId ?? null,')
block = replace_once(block, '      dueAt: null,', '      dueAt: parseFrontiDueAt(pending.args.dueAt),')
block = replace_once(block, """    if (type === EntryType.INCIDENCIA) {
      await ensureIncidentWorkflow(entry.id);
    }
    return {
      reply: `${type === EntryType.INCIDENCIA ? 'Incidencia' : 'Novedad'} #${entry.humanId} creada: ${entry.title}.`,
    };""", """    actionCommitted = true;
    let warning = '';
    if (type === EntryType.INCIDENCIA) {
      try {
        await ensureIncidentWorkflow(entry.id);
      } catch (error) {
        console.error('Fronti: registro guardado con seguimiento pendiente', { entryId: entry.id, error });
        warning = ' El registro quedó guardado, pero no se pudo completar su seguimiento automático. Revísalo desde el registro; no vuelvas a crearlo.';
      }
    }
    try {
      for (const path of ['/', '/libro', '/incidencias', '/tareas', '/seguimientos', '/novedades/habitacion', `/libro/${entry.id}`]) {
        revalidatePath(path);
      }
    } catch (error) {
      console.error('Fronti: registro guardado, actualización de vistas pendiente', { entryId: entry.id, error });
    }
    const label = type === EntryType.INCIDENCIA ? 'Incidencia' : 'Novedad';
    return {
      reply: `${label} #${entry.humanId} creada: ${entry.title}. [Abrir ${label.toLowerCase()} #${entry.humanId}](/libro/${entry.id}).${warning}`,
    };""")
s = s[:start] + block + s[end:]
s = replace_once(s, '    await releaseConfirmationClaim(pending);\n    throw error;', '    if (!actionCommitted) await releaseConfirmationClaim(pending);\n    throw error;')
Path(path).write_text(s)

path = 'src/server/ai/fronti-v2/tool-registry.ts'
s = read_verified(path, '6a46bbe69daf6cfd4f92b6124f3ab7f5e1b1f241')
start = s.index("    name: 'proponer_registro',")
end = s.index("    name: 'proponer_resolver_tarea',", start)
block = s[start:end]
block = replace_once(block, 'Prepara una novedad o incidencia de la Central. Las incidencias requieren gravedad. La escritura sólo ocurre después de confirmar la tarjeta.', 'Prepara una novedad o incidencia con los datos ya aportados. Basta una descripción breve: no exijas habitación, responsable ni vencimiento si no se indicaron. Conserva el responsable y plazo cuando existan. Las incidencias requieren gravedad. Sólo guarda después de confirmar la tarjeta.')
block = replace_once(block, "description: { type: 'string', minLength: 3, maxLength: 4000 },", "description: { type: ['string', 'null'], maxLength: 4000, description: 'Descripción aportada por el usuario o null para usar el título sin pedirlo dos veces.' },")
block = replace_once(block, "priority: { type: 'string', enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] },", "priority: { type: ['string', 'null'], enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA', null], description: 'Prioridad indicada o null: se mostrará media como valor predeterminado en la tarjeta.' },")
block = replace_once(block, "        requiresFollowUp: { type: 'boolean' },", """        requiresFollowUp: { type: 'boolean' },
        responsible: {
          type: ['string', 'null'], maxLength: 160,
          description: 'Nombre literal de la persona, usuario o área indicada (por ejemplo área recepción). Null si no se indicó. No inventes identificadores.',
        },
        dueAt: {
          type: ['string', 'null'], maxLength: 160,
          description: 'Vencimiento literal del usuario, por ejemplo hoy a las 21:00, mañana a las 09:00 o en 2 días. También acepta ISO. Null si no se indicó.',
        },""")
block = replace_once(block, "        'requiresFollowUp',", "        'requiresFollowUp',\n        'responsible',\n        'dueAt',")
s = s[:start] + block + s[end:]
s = replace_once(s, "description: 'Fecha y hora ISO 8601 con zona horaria explícita.',", "description: 'Fecha y hora indicada por el usuario, por ejemplo mañana a las 09:00 o en 2 horas; el servidor interpreta la hora del hotel. También acepta ISO.',")
s = replace_once(s, '/crea|crear|registra|registrar|anota|anotar/.test(text)', '/crea|crear|registra|registrar|anota|anotar|genera|levanta|deja una/.test(text)')
s = replace_once(s, r'/tarea|t#|#\\d+/.test(text)', r'/tarea|t#|#\d+/.test(text)')
Path(path).write_text(s)

for path in ['src/components/layout/chat-widget.tsx', 'src/components/layout/fronti-assistant.tsx']:
    s = Path(path).read_text()
    s, count = re.subn(r'(<p className=")([^"\n]*)(">\{item\.detail\}</p>)', r'\1\2 max-h-52 overflow-y-auto whitespace-pre-wrap break-words\3', s)
    if count != 1:
        raise RuntimeError(f'Expected one confirmation detail in {path}, found {count}')
    if path.endswith('chat-widget.tsx'):
        s = replace_once(s, 'Asistente del Libro', 'AROH Central IA')
    Path(path).write_text(s)

for path in ['package.json', 'package-lock.json']:
    data = json.loads(Path(path).read_text())
    if data['version'] != '1.37.7':
        raise RuntimeError(f'Unexpected version in {path}')
    data['version'] = '1.38.0'
    if path.endswith('lock.json'):
        data['packages']['']['version'] = '1.38.0'
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')

section = '''
## 30/09/2026 · AROH 1.38.0 · Fronti: acciones continuas y confirmación verificable

- Causa raíz: el catálogo de herramientas se elegía únicamente con el último mensaje; una respuesta por campos perdía la intención previa de crear. La selección conserva ahora la solicitud literal reciente del usuario, sin convertir mensajes del modelo en autorizaciones; preguntas nuevas y cancelaciones cortan la continuidad.
- La propuesta de Novedad/Incidencia conserva persona o área responsable y vencimiento. Resuelve nombres contra los catálogos operativos, respeta usuarios ocultos/inactivos/no operativos, pide aclaración ante ambigüedad y revalida antes de confirmar.
- Las fechas naturales (hoy, mañana, en dos días con número, horas/minutos) usan las funciones canónicas de America/Santiago; no se exige ISO al usuario ni se fija UTC-3. Campos opcionales no bloquean una novedad simple; prioridad predeterminada y datos completos son visibles antes de guardar.
- Las tarjetas muestran descripción, responsable, área, habitación, prioridad, vencimiento y seguimiento, con lectura desplazable en móvil. El encabezado identifica AROH Central IA.
- Tras obtener una tarjeta válida, la respuesta es determinística: aún no está guardada. No se consume otra inferencia que pueda perder la propuesta o fingir éxito. Propuestas idénticas de una misma respuesta se deduplican.
- La escritura sigue pasando por createEntry, con permisos y bloqueo operativo de turno. La confirmación retorna el # global real y enlace al registro, actualiza las vistas y no libera una confirmación consumida si falla un paso posterior de seguimiento.
- Se refuerza la validación de herramientas al ejecutar; no se amplían roles ni capacidades. Completar tareas por # usa humanId, no el correlativo legado del módulo.
- Pruebas nuevas: reproducción de conversación por campos, continuidad/cancelación, permisos, catálogos, fechas de verano/invierno, tarjetas, persistencia simulada completa, caducidad y doble confirmación. No se crean registros de prueba en Production.
- Sin migración Prisma, sin cambios de datos históricos ni proveedores nuevos. Base v1.37.7 / e7501461499f6a17e5a545ae3c97e9641c705928. Release v1.38.0.

'''
for path in ['PROJECT_CONTEXT.md', 'docs/AGENT_HANDOFF.md']:
    s = Path(path).read_text()
    first, rest = s.split('\n', 1)
    Path(path).write_text(first + '\n' + section + rest)
print('Parche Fronti 1.38.0 aplicado con coincidencias verificadas.')
