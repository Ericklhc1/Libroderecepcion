# Tablero de situación — Libro Operativo de Recepción

> Estado real del desarrollo. La fuente de verdad técnica es `main` +
> Vercel Production + Neon `production`.

Actualizado: **2026-09-18** · simplificación operativa PR **#72**

## Estados canónicos

| Estado | Significa |
|---|---|
| `PENDIENTE` | Todavía no diagnosticado o implementado |
| `EN_DESARROLLO` | Bloque activo; puede tener varios PR |
| `PR_ABIERTO` | Cambio funcional esperando compuerta/merge |
| `PRODUCTION` | Está en `main`, desplegado y comprobado en Vercel |
| `BLOQUEADO` | Detenido por una causa externa concreta |

## Estado por bloque

| Bloque | Estado | Iteración / PR | Nota |
|---|---|---|---|
| Infraestructura Production-only | `PRODUCTION` | — | Vercel despliega automáticamente sólo `main`; Neon mantiene una única rama `production` |
| Turnos + transferencia de Caja | `PRODUCTION` | #59 · #60 · #66 | Turnos solapados, participación y cierre coherentes |
| ID FNS transversal | `PRODUCTION` | #64 · #67 · #68 | Reservas/RoomStay consolidados por ID FNS |
| Caja unificada | `PRODUCTION` | #63 · #67 · #68 | Arqueo, garantías y cierre formal integrados |
| Habitaciones + Reservas | `PRODUCTION` | #64 · #68 | Núcleo por habitación e ID FNS desplegado |
| Preparar entrega | `PRODUCTION` | #66 · #67 · #68 | Anulación/retiro cierra participación y evita usuarios activos huérfanos |
| Fronti proveedor/credenciales | `PRODUCTION` | #71 | Groq/vLLM/OpenAI, credenciales cifradas administrables y fallback de entorno |
| Simplificación del Libro | `EN_DESARROLLO` | #72 | Primer tramo: Inicio deja de ser un segundo Libro y se convierte en ventana operativa |

## Iteración actual

**Simplificación del Libro — tramo 1: Inicio** · PR **#72**

Objetivo: reducir carga cognitiva sin esconder capacidad.

Inicio queda limitado a:

1. estado y acciones del turno;
2. cuatro indicadores accionables;
3. una única bandeja **Atención ahora**, priorizada por reglas determinísticas.

Se retiran de Inicio las listas duplicadas de tareas, incidencias, alertas,
seguimientos, últimas novedades y entregas. El detalle sigue disponible en el
Libro y en las vistas especializadas. El backend deja de consultar datos que
sólo alimentaban esos bloques.

Siguiente tramo después de #72: revisar la propia pantalla `/libro` para
reducir filtros simultáneos, enlaces especializados y opciones que no aporten
al flujo diario, sin eliminar acciones ni trazabilidad.

## Infraestructura vigente

Flujo único:

`rama de trabajo → PR/Compuerta → main → Vercel Production → Neon production`

- Previews nuevos de Vercel están desactivados por `vercel.json`.
- Los previews históricos no son fuente de verdad.
- Neon debe quedar con una única rama `production`.
- Netlify no forma parte del flujo activo. Sólo puede usarse manualmente si
  existe una base aislada; nunca contra Neon Production.
- Production verificada antes de #72: `main@6d7d48843e087b95f831ae0d9b5a9d77a26b0406`.
- El workflow **Respaldo Vercel Production** volvió a operar correctamente:
  verifica SHA, smoke test y crea un tag recuperable.

## Bloqueos conocidos

| Bloqueo | Efecto | Tratamiento |
|---|---|---|
| Neon Free | No permite proteger la rama Production y limita retención/historial | Mantener una sola rama y respaldos externos |
| Límite diario de deployments Vercel Free | Puede frenar builds si se acumulan previews históricos | Sólo `main` despliega automáticamente; evitar despliegues innecesarios |

## Regla de mantenimiento

Cada PR funcional actualiza este archivo en el mismo PR. No mezclar ramas
históricas completas: rescatar sólo funcionalidad concreta que no exista en
`main`, reimplementándola sobre Production actual.
