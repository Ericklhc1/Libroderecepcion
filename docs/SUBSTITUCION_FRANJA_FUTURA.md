# Suplencia: próxima franja publicada (borrador aislado)

Fecha: 2026-10-04. Base d72123a. Rama de preparación `codex/aroh-future-handoff-20261005`.

## Estado y puerta de publicación

Esta preparación NO forma parte del candidato visual 1.58.0. No está publicada ni activada. No se cambiaron cron, variables de ejecución, políticas reales, permisos, datos, proveedores ni esquema. No implica autorización para activar reglas. Guardar una nueva versión sigue dejándola en pausa; la variable global existente debe permanecer como estaba.

**Entrega escalonada para conservar rollback:** la escritura y activación de `waitForPublishedSchedule=true` están bloqueadas en el servicio, antes de cualquier transacción. La UI y Fronti no ofrecen esa opción como utilizable. Un guardado normal con false o con el campo ausente conserva el JSON antiguo, sin persistir la clave adicional. El lector exacto de `928f57b` es estricto y rechazaría esa clave incluso con false; por eso no basta con dejar una política nueva en pausa. Se mantiene disponible la vista previa futura de sólo lectura sobre políticas nativas. El motor de espera permanece preparado y cubierto mediante fixtures sintéticas explícitas; esas pruebas no autorizan su activación en esta entrega.

No se borra ni transforma configuración real para volver atrás. Frente a `928f57b` hay cero migraciones nuevas, el esquema y los contratos de cierre/custodia siguen iguales. La reversión conserva la base actual; nunca se restaura una copia antigua para revertir este bloque.

La ventana propuesta y el veto de arrastre HK son decisiones técnicas provisionales pendientes de aceptación final: buscar hasta el inicio civil de hoy+14 días en America/Santiago; conservar indisponibilidad de workDate original y de la franja futura. Si el veto impide arrastre, revisión humana sin cambiar la fecha.

**Puerta pendiente:** tipos/build, suite completa, PostgreSQL 16 en CI desechable y QA visual. PostgreSQL 17 local ya aprobó las 31 pruebas específicas, incluidas cancelación concurrente y deadlock SQL real, y 137 regresiones de servicios afectados; esto no reemplaza la Compuerta del árbol final. Si no se acredita seguridad, dejar este bloque fuera de la release y conservar la brecha explícita.

## Conducta preparada y compatibilidad

- Nueva configuración JSON `waitForPublishedSchedule`, por defecto false para datos anteriores. true exige `requirePublishedSchedule=true`. No migración.
- false conserva la ejecución anterior, incluida intervención sin suplente actual. La simulación humana puede mostrar una franja futura orientativa; no modifica el motor viejo. Las garantías nuevas de revalidación no se atribuyen a PROPOSE legado.
- true: si alguien cumple ahora, respeta el orden explícito; si no, muestra el inicio futuro más próximo y desempata por orden. Sólo FUTURE_SLOT verificable conserva espera. Trabajo cambiado se omite. Sin candidato/franja en ventana, falta de acceso, vigencia insuficiente, conflicto o lectura incompleta requieren intervención visible.
- Esperar no crea run/occurrence/Task/HSK, no asigna, no notifica ni cambia recepción, inicio, workDate, startsAt o plazo. La fila original es el pendiente durable.
- Al llegar una franja el cron existente reevalúa. No reserva una persona, no garantiza una ejecución puntual ni acredita presencia. La continuidad humana de Recepción a las 08:00 no depende del barrido.
- APPLY invoca coordinación o HK nativos; PROPOSE conserva un aviso y deja la asignación humana pendiente. Un éxito por política/tipo/id sigue evitando bucles entre versiones.

## Evidencia y lectura

`domain/substitution-availability.ts` contiene selector puro. `services/substitution-availability.ts` aplica permisos, área, fuente reservada, estado del trabajo, cuenta/membresía, calendario publicado y disponibilidad HK. Slots tienen snapshot de plan, publishedVersion, updatedAt y extremos persistidos. `coverageSlots` conserva jornada base de extensión rechazada/pendiente y excluye turnos extra no aprobados. Ausencias/vacaciones usan dayWindow; LIBRE mantiene la semántica por fecha nativa. No se reintroducen colación ni descanso mínimo.

