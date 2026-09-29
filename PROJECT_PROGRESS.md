# Tablero de situación — Central de Operaciones · Hotel HW Libertad

> Fuente de verdad técnica: `main` + Vercel Production + Neon `production`.

Actualizado: **2026-09-29** · jornada operativa canónica + nueva identidad · versión candidata **v1.25.0**

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
| Turnos + transferencia de Caja | `PRODUCTION` | #125 · #128 · v1.10.9 | Relevo secuencial; saliente cierra, entrante recuenta y confirma |
| Recepción guiada + emergencia única | `PRODUCTION` | v1.19.0 | Recepción en cinco pasos, participación compartida y emergencia auto-liberable |
| Caja unificada | `PRODUCTION` | v1.3.1 | Fondo, garantías y saldo operacional separados |
| Núcleo operativo sin PMS | `PRODUCTION` | v1.10.9 | Turnos + Novedades + Caja + Llaves + Supervisión |
| Centro de Supervisión accionable | `PRODUCTION` | v1.24.0 · PR #177 | Apertura guiada y comprobable antes de activar Supervisión |
| Central de Reservas | `PRODUCTION` | v1.23.0 | Bandeja previa a la operación + rol específico |
| Correo individual | `PRODUCTION` | v1.23.0 | Correo opcional por usuario + preferencias + outbox |
| Jornada operativa canónica | `EN_DESARROLLO` | v1.25.0 | Dashboard/informes siguen el ciclo real de turnos |
| Identidad Central de Operaciones | `EN_DESARROLLO` | v1.25.0 | Branding en UI/correos/Fronti; dominio se migra después |

## Iteración actual

**Central 1.25.0** · rama **`feat/central-operaciones-dia-operativo-1-25-0`**

Objetivo: que la operación diaria tenga **una sola fecha canónica** y que la plataforma adopte su nueva identidad sin mezclar todavía la migración de dominio.

Incluye:
- turno operativo abierto → manda `Shift.date`;
- sin turno abierto, último cierre DÍA → misma fecha; último cierre NOCHE → día siguiente;
- Inicio y dashboard de Supervisión consumen esa fecha;
- informes visibles del dashboard limitados a la jornada vigente;
- cierre anterior conservado únicamente como evidencia de apertura;
- parser de PDF robustecido para no confundir fechas de huéspedes/reservas con la fecha del informe;
- identidad visible **Central de Operaciones · Hotel HW Libertad**;
- sin migración de esquema ni datos.

PENDIENTE antes de Production:
- compuerta completa verde;
- merge a `main`;
- despliegue Vercel Production;
- smoke de versión, Inicio, Supervisión e informes diarios.

## Infraestructura vigente

`rama de trabajo → PR/Compuerta → main → Vercel Production → Neon production`

- Vercel despliega automáticamente sólo `main`.
- No existe staging alojado.
- CI usa PostgreSQL efímero y nunca Neon Production.
- Neon debe mantener una única rama alojada `production`.
- Toda actualización de Production incrementa SemVer.
- El subdominio nuevo se configurará después de estabilizar v1.25.0; no se cambia DNS dentro de este PR.

## Bloqueos conocidos

| Bloqueo | Efecto | Tratamiento |
|---|---|---|
| Neon Free | Protección/retención limitadas | Una sola rama + respaldos externos |
| Límite diario de deployments Vercel Free | Puede frenar builds por exceso de despliegues | Sólo `main` despliega automáticamente |

## Regla de mantenimiento

Cada PR funcional actualiza este archivo en el mismo PR. No mezclar ramas históricas completas; rescatar sólo funcionalidad concreta que no exista en `main`.
