# Tablero de situación — Libro Operativo de Recepción

> Estado real del desarrollo. La fuente de verdad técnica es `main` +
> Vercel Production + Neon `production`.

Actualizado: **2026-09-25** · Relevo secuencial de Recepción + Novedades operativas · versión propuesta **v1.10.8**nto PMS + Llaves físicas · versión propuesta **v1.5.0**

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
| Turnos + transferencia de Caja | `PR_ABIERTO` | #125 · v1.10.8 | Relevo secuencial: saliente cierra; entrante inicia, recuenta Caja y confirma recepción antes de operar |
| ID FNS transversal | `PRODUCTION` | #64 · #67 · #68 | Reservas/RoomStay consolidados por ID FNS |
| Caja unificada | `PRODUCTION` | v1.3.1 | Semántica financiera correcta desplegada | Arqueo contra efectivo esperado; fondo, garantías y saldo operacional separados; Tesorería como transferencia interna |
| PMS / Habitaciones / Reservas | `RETIRADO_RUNTIME` | v1.4.0 | Legado histórico conservado; fuera de navegación, formularios y flujos operativos | Núcleo por habitación e ID FNS desplegado |
| Preparar entrega | `PRODUCTION` | #66 · #67 · #68 | Anulación/retiro cierra participación y evita usuarios activos huérfanos |
| Fronti proveedor/credenciales | `PRODUCTION` | #71 | Groq/vLLM/OpenAI, credenciales cifradas administrables y fallback de entorno |
| Núcleo operativo sin PMS | `EN_DESARROLLO` | v1.5.0 · `refactor/deuda-tecnica-llaves-autonomas-20260923` | Turnos + Novedades + Caja + Llaves + Supervisión | Llaves físicas autónomas; PMS aislado de permisos y flujos operativos |
| Centro de Supervisión | `PRODUCTION` | #91 · v1.2.0 | Turno independiente, tareas, auditorías, medidas e indicadores explicables; desplegado en Vercel Production |

## Iteración actual

**Libro 1.10.8** · PR **#125** · rama **`fix/turno-gate-novedades-operativas`**

Objetivo: convertir el turno en la puerta obligatoria de Recepción y limpiar la
vista Novedades para que muestre sólo gestión humana vigente del equipo.

HECHO en la rama:
- gate de servidor + interfaz: Recepción sólo opera con turno `ACTIVO`;
- relevo secuencial: el saliente conserva responsabilidad hasta cerrar;
- el entrante no puede abrir mientras el saliente siga en curso;
- el entrante abre `INICIADO`, recuenta Caja/garantías y permanece bloqueado
  hasta confirmar la recepción;
- informe imprimible de Caja/entrega-recepción con firmas de saliente, entrante
  y espacio de validación por Erick Herrera o auditor designado;
- Fronti respeta el mismo gate operativo;
- Novedades limita la vista de Recepción a NOVEDAD/INCIDENCIA abiertas creadas
  por recepcionistas; lo resuelto permanece en Historial;
- alertas internas de validación de cierre dejan de contaminar Novedades;
- ayuda y documentación canónica alineadas.

PENDIENTE antes de Production:
- Compuerta completa verde (tipos, regresiones y build);
- merge de #125 a `main`;
- despliegue Vercel del SHA fusionado y smoke de Production;
- validación manual de relevo saliente → entrante en dos cuentas.

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
