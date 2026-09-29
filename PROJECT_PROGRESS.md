# Tablero de situación — Libro Operativo de Recepción

> Estado real del desarrollo. La fuente de verdad técnica es `main` +
> Vercel Production + Neon `production`.

Actualizado: **2026-09-29** · Ventas por período e inteligencia de conciliación · versión propuesta **v1.25.0**

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
| Turnos + transferencia de Caja | `PRODUCTION` | #125 · #128 · v1.10.9 | Relevo secuencial + gate transversal; saliente cierra, entrante recuenta y confirma antes de operar |
| ID FNS transversal | `PRODUCTION` | #64 · #67 · #68 | Reservas/RoomStay consolidados por ID FNS |
| Caja unificada | `PRODUCTION` | v1.3.1 | Semántica financiera correcta desplegada | Arqueo contra efectivo esperado; fondo, garantías y saldo operacional separados; Tesorería como transferencia interna |
| PMS / Habitaciones / Reservas | `RETIRADO_RUNTIME` | v1.4.0 | Legado histórico conservado; fuera de navegación, formularios y flujos operativos | Núcleo por habitación e ID FNS desplegado |
| Preparar entrega | `PRODUCTION` | #66 · #67 · #68 | Anulación/retiro cierra participación y evita usuarios activos huérfanos |
| Fronti proveedor/credenciales | `PRODUCTION` | #71 | Groq/vLLM/OpenAI, credenciales cifradas administrables y fallback de entorno |
| Núcleo operativo sin PMS | `PRODUCTION` | v1.10.9 | Turnos + Novedades + Caja + Llaves + Supervisión; PMS retirado del runtime operativo |
| Centro de Supervisión | `PRODUCTION` | v1.24.0 · PR #177 | Apertura guiada publicada: pendientes + Caja/garantías + llaves + informes antes de activar el turno |
| Central de Reservas | `EN_DESARROLLO` | v1.23.0 | Bandeja previa a la operación + rol específico, sin duplicar PMS |
| Correo individual | `EN_DESARROLLO` | v1.23.0 | Correo opcional por usuario + preferencias + outbox de novedades |

## Iteración actual

**Libro 1.25.0** · rama **`feat/ventas-periodo-inteligencia-1-25-0`**

Objetivo: sustituir Ventas por canal por una fotografía mensual de **Ventas por período** y convertir el conjunto de informes de Supervisión en un sistema de conciliación cruzada, sin duplicidades ni conclusiones automáticas no demostradas.

Incluye:
- Ventas por período del mes actual como informe de gestión no bloqueante;
- centros de coste y métricas diarias estructuradas;
- cortesías como señal crítica de revisión;
- detección de PDF parcial/truncado sin completar columnas inexistentes;
- conciliaciones internas del propio informe;
- cruces con Formulario de auditoría, Producción por habitación, In House, señales de movimientos PMS, inventario activo del Libro y multas por blancos;
- hallazgos agregados con claves estables para no generar spam;
- recarga mensual idempotente que sustituye la fotografía y reevalúa discrepancias.

PENDIENTE antes de Production:
- PR y compuerta completa verde;
- merge a `main`;
- despliegue Vercel;
- smoke del Centro de Supervisión y parser 1.25.0.

## Infraestructura vigente

Flujo único:

`rama de trabajo → PR/Compuerta → main → Vercel Production → Neon production`

- Vercel está en **Pro**. Los previews siguen desactivados deliberadamente por `vercel.json` hasta disponer de una base de datos aislada de Production.
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
| Vercel Pro sin staging DB aislada | Los previews podrían tocar Production si se habilitan sin separar datos | Mantener previews desactivados hasta disponer de base aislada |

## Regla de mantenimiento

Cada PR funcional actualiza este archivo en el mismo PR. No mezclar ramas
históricas completas: rescatar sólo funcionalidad concreta que no exista en
`main`, reimplementándola sobre Production actual.
