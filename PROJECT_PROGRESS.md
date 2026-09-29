# Tablero de situación — AROH Central IA · Hotel HW Libertad

> Fuente de verdad técnica: `main` + Vercel Production + Neon `production`.

Actualizado: **2026-09-29** · Fronti proactivo + diagnóstico real · versión candidata **v1.30.0**

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
| Navegación horizontal compacta | `PRODUCTION` | v1.26.0 | Cabecera horizontal sin sidebar de escritorio |
| Jornada operativa canónica | `PRODUCTION` | v1.25.0 | Dashboard/informes siguen el ciclo real de turnos |
| Identidad AROH Central IA | `PRODUCTION` | #187 · v1.26.1 | Producto renombrado transversalmente; dominio se migra después |
| Dropdowns compactos de módulos | `PRODUCTION` | #189 · v1.26.2 | Menús flotantes, tipografía mayor y shell centrado |
| Panel Reportar / solicitar | `PRODUCTION` | v1.26.3 | Drawer global mediante portal; no queda recortado por el header sticky |
| Fronti contextual transversal | `PRODUCTION` | v1.27.0 | Contexto vivo de módulo/sección/filtros/entidad en todas las pantallas autenticadas |
| Fronti proactivo | `PR_ABIERTO` | #196 · v1.30.0 | Señales determinísticas + explicación IA, dedupe, cron y diagnóstico real de proveedores |
| Usuarios ocultos | `PRODUCTION` | #193 · v1.28.0 | Cuenta activa y plenamente operativa, excluida sólo de selectores/directorios |
| Bandeja interna de soporte | `PRODUCTION` | #194 · v1.29.0 | Persistencia en Neon + permisos + estados; SMTP queda como aviso secundario |

## Iteración actual

**AROH 1.30.0** · rama **`feature/fronti-proactive-v1-30-0`** · PR **#196**

Objetivo: completar Fronti proactivo sin convertir la IA en autoridad operacional y corregir el diagnóstico demasiado amplio de Cloudflare.

Incluye:
- barrido transversal de alertas, reservas y señales de observabilidad;
- deduplicación, enfriamiento y límite de hallazgos por ejecución;
- disparadores no bloqueantes + cron de respaldo;
- prueba de inferencia real por proveedor desde Administración;
- distinción `CLAVE_RECHAZADA` vs `ACCESO_DENEGADO` en Cloudflare;
- trazabilidad del origen efectivo de credencial y Account ID;
- cron frecuente aprovechando Vercel Pro;
- política de costo operativo de IA USD 0 preservada.

PENDIENTE antes de Production:
- compuerta completa verde;
- merge a `main`;
- deployment Vercel Production;
- smoke de `/api/health/asistente` y prueba de inferencia real;
- confirmar causa concreta de la degradación Cloudflare antes de tocar la credencial.

## Infraestructura vigente

`rama de trabajo → PR/Compuerta → main → Vercel Production → Neon production`

- Vercel despliega automáticamente sólo `main`.
- No existe staging alojado.
- CI usa PostgreSQL efímero y nunca Neon Production.
- Neon debe mantener una única rama alojada `production`.
- Toda actualización de Production incrementa SemVer.
- El subdominio nuevo se configurará después de estabilizar v1.29.0; no se cambia DNS dentro de este PR.

## Bloqueos conocidos

| Bloqueo | Efecto | Tratamiento |
|---|---|---|
| Neon Free | Protección/retención limitadas | Una sola rama + respaldos externos |
| Despliegues y consumo Vercel | Evitar costo/CPU innecesario pese a Pro | Sólo `main` despliega automáticamente; observar Fluid/cron antes de ampliar procesos |

## Regla de mantenimiento

Cada PR funcional actualiza este archivo en el mismo PR. No mezclar ramas históricas completas; rescatar sólo funcionalidad concreta que no exista en `main`.
