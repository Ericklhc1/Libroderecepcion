# Tablero de situación — Libro Operativo de Recepción

> Estado real del desarrollo. La fuente de verdad técnica es `main` +
> Vercel Production + Neon `production`.

Actualizado: **2026-09-23** · Desacoplamiento PMS + Llaves físicas · versión propuesta **v1.5.0**

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
| Núcleo operativo sin PMS | `EN_DESARROLLO` | v1.5.0 · `refactor/deuda-tecnica-llaves-autonomas-20260923` | Turnos + Novedades + Caja + Llaves + Supervisión | Llaves físicas autónomas; PMS aislado de permisos y flujos operativos |
| Centro de Supervisión | `PRODUCTION` | #91 · v1.2.0 | Turno independiente, tareas, auditorías, medidas e indicadores explicables; desplegado en Vercel Production |

## Iteración actual

**Desacoplamiento técnico v1.5.0** · rama **`refactor/deuda-tecnica-llaves-autonomas-20260923`**

Objetivo: consolidar el Libro como sistema operativo interno, no PMS. El núcleo
vigente es **Turnos + Novedades + Caja + Llaves + Supervisión**.

HECHO en la rama:
- mapa técnico de dependencias y clasificación ACTIVO / LEGADO AISLABLE;
- modelo aditivo para conteos físicos de llaves por piso;
- servicio de Llaves nuevo que no consulta `RoomStay`, reservas ni PMS;
- restauración de `/llaves` con pisos 4/5/6, búsqueda, filtros, conteo,
  faltantes, sobrantes, extravío, devolución, recuperación y baja;
- permiso `key.inventory` para Recepción/Supervisor/Auditor nocturno;
- retirada de `pms.import`, `room.manage` y `guest.manage` de roles operativos;
- retirada del reconciliador PMS de llaves desde la Central de ayuda;
- documentación canónica actualizada.

PENDIENTE antes de Production:
- compuerta completa (Prisma migrate/validate/generate, lint, TypeScript, tests, build);
- corregir cualquier regresión detectada;
- verificar que el deployment validado corresponda exactamente al SHA aprobado;
- no migrar ni publicar Production hasta que la compuerta esté verde.

La limpieza física de tablas PMS sigue fuera de alcance: conserva histórico y
requiere una fase destructiva separada con autorización explícita.

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