El DTO contiene momento de lectura, ventana, estado de política, selección orientativa y motivo seguro. No devuelve notas de ausencia ni detalles interárea. Horario propio no concede lectura de equipo; system.configure no concede horarios. La vista previa sólo lee una política del actor y su trabajo accesible.

Interfaz implementada en este bloque: opt-in explícito del editor y resultado de simulación por registro, con nombre/horario/fecha de lectura/vigencia/motivo/siguiente acción/enlace al original. El pendiente permanece en la bandeja nativa. No se han ampliado permisos para mostrar la política privada de otra persona a Recepción.

## Revalidación y concurrencia

La ejecución opt-in bloquea política y obtiene User/Role SHARE; luego Department y ScheduleCollaborator SHARE, grants/delegaciones existentes y fila de trabajo. Roles se mutan con Role UPDATE; calendario con Department→Plan→Collaborator; catálogo con User→Department→Collaborator. Disponibilidad y creación de delegación HK ahora adquieren User UPDATE para proteger también el caso de declaración todavía inexistente.

Se usa READ COMMITTED para **releer después de esperar locks**. Serializable por sí solo puede conservar un snapshot previo a una cancelación que finalizó mientras el ejecutor esperaba el bloqueo. Principal, área, equipo, permisos, calendario y origen se vuelven a consultar dentro del tx; recepción se consulta con ese cliente. Se revalida fecha de expiración/franja antes y después del efecto para que un vencimiento durante la transacción revierta todo.

Cambios de origen entre simulación y tx no consumen occurrence. Un conflicto/deadlock P2034, o un error crudo Prisma P2010 con SQLSTATE exacto 40P01, conserva el pendiente para una evaluación fresca en el siguiente barrido; no hay reintento inmediato ni avance de cursor. P2010 solo, SQLSTATE distinto o códigos ajenos conservan la intervención. PROPOSE opt-in también bloquea/revalida origen antes del aviso. Relevo humano de trabajo iniciado permanece disponible mediante sus servicios nativos; el automatismo opt-in lo excluye.

La recepción/inicio también se infiere del estado canónico, nunca de fechas inventadas: tareas ACEPTADA/DEVUELTA y HK RECIBIDO quedan fuera aunque sus marcas de recepción/inicio sean nulas. La migración de metadatos operativos no rellenó los históricos; DEVUELTA procede de REALIZADA/VALIDADA y conserva la corrección humana. No se reparan ni reescriben registros históricos por esta regla.

## Progreso acotado

Para políticas opt-in, el campo interno `scanPage` codifica un cursor de fila en la ventana ya existente de 100 páginas × 25 filas. Valor 1 = página1/fila0; valor26 = página2/fila0. Guardar una versión reinicia1, por lo que ningún dato anterior se reinterpreta sin la edición opt-in explícita.

- Reanuda después de la última fila leída incluso si se agota presupuesto entre dos esperas
- Las esperas verificadas no necesitan presupuesto de escritura ni run
- El cron opt-in termina la preparación al hallar un efecto listo, reservando tiempo para ejecutarlo
- Límite100 vuelve a1; no queda atrapado en101 mientras el board devuelve100
- Caché sólo dentro de una simulación comparte personas/slots/alcance; el tx de ejecución siempre relee sin caché
- La lectura máxima de2000 slots declara INCOMPLETE, no una falsa «primera franja»

El alcance sigue siendo la ventana accesible del board, que puede ser parcial con más registros; no se promete escanear indefinidamente fuera de ella ni ejecutar a una hora exacta. No se aumentan límites ni frecuencia del cron.

## Verificación realizada y pendiente

Verificación local del 2026-10-04, posterior a las correcciones de estados históricos y recuperación de deadlock, con heap 768 MB:

