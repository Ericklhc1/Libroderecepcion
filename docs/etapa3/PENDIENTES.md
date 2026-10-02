# Etapa 3 · lista única de entregas y pendientes

Base comprobada: Production 1.47.1 / d9472e479dabbb2d1e7a4809750c3cc4b7226ebf. No se repite auditoría general. Esta lista no atribuye a Etapa 3 funciones de etapas anteriores ni confunde código preparado con publicación.

## Bloques

1. **Recepción–Housekeeping–Mantenimiento: devolución del resultado** (PR #248, 1.48.0). Publicado en Production (`91cf6df`): resultado nativo, historial, aviso autorizado, continuidad explícita sin cierre automático, formularios invalidados por cambios de contexto, consulta/acciones naturales concretas mediante Fronti existente. No modifica PMS, Caja, llaves, roles o áreas reales. Estado de pruebas y despliegue se registra en la PR; este documento no declara publicación anticipada.
2. **Coordinación completa y custodia de objetos** (PR #249, 1.49.0): aclaraciones sobre el mismo asunto, continuidad existente de Mantenimiento/turnos y registro de objetos olvidados con folio, custodia, responsable, historial, cierre y evidencia. En validación; no declarar publicado hasta Production READY.
3. **Supervisión/gerencia y cierre de recorridos Fronti**: indicadores y fuentes, continuidad y carga, cobertura natural de procedimientos restantes, navegación de escritorio/móvil. Pendiente funcional.

## Pendientes vigentes

| ID | Prioridad / impacto | Requisito pendiente | Motivo / criterio de cierre |
|---|---|---|---|
| E3-01 | Cerrado | Bloque 1 publicado | Production 1.48.0 / `91cf6df`; Compuerta y Chromium 1280/390 aprobados. |
| E3-02 | Alta · coordinación | Cerrar validación/publicación de aclaraciones y continuidad del mismo asunto | PR #249. Reutiliza Coordinación, incidencias, handover y notificaciones; no infiere disponibilidad desde la malla. |
| E3-03 | Alta · custodia | Cerrar validación/publicación del registro de objetos olvidados | PR #249: modelo aditivo, folio global, historial, permisos, concurrencia, responsable y evidencia de cierre. |
| E3-04 | Alta · decisiones | Completar vistas de supervisión y gerencia, carga por persona/área, períodos/cálculos y vínculos a fuentes | Bloque 3. Reutilizar indicadores de Etapa 2, distinguir datos medidos/estimados. |
| E3-05 | Alta · Fronti | Cobertura natural restante y recorridos completos nuevos/modificados | Bloque 3; el bloque 1 sólo acredita sus frases/procedimientos comprobados. Permisos actuales y segunda persona para inspección se conservan. |
| E3-06 | Media · continuidad | Archivar/restaurar una incidencia vinculada comunica aviso específico al área | La vista reconoce archivo y bloquea continuar sin resultado vigente; ampliar notificación específica en estabilización sin borrar historial. |
| E3-07 | Media · comprobación física | Safari/iPhone físico | No hay dispositivo disponible. Chromium con ancho 390 no es equivalente. |
| E3-08 | Baja · presentación | Transiciones/ajustes visuales secundarios | Posponibles sólo si ningún botón/capa/diálogo bloquea la operación. |
| E2-ARRASTRE | Alta · alcance previo | Variantes Caja/llaves/turnos/admin/HTTP, recurrencias HK, comparación completa entre turnos, recuperación supervisada y cobertura natural general | Permanecen abiertos según #247 y docs/etapa2/MATRIZ_ACCIONES.md. No bloquean conexiones independientes. CRON_SECRET ya verificado; no activar reglas reales ni habilitar sobrecostes. |

Conservar colaborador=usuario existente, horas semanales en horas, sin configuración/descuento de descansos y pertenencias/historial aditivos. No habilitar módulos para demostrar funciones. No nuevas reservas, estadías, tarifas o disponibilidad comercial.
