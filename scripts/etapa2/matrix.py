"""Inventory every exported Server Action; never infer executable coverage from a module name."""
import json, re
from pathlib import Path
catalog = {a['name']: a for a in json.loads(Path('scripts/etapa2/catalog.json').read_text())}
evidence = {
 'saveAutomationAction':'Crear versión en pausa mediante plan Fronti; rechaza campos parciales; etapa2-execution.test.ts (nueva Compuerta requerida)',
 'simulateAutomationAction':'Simular sin tareas/avisos y conservar resultado privado; etapa2-execution.test.ts (nueva Compuerta requerida)',
 'setAutomationStateAction':'Pausa/revocación nativas con versión y rechazo de autorización obsoleta; etapa2-execution.test.ts (habilitación por Fronti pendiente)',
 'createTaskAction':'Dos pasos, reintentos concurrentes, revocación y cancelación; etapa2-execution.test.ts',
 'changeTaskStatusAction':'Cambio posterior a autorización rechazado; validación independiente probada en servicio (éxito completo por adaptador pendiente)',
 'createManualCashMovementAction':'Entrada CLP declarada, un solo movimiento ante reintento; etapa2-execution.test.ts',
 'createPhysicalKeyAction':'Crear COPIA con normalización de código; etapa2-execution.test.ts',
 'assignPhysicalKeyAction':'Entrega declarada conserva assignedById; etapa2-execution.test.ts',
 'returnPhysicalKeyAction':'Devolución declarada vuelve a DISPONIBLE; etapa2-execution.test.ts',
 'openShiftAction':'Inicio nativo crea un turno; etapa2-execution.test.ts',
 'closeShiftAction':'Rechaza cierre sin controles nativos satisfechos (éxito completo pendiente)',
 'saveDepartmentAction':'Creación de área con permiso nativo; etapa2-execution.test.ts',
 'updateUserAction':'Formulario completo conserva datos; escritura rechaza revisión obsoleta; etapa2-execution.test.ts',
 'updateRolePermissionsAction':'Matriz completa explícita y rechazo transaccional de revisión obsoleta; etapa2-execution.test.ts',
 'createHousekeepingAction':'Solicitud nativa única tras reintento; etapa2-execution.test.ts',
 'saveScheduleCollaboratorAction':'Usuario existente; 40 horas se conservan como 2400 minutos internos; etapa2-execution.test.ts',
 'createSchedulePlanAction':'Malla del área con fecha de Santiago; etapa2-execution.test.ts',
}
rows=[]
for path in sorted(Path('src/server/actions').glob('*.ts')):
    text=path.read_text()
    matches=list(re.finditer(r'export async function (\w+)\(',text))
    for i,m in enumerate(matches):
        name=m[1]; body=text[m.end():matches[i+1].start() if i+1<len(matches) else len(text)]
        permissions=sorted(set(re.findall(r"requirePermission(?:OrOwner)?\('([^']+)'",body)))
        alias={'coordinateWorkFormAction':'coordinateWorkAction','changeTaskStatusFormAction':'changeTaskStatusAction'}.get(name)
        a=catalog.get(alias or name)
        inputs=', '.join(a['fields']) if a else 'Ver esquema/formulario nativo; adaptador pendiente'
        state='Conectado; acreditación individual pendiente' if a else 'Pendiente de adaptador (no disponible por el catálogo nuevo)'
        if alias:state=f'Transporte UI de {alias}; Fronti usa la acción original sin redirección'
        if path.stem in ['pms','reservations','room-stays','guests']:state='Fuera del alcance de producto solicitado; no ampliar'
        rows.append(f"| `{name}` | `{path}` | {', '.join(permissions) or 'Control contextual del servicio nativo'} | {inputs} | {state} | {evidence.get(name, 'Recorrido específico pendiente')} |")
