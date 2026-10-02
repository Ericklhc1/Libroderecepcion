# Revisión real de Copilot · PR #244

Revisión recibida: https://github.com/Ericklhc1/Libroderecepcion/pull/244#pullrequestreview-5391944473 . Siete hallazgos. Copilot revisó el código; las correcciones fueron implementadas y verificadas por el agente responsable. No se atribuye implementación a Copilot ni se declara revisión de los commits posteriores por el bot.

| Hallazgo | Corrección | Evidencia / límite |
|---|---|---|
| Edición parcial de usuario podía vaciar datos o desactivar la cuenta | Todos los campos y booleanos explícitos; rechazo previo de parciales; revisión autorizada y CAS en acción nativa | Dominio y recorrido PostgreSQL: conserva teléfono/correo/activo; rechaza modificación entre autorización y escritura |
| Matriz parcial podía retirar permisos y aprobaciones omitidos | Matriz previa exacta, resultado completo y autorización explícita de sustitución; revisión bajo bloqueo transaccional nativo | Recorrido PostgreSQL de sustitución y revisión obsoleta; parciales rechazados |
| Principal reutilizado después de revocar permisos | Consulta de identidad/rol vigente antes de cada efecto | PostgreSQL: desactivar al autorizador durante la primera recurrencia conserva una tarea y pausa el resto; corrida 37010590281 aprobada |
| Automatizaciones podían agotar el cron antes de los otros trabajos | Presupuesto de 30 s y 25 efectos; margen para transacción; cron determinista existente; avance justo por políticas/páginas | Rechazo de ejecución con presupuesto agotado; cursor/estado relevante añadidos después, requieren su Compuerta |
| Cobertura insuficiente de los adaptadores | Recorridos nativos añadidos de Caja, llaves, turno, Housekeeping, Equipo, área, usuario y matriz de permisos | **Parcial**: aprobar estos casos no acredita todas las variantes ni los 59 adaptadores; matriz señala pendientes |
| Revocación y auditoría en commits separados | Ambas escrituras dentro de una transacción | Revocación conserva historial y detiene ejecuciones posteriores; sin modificaciones de datos reales |
| Evidencia afirmaba que no existía PR/revisión | PR #244 y revisión real registrados; corridas fallidas y correcciones conservadas | EVIDENCIA.json es histórico; estado más reciente y enlaces a CI en el cuerpo del PR |

Una revisión recibida. Segunda revisión posteriormente recibida sobre 679006890a1818addbb8c6f7efbced651c80716e; detalles al final. El coste en créditos, saldo actual y consumo de otros trabajos no se pueden consultar con esta conexión. La referencia de 1500 créditos/0 consumidos es la captura histórica aportada por el propietario; no se transforma en un número de mensajes o revisiones. No se habilitaron sobrecostes. El agente de programación de Copilot no está expuesto por las herramientas disponibles; no se simula una delegación ni se afirma que se realizó.


## Segunda revisión recibida

https://github.com/Ericklhc1/Libroderecepcion/pull/244#pullrequestreview-5392864566 · 02/10/2026 14:16 UTC. Copilot reconoce seis hallazgos anteriores resueltos. Mantiene pendiente la cobertura individual y añade cuatro observaciones:

| Hallazgo | Cambio preparado | Prueba / estado |
|---|---|---|
| Revisión separada de la escritura | La revisión autorizada entra en acciones nativas. Tareas/novedades comparan el snapshot y escriben con `updatedAt`; llaves/garantías verifican bajo bloqueo de fila; configuración usa transacción y versión | Casos PostgreSQL invocan directamente cada mutación después de modificar su origen; aprobados en CI 37019633610 |
| Edición de política sin versión | Esquema rechaza `id` sin `version`; revocación también compara versión | Dominio y PostgreSQL |
| Selector reemplazaba responsable/área ausente | Conserva opción actual no disponible y exige selección deliberada para cambiarla | Navegador oculta persona/desactiva área sintéticas y comprueba selección preservada; aprobado en CI 37020877716 |
| Fallo global del barrido podía mantener exclusiones de detectores anteriores | Cron pasa explícitamente `usePolicyOverrides=false` al recuperar después de un fallo | Contrato cron + PostgreSQL con una política activa que normalmente excluye el registro; aprobados en CI 37019633610 |

Dos revisiones recibidas realmente; sin saldo/coste en créditos consultable. No se pidió una tercera revisión redundante. CI 37019633610 acredita las regresiones nativas. El recorrido de selector/editado pasó en CI 37020877716; el bot no ha revisado este commit. No se atribuye la implementación a Copilot.


## Tercera revisión recibida · 2 de octubre 15:37 UTC

Revisión 5393737284 sobre d7ee696a, solicitada para el bloque nuevo de delegaciones finitas. Copilot no implementó cambios. Nuevos hallazgos:

- 4167283449: panel Fronti abierto interceptaba casillas en la prueba de políticas. Reproducido en CI 37027400679 y corregido minimizando el panel mediante su botón normal. Sin forzar clics ni ampliar tiempos.
- 4167283512: dos catálogos editables podían divergir. Se comprobó que coincidían y se dejó una sola fuente `src/domain/fronti-action-catalog.json`, importada y validada en ejecución y leída por el generador de matriz. El servidor rechaza discrepancias entre catálogo y handlers al cargar.

Copilot reconoce resueltos versión obligatoria de política y preservación de selección no disponible. Mantiene abiertas revisión atómica, fallback y cobertura. Las pruebas actuales acreditan CAS/bloqueo para los procedimientos detallados en la matriz y recuperación del detector cuando falla el barrido; no acreditan todas las variantes. No se cierran ni descartan esas observaciones por la mera existencia de pruebas parciales. La acreditación general permanece pendiente.

La revocación concurrente idempotente (un solo registro de auditoría) y la espera del resultado correcto en la medición de navegador son correcciones del agente responsable posteriores a la revisión. Nueva Compuerta necesaria. Consumo observado: tres revisiones recibidas; saldo/coste en créditos no consultable. Sin agente de programación ni sobreconsumo habilitado.


## Cuarta revisión y cuota observada

Revisión 5394563088 sobre 0e114e0e: CHECK SQL no admitía autorización DYNAMIC, fin de día inclusivo en dos entradas, enlace de indicadores, revisión atómica y tres recuentos obsoletos. Corregidos en e1e8787; Compuerta 37039196791 aprobó 1424 pruebas y una omisión, migraciones/build/navegador. Publicación 1.47.0 confirmada.

Solicitud 5394647977: Copilot indicó que el solicitante alcanzó su cuota de revisión. No produjo revisión técnica. Cuatro revisiones reales, ningún trabajo atribuido al agente de programación, sin sobrecoste habilitado; saldo/coste en créditos no disponible.

PR #247 recibió revisión automática de **Codex**, 5395154247, distinta de Copilot. Sus dos hallazgos (hash anterior al flujo de incidencia y vaciado de impacto perdido) se corrigieron en e24386c9; se solicitó seguimiento por el cambio material. La compuerta del bloque nuevo sigue siendo obligatoria.
