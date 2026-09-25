# Tablero de situación — Libro Operativo de Recepción

> Estado real del desarrollo. La fuente de verdad técnica es `main` +
> Vercel Production + Neon `production`.

Actualizado: **2026-09-25** · Auditoría integral de lógica + UX · versión propuesta **v1.10.10**

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
| Centro de Supervisión | `PRODUCTION` | #91 · v1.2.0 | Turno independiente, tareas, auditorías, medidas e indicadores explicables; desplegado en Vercel Production |

## Iteración actual

**Libro 1.10.10** · rama **`fix/ux-operational-audit-1-10-10`**

Objetivo: cerrar incoherencias detectadas en la auditoría transversal de
procedimientos, botones, lógica, usabilidad e intuitividad.

Incluye:
- gate obligatorio también para Auditor nocturno y coherencia de sus Novedades;
- textos del relevo alineados con el cierre secuencial vigente;
- comunicados obligatorios reactivos en tiempo real y por encima del Chat;
- navegación móvil sin etiquetas truncadas semánticamente;
- formulario de tareas sin vínculos PMS retirados ni multiselección Ctrl/Cmd;
- botones de envío protegidos contra doble envío incluso con `disabled` propio;
- foco de diálogos atrapado y restaurado para teclado/accesibilidad;
- eliminación del refresco duplicado de Chat;
- regresiones y documentación canónica actualizadas.

PENDIENTE antes de Production:
- compuerta completa verde;
- merge a `main`;
- despliegue Vercel del SHA fusionado;
- smoke y revisión de errores de runtime.

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