preamble='''# Matriz completa de Server Actions · Etapa 2

Inventario reproducible: `python scripts/etapa2/matrix.py`. Incluye las acciones nativas detectadas y el catálogo conectado; **conexión no equivale a acreditación**. No se declara cobertura general. Consultas existentes de Fronti conservan sus lectores y permisos; se incluye al final el inventario de métodos HTTP, sin confundir su existencia con cobertura ejecutable. Exportaciones, archivos binarios y acciones de perfil todavía requieren adaptación y acreditación individual.

## Controles comunes a los adaptadores conectados

- Identidad: sesión autenticada en servidor y permisos renovados para cada paso. El modelo no suministra rol ni identidad ejecutora.
- Entrada: acción/campos admitidos + validación del formulario original. Los campos de destinatario son objetivos, nunca la identidad ejecutora.
- Confirmación: propuesta IA muestra efecto/campos y requiere autorización privada; `/ejecutar [...]` es autorización exacta del usuario. Se preservan controles y aprobaciones nativos. Declarar un hecho físico no equivale a realizarlo; nunca se aporta otra identidad.
- Efecto/servicio: se invoca la Server Action indicada, que conserva el servicio original. No hay escrituras arbitrarias elegidas por el modelo.
- Reintento: plan/posición persistidos, reclamación atómica y huella de mensaje; éxito no se repite. Resultado incierto detiene los pasos pendientes para intervención. No hay transacción global entre distintas Server Actions.
- Reversibilidad: no existe deshacer genérico. Cancelar afecta pasos pendientes; corregir una acción completada exige su procedimiento nativo y conserva auditoría.
- Pruebas comunes: `etapa2-domain.test.ts` (contrato/identidad/límites); `etapa2-execution.test.ts` (PostgreSQL, permisos/revocación, privacidad del plan, concurrencia, cancelación y ejecución parcial). Estos casos **no acreditan todos los procedimientos individuales**.
- Cambios posteriores: revisión de tareas, novedades, llaves, garantías, usuarios/permisos y configuración; HK/Coordinación/Equipo retienen versiones nativas. Falta acreditar atomicidad y cobertura de revisión de todos los procedimientos antes de publicación.

## Evidencia observada

La Compuerta 37009588380 aprobó migraciones PostgreSQL 16, 1378 pruebas (1 omisión existente), tipos/lint y build. Las pruebas específicas indicadas abajo son recorridos acotados; no prueban todas las variantes de cada procedimiento. Navegador de esa corrida falló por timeout y continúa pendiente. Las correcciones siguientes requieren nueva Compuerta. Resultado vigente: EVIDENCIA.json y PR #244.

## Inventario

| Acción | Adaptador/servicio de entrada existente | Permiso explícito en la acción | Datos del adaptador (obligatoriedad en esquema nativo) | Cobertura | Prueba específica (no acredita otras variantes) |
|---|---|---|---|---|---|
'''
# API handlers are separate from Server Actions: inventory them without claiming adapters.
api_rows=[]
for path in sorted(Path('src/app/api').rglob('route.ts')):
    text=path.read_text()
    services=sorted(set(re.findall(r"from ['\"](@/server/(?:services|ai)/[^'\"]+)",text)))
    controls=sorted(set(re.findall(r"\b(requirePermission|getCurrentUser|requireUser|assertSameOrigin|verifyCronRequest|authorizeCronRequest|isAuthorizedCronRequest)\b",text)))
    methods=re.findall(r'export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b',text)
    route='/'+'/'.join(path.parts[2:-1])
    for method in methods:
        status='Pendiente de herramienta/recorrido específico; no atribuir cobertura por existir el endpoint'
        if '/cron/' in route:status='Infraestructura programada existente; no se expone como permiso privilegiado al modelo'
        elif '/api/operational-actions/' in route:status='Transporte JSON de Coordinación, estado de tarea y tres acciones de políticas originales de UI; Fronti conserva su adaptador nativo'
        elif route in ['/api/fronti','/api/asistente']:status='Transporte de Fronti; misma sesión, no una acción delegable adicional'
        elif '/auth/' in route or '/session/' in route:status='Autenticación/sesión nativa; Fronti no puede fabricar credenciales ni sesión'
        api_rows.append(f"| `{method} {route}` | `{path}` | {', '.join(services) or 'Implementación/lector en la ruta'} | {', '.join(controls) or 'Revisar autorización contextual de la ruta'} | {status} |")
api_section='\n## Inventario adicional de rutas HTTP\n\n'+str(len(api_rows))+' métodos detectados. Los controles de esta tabla son referencias de código, no una acreditación de seguridad. Las exportaciones, adjuntos y lecturas deben validarse con el mismo alcance de usuario antes de conectarlas. No se activa ningún cron por inventariarlo.\n\n| Entrada | Archivo | Servicios existentes | Controles detectados | Cobertura de Fronti |\n|---|---|---|---|---|\n'+'\n'.join(api_rows)+'\n'
delegations='''
## Delegaciones del ejecutor existente

| Entrada privada | Servicio | Identidad / permiso | Alcance y controles | Evidencia |
|---|---|---|---|---|
| `/delegar JSON` | `createDelegation` → `prepareFiniteExecution` | Sesión actual, acceso Fronti; autoridad nativa revalidada al ejecutar | Objetivo cifrado; 1–12 acciones/datos exactos; inicio y vencimiento hasta 31 días; no ejecuta ni agenda | Dominio y etapa2-execution; navegador nuevo requiere Compuerta |
| `/usar-delegacion ID` | `executePlan` existente | Sólo propietario y permisos actuales por paso | Una vez por paso; revisiones nativas; no segunda identidad; fallo/estado cambiado detienen resto | Concurrencia, Caja exacta, revocación/pérdida de permisos/segunda aprobación/cambios; etapa2-execution |
| `/revocar-delegacion ID` | `cancelExecution` existente | Sólo propietario | Idempotente; cancela pendientes, conserva efectos y RUNNING puede terminar | Revocación entre pasos y navegador escritorio/móvil |
| `/estado ID`, `/delegaciones` | `readExecution`, página propia | Sólo propietario autenticado | Campos sólo privados; fechas, resultados, alcance y lista limitada a 25 | Privacidad PostgreSQL; navegador revisa alcance e historial |

Delegaciones finitas con parámetros exactos, sin comodines ni presupuestos reutilizables. No acredita delegación dinámica/autónoma. Mismo ejecutor y tablas, no adaptadores nuevos ni otro motor. Resultado final de la Compuerta nueva en el PR #244.
'''
Path('docs/etapa2/MATRIZ_ACCIONES.md').write_text(preamble+'\n'.join(rows)+'\n'+api_section+delegations)
print(f'{len(rows)} acciones inventariadas; {len(catalog)} adaptadores conectados')
