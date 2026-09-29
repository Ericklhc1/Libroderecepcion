# Tablero de situación — AROH Central IA · Hotel HW Libertad

> Fuente de verdad técnica: `main` + Vercel Production + Neon `production`.

Actualizado: **2026-09-29** · usuarios ocultos operativos · versión candidata **v1.27.0**

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
| Usuarios ocultos | `PR_ABIERTO` | v1.27.0 · `feature/usuarios-ocultos-v1-27-0` | Cuenta activa y plenamente operativa, excluida sólo de selectores/directorios |

## Iteración actual

**AROH 1.27.0** · rama **`feature/usuarios-ocultos-v1-27-0`**

Objetivo: permitir que Administración marque una cuenta como **Oculta** sin desactivarla ni alterar su rol.

Incluye:
- nuevo campo aditivo `User.hiddenFromSelectors`, predeterminado en `false`;
- checkbox y distintivo **Oculto** en Administración → Usuarios;
- exclusión de selectores generales, responsables, incorporación manual a turnos, Supervisión, Chat nuevo, alarmas individuales/grupales y menciones por `@usuario`;
- conservación de login, permisos, operación propia, historial y trazabilidad;
- conservación deliberada de destinatarios automáticos/globales y de referencias ya existentes;
- regresiones para operación propia, avisos globales y menciones;
- migración `20260929170000_usuario_oculto_operacion`.

PENDIENTE antes de Production:
- compuerta completa verde;
- revisión/merge del PR a `main`;
- despliegue Vercel Production;
- verificación de la migración y comportamiento desplegado.

## Infraestructura vigente

`rama de trabajo → PR/Compuerta → main → Vercel Production → Neon production`

- Vercel despliega automáticamente sólo `main`.
- No existe staging alojado.
- CI usa PostgreSQL efímero y nunca Neon Production.
- Neon debe mantener una única rama alojada `production`.
- Toda actualización de Production incrementa SemVer.
- El subdominio nuevo se configurará después de estabilizar v1.26.3; no se cambia DNS dentro de este PR.

## Bloqueos conocidos

| Bloqueo | Efecto | Tratamiento |
|---|---|---|
| Neon Free | Protección/retención limitadas | Una sola rama + respaldos externos |
| Límite diario de deployments Vercel Free | Puede frenar builds por exceso de despliegues | Sólo `main` despliega automáticamente |

## Regla de mantenimiento

Cada PR funcional actualiza este archivo en el mismo PR. No mezclar ramas históricas completas; rescatar sólo funcionalidad concreta que no exista en `main`.
