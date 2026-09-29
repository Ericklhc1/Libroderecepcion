# Tablero de situación — AROH Central IA · Hotel HW Libertad

> Fuente de verdad técnica: `main` + Vercel Production + Neon `production`.

Actualizado: **2026-09-29** · adjuntos persistentes de soporte · versión candidata **v1.30.0**

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
| Usuarios ocultos | `PRODUCTION` | #193 · v1.28.0 | Cuenta activa y plenamente operativa, excluida sólo de selectores/directorios |
| Bandeja interna de soporte | `PRODUCTION` | #194 · v1.29.0 | Persistencia en Neon + permisos + estados; SMTP queda como aviso secundario |
| Adjuntos persistentes de soporte | `EN_DESARROLLO` | v1.30.0 | R2 privado + metadatos Neon + acceso autenticado desde la bandeja |
| Adjuntos consultables de soporte | `EN_DESARROLLO` | v1.30.0 | Binarios privados en R2 + metadatos en Neon + acceso firmado desde la bandeja; fallback SMTP |

## Iteración actual

**AROH 1.30.0** · rama **`feat/support-attachments-1-30-0`**

Objetivo: hacer que capturas y archivos de **Reportar / solicitar** sean consultables directamente desde la bandeja sin guardar blobs en PostgreSQL.

Incluye:
- almacenamiento privado en R2 reutilizando la infraestructura existente;
- PUT directo navegador→R2 mediante URL firmada temporal;
- modelo `SupportRequestAttachment` con metadatos en Neon;
- apertura protegida por `support.view` mediante GET firmado temporal;
- bandeja con nombre, tipo y tamaño del archivo;
- inventario compatible con reportes v1.29.0;
- correo sólo como respaldo cuando el archivado directo no resulta;
- el binario archivado deja de duplicarse como base64 hacia Vercel.

PENDIENTE antes de Production:
- compuerta completa verde;
- merge a `main`;
- migración Production;
- despliegue Vercel Production;
- smoke de versión y apertura de bandeja.

## Infraestructura vigente

`rama de trabajo → PR/Compuerta → main → Vercel Production → Neon production`

- Vercel despliega automáticamente sólo `main`.
- No existe staging alojado.
- CI usa PostgreSQL efímero y nunca Neon Production.
- Neon debe mantener una única rama alojada `production`.
- Toda actualización de Production incrementa SemVer.
- El subdominio nuevo se configurará después de estabilizar v1.30.0; no se cambia DNS dentro de este PR.

## Bloqueos conocidos

| Bloqueo | Efecto | Tratamiento |
|---|---|---|
| Neon Free | Protección/retención limitadas | Una sola rama + respaldos externos |
| Límite diario de deployments Vercel Free | Puede frenar builds por exceso de despliegues | Sólo `main` despliega automáticamente |
| R2 backend desde Vercel | HEAD firmado falla por transporte/TLS; no hay jurisdicción autenticada | Mantener gate degradado del Chat; soporte usa subida directa del navegador con fallback SMTP |

## Regla de mantenimiento

Cada PR funcional actualiza este archivo en el mismo PR. No mezclar ramas históricas completas; rescatar sólo funcionalidad concreta que no exista en `main`.
