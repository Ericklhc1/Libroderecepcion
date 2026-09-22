# Tablero de situación — Libro Operativo de Recepción

> Estado real del desarrollo. La fuente de verdad técnica es `main` +
> Vercel Production + Neon `production`.

Actualizado: **2026-09-22** · Núcleo Novedades + Caja · versión propuesta **v1.4.0**

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
| Infraestructura Production-only | `PRODUCTION` | v1.0.0 | GitHub `main` → Vercel Production → Neon `production`; sin staging alojado |
| Turnos + transferencia de Caja | `PRODUCTION` | #59 · #60 · #66 | Turnos solapados, participación y cierre coherentes |
| ID FNS transversal | `PRODUCTION` | #64 · #67 · #68 | Reservas/RoomStay consolidados por ID FNS |
| Caja unificada | `PRODUCTION` | v1.3.1 | Semántica financiera correcta desplegada | Arqueo contra efectivo esperado; fondo, garantías y saldo operacional separados; Tesorería como transferencia interna |
| PMS / Habitaciones / Reservas | `RETIRADO_RUNTIME` | v1.4.0 | Legado histórico conservado; fuera de navegación, formularios y flujos operativos | Núcleo por habitación e ID FNS desplegado |
| Preparar entrega | `PRODUCTION` | #66 · #67 · #68 | Anulación/retiro cierra participación y evita usuarios activos huérfanos |
| Fronti proveedor/credenciales | `PRODUCTION` | #71 | Groq/vLLM/OpenAI, credenciales cifradas administrables y fallback de entorno |
| Núcleo Novedades + Caja | `EN_DESARROLLO` | v1.4.0 · `refactor/novedades-caja-v1-4-0` | PMS retirado del runtime operativo | Segundo tramo: Novedades + Caja + Llaves como núcleo; PMS pasa a contexto opcional |
| Centro de Supervisión | `PRODUCTION` | #91 · v1.2.0 | Turno independiente, tareas, auditorías, medidas e indicadores explicables; desplegado en Vercel Production |

## Iteración actual

> Estado CI de cierre: contratos PMS retirados del runtime operativo; navegación, Novedades, Caja, Turno, Supervisión, Alertas, Historial y búsqueda alineados con v1.4.0. La última regresión pendiente era únicamente una expectativa de búsqueda textual del caso y ya fue corregida en la rama.

**Núcleo Novedades + Caja v1.4.0** · rama **`refactor/novedades-caja-v1-4-0`**

Objetivo: retirar definitivamente el PMS del runtime operativo. El producto visible
y los servicios del camino crítico quedan centrados en **Novedades + Caja**.
Turno y Supervisión sólo orquestan continuidad, custodia y excepciones. Reservas,
huéspedes, habitaciones, estadías, llaves, importación PMS, gimnasio y conflictos
de ocupación quedan como legado histórico temporal y no participan en registros,
Caja, Inicio, Turno, entrega ni Supervisión.

Garantías nuevas son entidades propias de Caja con contexto libre opcional
(persona, habitación, referencia y fecha objetivo). Los vínculos PMS antiguos se
mantienen nullable únicamente para no destruir histórico y se eliminarán sólo en
una migración de limpieza posterior, después de validar Production.

## Infraestructura vigente

Flujo único:

`rama de trabajo → PR/Compuerta → main → Vercel Production → Neon production`

- Previews nuevos de Vercel están desactivados por `vercel.json`.
- Los previews históricos no son fuente de verdad.
- Neon debe quedar con una única rama `production`.
- No existe staging alojado.
- CI usa PostgreSQL efímero y nunca Neon Production.
- Toda actualización de `main` incrementa SemVer.
- El workflow **Release Vercel Production** verifica versión + SHA + smoke y crea el tag `vX.Y.Z`.

## Bloqueos conocidos

| Bloqueo | Efecto | Tratamiento |
|---|---|---|
| Neon Free | No permite proteger la rama Production y limita retención/historial | Mantener una sola rama y respaldos externos |
| Límite diario de deployments Vercel Free | Puede frenar builds si se acumulan previews históricos | Sólo `main` despliega automáticamente; evitar despliegues innecesarios |

## Regla de mantenimiento

Cada PR funcional actualiza este archivo en el mismo PR. No mezclar ramas
históricas completas: rescatar sólo funcionalidad concreta que no exista en
`main`, reimplementándola sobre Production actual.
