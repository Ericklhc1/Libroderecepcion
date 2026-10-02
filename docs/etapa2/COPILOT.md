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
| Selector reemplazaba responsable/área ausente | Conserva opción actual no disponible y exige selección deliberada para cambiarla | Navegador oculta persona/desactiva área sintéticas y comprueba selección preservada |
| Fallo global del barrido podía mantener exclusiones de detectores anteriores | Cron pasa explícitamente `usePolicyOverrides=false` al recuperar después de un fallo | Contrato cron + PostgreSQL con una política activa que normalmente excluye el registro; aprobados en CI 37019633610 |

Dos revisiones recibidas realmente; sin saldo/coste en créditos consultable. No se pidió una tercera revisión redundante. CI 37019633610 acredita las regresiones nativas. El recorrido de selector/editado aún requiere la CI siguiente; el bot no ha revisado este commit. No se atribuye la implementación a Copilot.
