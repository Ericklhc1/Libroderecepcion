# Tablero de situación — Libro Operativo de Recepción

> Estado real del desarrollo. La fuente de verdad técnica es `main` +
> Vercel Production + Neon `production`.

Actualizado: **2026-09-25** · Production **v1.10.8** · auditoría funcional global en curso

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
| Turnos + transferencia de Caja | `PRODUCTION` | #125 · v1.10.8 | Relevo secuencial: saliente cierra; entrante inicia, recuenta Caja y confirma recepción antes de operar |
| ID FNS transversal | `PRODUCTION` | #64 · #67 · #68 | Reservas/RoomStay consolidados por ID FNS |
| Caja unificada | `PRODUCTION` | v1.3.1 | Semántica financiera correcta desplegada | Arqueo contra efectivo esperado; fondo, garantías y saldo operacional separados; Tesorería como transferencia interna |
| PMS / Habitaciones / Reservas | `RETIRADO_RUNTIME` | v1.4.0 | Legado histórico conservado; fuera de navegación, formularios y flujos operativos | Núcleo por habitación e ID FNS desplegado |
| Preparar entrega | `PRODUCTION` | #66 · #67 · #68 | Anulación/retiro cierra participación y evita usuarios activos huérfanos |
| Fronti proveedor/credenciales | `PRODUCTION_PARCIAL` | v1.10.7 · FRONTI alpha.7 | Groq 120B/20B operativos; Cloudflare Workers AI configurado pero health devuelve `CLAVE_RECHAZADA` |
| Núcleo operativo sin PMS | `PRODUCTION` | v1.10.8 | Turnos + Novedades + Caja + Llaves + Supervisión; PMS retirado de navegación, con rutas profundas históricas aún pendientes de cierre definitivo |
| Centro de Supervisión | `PRODUCTION` | #91 · v1.2.0 | Turno independiente, tareas, auditorías, medidas e indicadores explicables; desplegado en Vercel Production |

## Iteración actual

**Production:** Libro **v1.10.8** · commit `dfc62015a338f938e9b4606a706c901dbc18abef`

La iteración v1.10.8 quedó completada y verificada:

- Compuerta verde;
- PR #125 fusionado a `main`;
- Vercel Production `READY`;
- health de versión en v1.10.8 con SHA correcto;
- relevo secuencial y gate operativo de Recepción desplegados;
- Novedades operativas limpias desplegadas;
- informe de Caja entrega/recepción desplegado;
- tag `v1.10.8` creado por el workflow de release.

**Auditoría funcional global 25-09-2026**

Se revisaron 44 páginas autenticadas, 36 rutas API, 39 módulos de acciones,
56 servicios, 55 componentes y 93 suites de pruebas. El informe vive en
`docs/AUDITORIA_FUNCIONAL_GLOBAL_2026-09-25.md`.

Próximo bloque propuesto: **v1.10.9 — Higiene P0**.

- cerrar definitivamente rutas PMS profundas;
- resolver Cloudflare Workers AI;
- corregir terminología ambigua de bajo riesgo;
- no añadir módulos nuevos antes de completar la simplificación.

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
