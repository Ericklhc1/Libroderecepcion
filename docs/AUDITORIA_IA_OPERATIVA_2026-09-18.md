# Auditoría de IA operativa — 2026-09-18

## Objetivo

Convertir la inteligencia artificial del Libro Operativo de Recepción en una
capacidad transversal y segura del producto, no en un chat decorativo.

Principio rector:

```
estado real + reglas determinísticas -> atención/acciones posibles -> IA interpreta y explica
```

Nunca al revés. La IA no sustituye permisos, máquinas de estado, transacciones,
reglas PMS/FNS ni hechos físicos.

## Baseline encontrado

La plataforma ya tenía una base de IA considerable:

- OpenAI Responses API;
- function tools con esquemas estrictos;
- permisos por herramienta;
- capacidades activables desde Administración;
- consulta de habitación, prioridades y vencimientos;
- propuestas de check-out, recordatorio y multa;
- tarjetas de confirmación firmadas y con expiración;
- memoria personal y memoria compartida del turno;
- clasificación operacional de fallos del proveedor;
- endpoint de salud;
- panel de configuración de Fronti.

Por tanto, el problema no era «añadir un chatbot». El problema era que la
inteligencia estaba concentrada en la interfaz conversacional y varias garantías
necesarias para convertirla en agente operativo todavía no existían.

## Hallazgos críticos y correcciones aplicadas

### 1. Check-out múltiple no era atómico — CORREGIDO

Fronti validaba todas las habitaciones y después ejecutaba cada salida con
transacciones independientes. Si una salida intermedia fallaba, las anteriores
ya habían quedado confirmadas.

Corrección:
- `confirmCheckOutInTransaction` contiene la operación canónica;
- `confirmCheckOut` mantiene el caso individual;
- `confirmCheckOutBatch` ejecuta el lote completo en una sola transacción;
- Fronti usa el batch canónico;
- prueba de regresión demuestra rollback total.

Regla: una acción presentada como lote no puede dejar un lote parcial oculto.

### 2. Confirmaciones ejecutables podían reutilizarse — CORREGIDO

La tarjeta estaba firmada, ligada al usuario y vencía, pero seguía siendo
reutilizable durante su vigencia. Un doble clic o replay podía crear dos
recordatorios o dos multas.

Corrección:
- token v2 contiene nonce aleatorio;
- `AssistantActionReceipt` persiste el nonce consumido;
- nonce único en PostgreSQL;
- una confirmación sólo se puede ejecutar una vez;
- si la operación de negocio falla, el claim se libera para permitir corregir
  el problema y reintentar de forma explícita.

### 3. Prioridades tenían más de una fuente — CORREGIDO

El chat recibía colecciones del dashboard y dejaba al modelo deducir el orden.
La interfaz podía llegar a mostrar un criterio diferente.

Corrección:
- nuevo dominio puro `operational-attention.ts`;
- una sola bandeja determinística de atención;
- el dashboard y la herramienta de prioridades de Fronti leen esa misma lista;
- cada elemento explica razón y siguiente acción;
- la IA tiene prohibido reordenar esa lista.

### 4. IA limitada al pop-up — PRIMERA INTEGRACIÓN APLICADA

Inicio incorpora ahora «Inteligencia operativa»:
- existe aunque OpenAI esté caído;
- muestra condiciones accionables derivadas por reglas;
- enlaza al objeto real;
- permite pedir un briefing de Fronti sin abrir un chat;
- el briefing recibe exclusivamente la bandeja ya priorizada y sólo la resume.

Esto establece el patrón para Habitación, Turno y Supervisión.

### 5. Puesta en cero dejaba memoria de IA — CORREGIDO

La puesta en cero borraba la operación hotelera pero conservaba mensajes,
conversaciones y memorias de Fronti. Eso no es un sistema realmente en cero.

Corrección:
- borra `ai_message`, `ai_memory`, `ai_conversation`;
- borra recibos de confirmaciones IA;
- conserva usuarios cuando `includeUsers=false`;
- la pantalla muestra explícitamente qué memoria IA será borrada;
- prueba específica cubre «cero operativo + usuarios conservados».

## Arquitectura objetivo de IA

### Capa 1 — Motor operativo determinístico

Fuente de autoridad:

```
ESTADÍA + PMS + HABITACIÓN + GARANTÍA + LLAVES + CAJA +
TURNO + PENDIENTES + TIEMPO = ESTADO OPERATIVO
```

Produce condiciones, bloqueos, razones y acciones posibles.

### Capa 2 — Registro de operaciones

Servicios canónicos, transaccionales e idempotentes cuando corresponda.
Toda acción respeta permisos y auditoría independientemente de si la inicia un
botón, una Server Action o Fronti.

### Capa 3 — IA

Puede:
- interpretar lenguaje natural;
- explicar estado y bloqueos;
- resumir;
- proponer prioridades a partir del orden determinístico;
- preparar acciones;
- pedir datos faltantes;
- componer acciones seguras.

No puede:
- inventar hechos;
- saltar permisos;
- confirmar devoluciones físicas por inferencia;
- cambiar reglas de estado;
- ejecutar acciones de riesgo sin confirmación;
- convertir una operación parcial en aparente éxito total.

### Capa 4 — Experiencia integrada

La IA no vive sólo en un chat:
- Inicio: bandeja + briefing;
- Habitación: explicación contextual y acciones posibles;
- Turno: cierre, bloqueos y preparación asistida;
- Supervisión: anomalías, patrones y devolución para corrección;
- formularios: extracción/prellenado asistido donde sea seguro.

## Próxima pasada

1. Extender el motor de atención a garantías, llaves físicas, Caja y cierre.
2. Integrar contexto inteligente en la ficha de habitación.
3. Integrar asistencia de cierre en Turno sin alterar Cierre Operativo V2.
4. Añadir herramientas seguras para incidencias/seguimientos/garantías.
5. Crear trazabilidad explícita «propuesto por IA / confirmado por usuario».
6. Auditar permisos pantalla por pantalla y action por action.
7. Auditar estados imposibles, concurrencia e idempotencia.
8. Auditar UX móvil, accesibilidad y mensajes de error.
9. Auditar PMS/FNS y conciliación completa contra el contrato V2.
10. Auditar despliegue, previews y aislamiento de datos.

## Criterio de release

Nada de esta rama entra a `main` hasta superar:
- Prisma generate/migrate sobre base de pruebas;
- lint;
- TypeScript;
- regresiones;
- build;
- Preview aislado de Production.