- Las regresiones nuevas ACEPTADA, DEVUELTA y RECIBIDO fallaron antes del cambio (3/3), confirmando el defecto; después pasan para OVERDUE y UNRECEIVED sin rellenar marcas.
- Con DB explícitamente ausente y config temporal sin dotenv/globalSetup: `tests/substitution-availability-domain.test.ts` (55), `tests/substitution-availability-service.test.ts` (37) y `tests/substitution-automation-simulation.test.ts` (9); total 101/101 correctas en 1,53 s.
- PostgreSQL 17.11 local: datadir y base nuevos exclusivos, host loopback verificado antes de migrar, 105 migraciones existentes aplicadas. `tests/substitution-future-handoff.test.ts`: 31/31 correctas. El servidor temporal quedó detenido al terminar.
- Esa integración usa servicios nativos y Date controlada, sin proveedor real. Cubre espera repetida→aplicar una vez, PROPOSE, novedades/HK, permisos/expiración/revocación, cambios humanos, página 2 detrás de 25 esperas, presupuesto parcial, veto original/futuro HK, cancelación nativa concurrente retenida antes del commit, dos cron simultáneos y preservación completa de tres fixtures históricas recibidas/devueltas sin fechas de recepción/inicio.
- Regresiones PostgreSQL locales: `etapa2-execution`, `coordination`, `housekeeping-work`, `schedules`, `reception-shift-gate` y `legal-terms`; 137/137 correctas. Reejecución junto a las 31 específicas: 168/168, 7 archivos, 29,92 s.
- La nueva regresión induce un deadlock real después de escribir la asignación nativa dentro de su transacción. Falló antes de corregir y después acredita P2010/40P01, rollback íntegro de trabajo/asignaciones/avisos/auditoría/run, política habilitada y cursor conservado, una única tentativa en ese barrido y un solo éxito en el siguiente. Únicamente acorta a 100 ms la detección de deadlock de la transacción víctima para hacer reproducible el cruce; no amplía el timeout de prueba ni el del motor.
- Lint completo aprobado con dos avisos heredados en `alert-engine.ts` y `dashboard.ts`; lint dirigido de los tres archivos reparados sin avisos. `git diff --check`: sin errores.

El primer intento de integración terminó antes de ejecutar pruebas porque el proceso PostgreSQL no persistió entre llamadas. Se repitió manteniendo servidor y prueba en una misma sesión; no fue un fallo funcional de la suite. No se aumentaron timeouts ni se omitieron aserciones.

Pendientes: tipos/build (no ejecutados para evitar repetir agotamiento de memoria), suite completa del árbol final, CI PostgreSQL 16, revisión independiente final de cursor/locks y QA de UI. No se amplió cursor, ventana ni configuración de ejecución durante la corrección histórica. Los resultados locales no sustituyen esas puertas. No hubo commit, push, activación de políticas reales ni tráfico productivo en esta preparación.

## Integración local con UI del 2026-10-05

Se materializó el commit remoto exacto `c040a9be5136e0845f620ec8733195e8df78c7bf`, árbol `ed1f9ca4373522dffa2b391b70bd2d5a5f18b0e0`, verificando hashes de blobs, subárboles y commit. Sobre una copia de trabajo separada se aplicó por tres vías el parche de 22 archivos del motor, cuya base era `d72123a`. No se incluyó el documento de relevo ni se alteraron la rama/carpeta de UI, workflows, activación o datos reales.

La página de automatizaciones se integró sin conflicto. El único conflicto fue `substitution-form.tsx`: se conservaron las etiquetas accesibles vigentes de Trabajo, Condición, Prioridad, Modo y Horario; se añadió el opt-in futuro con su etiqueta accesible, valor inicial false y guardado en pausa. El resto del código del motor conserva los bytes de la preparación revisada.

Validación de esta combinación, con heap 768 MB:
- 324/324 pruebas de UI y motor, 21 suites, sin base de datos.
- 191/191 pruebas PostgreSQL 17.11, 10 suites: integración futura, automatizaciones, coordinación, HK, horarios, barrera de Recepción, aceptación legal, bandejas por rol, atención del asunto y lectores reservados. Base nueva sintética y loopback, 105 migraciones existentes; servidor detenido al terminar.
- Lint completo aprobado con los dos avisos heredados; conflicto resuelto y diff sin errores.

Esta evidencia corresponde a una integración local sin commit ni publicación. No acredita todavía tipos/build, navegador integral, PostgreSQL 16 ni continuidad entre despliegues. Si cambia la base UI, se debe repetir la integración y validar el árbol resultante; no constituye aprobación de la aplicación final ni autorización para activar políticas.

Para verificar esta preparación se acota temporalmente Compuerta a la rama exacta `codex/aroh-future-handoff-20261005`, además de los triggers existentes. En esa rama no se usa caché ni se suben artefactos: la evidencia queda en los logs del mismo job. Se conservan permisos, controles, servicios, variables, Release exclusivo de main y Vercel deshabilitado fuera de main. Este ajuste no activa políticas ni autoriza desplegar; debe retirarse antes de integrar el resultado definitivo en main.
