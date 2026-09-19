# Tablero de situación — Libro Operativo de Recepción

> Estado real del desarrollo. La fuente de verdad técnica es `main` +
> Vercel Production + Neon `production`.

Actualizado: **2026-09-18** · resolución global de conflictos PR **#73**

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
| Simplificación del Libro | `PRODUCTION` | #72 | Inicio deja de ser un segundo Libro y se convierte en ventana operativa |
| Resolución global de conflictos | `PR_ABIERTO` | #73 | Supervisor, Gerencia y Administrador: reconciliación de duplicados, check-outs vencidos, llaves y alertas con notificación global |

## Iteración actual

**Resolver todos los conflictos** · PR **#73**

La acción no oculta avisos. Ejecuta reglas operativas verificables:

1. colapsa estadías activas duplicadas conservando la fotografía PMS más reciente;
2. retira ocupaciones IN_HOUSE antiguas sólo cuando el día PMS más reciente
   identifica de forma unívoca al ocupante vigente;
3. después de la hora límite de check-out (11:00 por defecto), confirma en lote
   las salidas del día o anteriores que siguen pendientes;
4. vuelve a aplicar la única regla canónica de llaves
   (`reconcilePrincipalKeys`) para entregar la principal a huéspedes in-house;
5. recalcula las alertas;
6. registra una novedad de trazabilidad y notifica a todos los usuarios activos.

Una contradicción ambigua —por ejemplo dos reservas distintas IN_HOUSE en la
misma habitación y el mismo día PMS— **no se resuelve inventando**. Permanece
visible y se convierte/actualiza en incidencia crítica para decisión humana.

Además #73 corrige la causa de las duplicidades entre días: una estadía activa de
la misma reserva/habitación/fase se actualiza con el nuevo `businessDate` en
vez de crear una fila paralela.

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
