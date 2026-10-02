# Etapa 2 · propuesta en desarrollo, no habilitada en producción

Base: PR #241 abierto, rama `feat/etapa-1-operacion-conectada`, commit `50fb561eed36586219139f61a6aaa905023ab5a2`. La rama de Etapa 2 es dependiente. Primero se revisa y autoriza humanamente Etapa 1; después se reconcilia/rebasa Etapa 2, se vuelve a ejecutar Compuerta y se autoriza su publicación separadamente. Ningún merge ni despliegue forma parte de esta implementación.

## Uso disponible en la propuesta

- Fronti privado: `Crea una tarea: Revisar filtro de ventilación` registra una instrucción simple completa sin proveedor de IA. `/procedimientos` muestra los adaptadores. Las instrucciones naturales complejas usan el circuito de herramientas existente para preparar el efecto concreto y solicitar autorización.
- Comando técnico exacto: `/ejecutar [{"action":"createTaskAction","fields":{"title":"Revisión sintética","description":"Verificar filtro","priority":"MEDIA","targetType":"PROPIO"}}]`. No usar ejemplos sobre datos reales durante revisión.
- `/estado ID` consulta pasos y resultado propio; `/cancelar ID` cancela sólo los pendientes. Historial privado en `/fronti/procedimientos`. La autorización puntual vence a los 15 minutos. No implica una delegación permanente.
- Reglas y procedimientos: `/coordinacion/automatizaciones`, permiso real `system.configure`. Seleccionar área, responsable, calendario Santiago, plazo, evidencia y lista; guardar en pausa, simular y revisar. No hay presencia inferida del horario.
- Las políticas tienen propietario, versión, caducidad, área, acciones/límites configurados, pausa y revocación. Una tarea generada conserva su copia y clave de ocurrencia. La inspección de procedimientos es independiente del ejecutor. Housekeeping sigue usando sus rutinas, jerarquías y delegaciones nativas.
- Activación futura requiere autorización humana de publicación y `AROH_AUTOMATION_EXECUTION_ENABLED=true` además de habilitar explícitamente cada política. **No establecer esa variable en producción en esta fase**. La ejecución se conecta al cron operativo existente, nunca a GitHub Actions.
- Recuperación: máximo 20 políticas y 25 efectos totales por barrido, presupuesto de 30 segundos (no inicia otra transacción si faltan 15 segundos), 5 ocurrencias por política, 7 días retrospectivos, 25 propuestas por regla por defecto desde un recorrido acotado del tablero autorizado. Fallo pausa y conserva intervención; corregir/habilitar genera versión nueva. No repite ocurrencias confirmadas ni crea avalancha histórica.

## Evidencia y límites

`MATRIZ_ACCIONES.md` enumera todos los exports nativos detectados y señala lo pendiente. El catálogo de 59 adaptadores NO equivale a cobertura funcional completa. Las pruebas concretas y resultados CI se registran en el PR. Pasaron 87 pruebas locales en 13 archivos de contrato/calendario/contexto y regresión de Fronti, además de tipos y lint. La compilación normal quedó bloqueada por la descarga de Google Fonts; la compilación de código con Inter existente local como fixture de prueba sí pasó. No se cambió la tipografía de la aplicación. PostgreSQL no está disponible en este contenedor; integración/migraciones se validan en la Compuerta con PostgreSQL 16 desechable, nunca en Neon production.

Pendientes de aceptación: cobertura natural directa más allá de comandos simples; delegaciones generales con condiciones y límites personalizados; formularios binarios/credenciales y procedimientos no conectados; sustituciones basadas en horarios publicados; resúmenes por turno y métricas históricas completas; restantes variantes y recorridos individuales de Caja/llaves/turnos/admin en Fronti; atomicidad revisión/efecto para todos los servicios; recuperación supervisada de resultados inciertos. No publicar mientras estos criterios de alcance no se hayan resuelto o acotado expresamente.

La referencia de Etapa 1 midió algunas actualizaciones visibles en ~30 s. No se considera aceptable: objetivo de CI sintética <=2 s para respuesta completa de comandos sin IA y <=3 s de actualización visible; el último recorrido incumple ese presupuesto; consultar la evidencia de bloqueo más abajo. Se instrumenta recepción de cabeceras y fin de stream por separado. Safari/iPhone físico continúa pendiente; Chromium con viewport móvil no lo sustituye.

CRON_SECRET no puede acreditarse mediante la conexión de Vercel disponible. No se ha modificado ni leído su valor. Las notificaciones internas y tareas persisten sin push; los comandos exactos y reglas no dependen de IA.

## GitHub y Copilot

Repositorio público por decisión del propietario. Pro y Copilot Pro acreditados por el propietario el 2 de octubre de 2026; no se solicitó nueva prueba. El saldo de 1.500 créditos/0 consumidos es referencia histórica aportada, no saldo leído ahora. Acceso a facturación/saldo no disponible en esta conexión. No se habilita consumo adicional.

Compuerta existente reutilizada: runner estándar ubuntu, PostgreSQL sintético, caché npm, cancelación obsoleta, lint/tipos/migraciones/pruebas/build y navegador. Se añade la base dependiente y retención 7 días. Son capacidades disponibles para repositorios públicos, no beneficios exclusivos de Pro. Protección main conserva PR y check requerido `Regresiones, tipos y build`, 0 aprobadores obligatorios para mantenedor único. No autofusión.

Existen PR de Dependabot; no se mezclan actualizaciones masivas. No se acreditó vía conexión la configuración de CodeQL, secret scanning o push protection; no duplicar configuración sin verificar. Codespaces no es necesario para este bloque. Copilot realizó una revisión del PR #244 (5391944473), con siete hallazgos. Se corrigieron contratos administrativos parciales (estado completo y matriz antes/después explícita), comprobación de revisión en la escritura nativa, principal renovado por efecto, límite de tiempo/efectos, revocación y auditoría transaccionales, evidencia obsoleta y recorridos representativos adicionales. La cobertura individual completa sigue pendiente; las regresiones de estas correcciones pasaron hasta la corrida 37011929221; los cambios posteriores requieren su propia Compuerta. No se atribuye implementación a Copilot. Una revisión observada; coste en créditos y saldo actual no accesibles. No se usa la suscripción como API de Fronti.

Antes de subir: `vercel.json` conserva `git.deploymentEnabled={"**":false,"main":true}`; los workflows examinados no despliegan ramas. Los despliegues listados eran main/Production. No cambios de visibilidad, hosting o datos reales.

## Reversión

Deshabilitar el interruptor de ejecución y pausar/revocar políticas; cancelar pendientes de Fronti y revisar los RUNNING/INTERVENTION en su origen. Revertir código mediante PR humano, conservar tablas/columnas aditivas, auditoría, planes y tareas generadas. No borrar ocurrencias ni ejecutar migración inversa destructiva. Una tarea ya creada, pago o entrega física requiere corrección por su servicio original; cancelar nunca promete deshacerlo. El código anterior puede coexistir con las columnas nuevas por sus valores predeterminados.

## Entrega remota y dependencia

PR dependiente **draft #244**: https://github.com/Ericklhc1/Libroderecepcion/pull/244 . El propietario autorizó reintentar la subida tras el rechazo inicial. Rama remota creada sin desplegar; Vercel listó cero despliegues desde la subida. PR #241 continúa abierto y no se fusionó.

La evidencia cronológica y sus fallos se conservan en `EVIDENCIA.json`. La corrida 37011929221 aprobó migraciones PostgreSQL 16, auditoría crítica de dependencias, lint, tipos, 1380 pruebas (una omisión preexistente) y build. El navegador detectó un bloqueo real: cabeceras POST en 164 ms y pantalla aún en «Guardando…» después de 10 s. Esto incumple el presupuesto visible de 3 s y bloquea publicación. La investigación separa tiempos de servidor, transporte y DOM; no aumenta las esperas para aprobar.

## Desarrollo reproducible (sólo sintético)

`docker compose -f compose.test.yml up -d --wait` inicia PostgreSQL 16 sin volumen persistente, ligado únicamente a localhost. Copiar `docs/entorno.example` a `.env` local y usar la base `libro_test`, usuario `libro` y contraseña ficticia `libro_test` del compose. `TEST_DATABASE_URL` apunta a esa base; `DATABASE_URL`/`DIRECT_DATABASE_URL` pueden añadir `application_name=desarrollo` para distinguirlas del valor de prueba. Generar AUTH_SECRET local de prueba, nunca copiar el de producción. Ejecutar `npm ci`, `npm run db:generate` y `npm run verify`. `docker compose -f compose.test.yml down` descarta el entorno sintético. No se ejecutó Docker en este contenedor porque no está instalado.

`/resumen` ofrece estado dentro del acceso del usuario, fuentes y fechas, con denominador y aviso de paginación; no sustituye el resumen comparativo por turno. Las políticas pueden editarse desde «Preparar nueva versión»: el guardado compara la versión y queda en pausa sin alterar trabajos iniciados.

## Convivencia con reglas existentes

El cron `/api/cron/web-push` ejecuta reglas deterministas con un presupuesto acotado antes de los detectores originales; el cron proactivo mantiene sus tareas previas. Las reglas habilitadas de recepción/vencimiento sustituyen sólo el plazo del área/tipo/prioridad explícitos. No se admiten reglas activas con el mismo alcance y condición. Se reutilizan `workEscalatedAt` y `escalatedVersion` para evitar avisos dobles. Pausar, revocar, caducar o retirar el permiso devuelve el alcance a los detectores originales. Cada efecto verifica política, persona autorizadora, destinatario y versión del origen. Un fallo deja intervención y pausa; no se afirma presencia física ni se asigna autoridad por nivel.

## Administración mediante Fronti

`updateUserAction` exige todos los campos del formulario, incluidos los booleanos explícitos; una edición parcial se rechaza antes de preparar. `updateRolePermissionsAction` exige `permissionsBefore`, `approvalRequiredBefore`, el resultado completo `permissions`/`approvalRequired` y `replacementAcknowledged=REEMPLAZAR_MATRIZ_COMPLETA`. Se verifica el estado previo, se muestra en la tarjeta privada y la escritura nativa comprueba de nuevo la revisión autorizada. Esto conserva la intención y evita borrar valores omitidos. Los cambios de identidad ejecutora continúan prohibidos.

## Límites consultados de GitHub

Consulta del 2 de octubre de 2026: la documentación oficial indica 40 jobs estándar concurrentes para Pro (5 macOS), máximo 6 horas por job, 1 GB de artefactos y 10 GB de caché por repositorio. Esta Compuerta usa un único job Linux con timeout propio de 30 minutos y artefactos sintéticos pequeños retenidos 7 días. Los minutos estándar de repositorios públicos son gratuitos; no se activaron ejecutores grandes, presupuestos ni sobreconsumo. El espacio/consumo actual de la cuenta no es consultable mediante esta conexión.

Fuentes: https://docs.github.com/en/actions/reference/limits ; https://docs.github.com/en/billing/concepts/product-billing/github-actions ; https://docs.github.com/en/billing/concepts/product-billing/github-copilot-billing . La tarifa de Copilot depende del uso y no se convierte la captura histórica de 1500 créditos en un número de revisiones disponibles.

Repositorio público confirmado por la API. El endpoint de configuración de CodeQL no está permitido por el conector; la respuesta del repositorio tampoco expone `security_and_analysis`. Esto no prueba que estén desactivados. No se crea otro workflow de análisis sin saber si duplicaría el default setup.

El recorrido de reglas avanza por páginas y vuelve al inicio al terminar; una pausa/versionado reinicia el cursor, conservando las ocurrencias. El máximo de candidatos no se presenta como cobertura completa. El estado relevante (condición, destinatario, responsable, recepción, vencimiento, estado y siguiente acción) identifica el aviso; cambiar sólo el título no lo repite. Cada intento conserva además la revisión del origen para recuperar una simulación obsoleta.

Las plantillas nuevas generan tareas generales para usuarios que pueden operar ese módulo. Una cuenta exclusiva de Housekeeping no se considera destinatario elegible de una tarea general: utiliza sus rutinas y listas nativas. La unificación de su editor de recurrencias con esta pantalla sigue pendiente; no se genera un motor de Housekeeping paralelo.

## Continuidad ante fallo del bloque nuevo

El cron existente conserva sus trabajos aunque el ejecutor nuevo arroje un error. Devuelve un indicador de error sin contenido sensible y continúa detectores originales, alarmas y push. El barrido respeta también el presupuesto durante la lectura de páginas. Prueba específica: `cron-auth.test.ts`, fallo del motor nuevo sin omitir los trabajos originales. La escritura determinística de Fronti conserva además la instrucción en la conversación privada mediante el servicio de memoria existente, sin llamar al proveedor.

## Qué no se presenta como terminado

59 adaptadores conectados no equivalen a 59 procedimientos acreditados ni a cobertura universal. La matriz incluye 212 Server Actions (incluidas dos envolturas de navegación de UI) y los métodos HTTP encontrados; señala las entradas pendientes. Continúan pendientes las delegaciones generales con importe/cantidad/condiciones de interrupción, suplencias configurables, recurrencias unificadas de Housekeeping, comparación por turno, indicadores completos de cumplimiento/reincidencia y pasos manuales evitados medidos. No hay medición válida de ahorro respecto a Etapa 1 mientras falle el recorrido visible. Las políticas nuevas y sus simulaciones no se han ejecutado sobre datos reales.

## Corrección en validación de actualización visible

Las corridas 37014758151 y 37015341972 acreditaron que el servidor terminaba normalmente y el navegador recibía el resultado y todas las referencias de Flight, pero algunas transiciones quedaban en «Guardando…». Cambiar al Chromium fijado en el lockfile permitió una asignación en 267 ms, pero no resolvió la recepción. No se atribuye una causa interna exacta de React sin reproducción mínima independiente.

Los formularios de Coordinación y cambio de estado de tarea ahora envuelven las acciones originales y redirigen sólo tras éxito a una ruta local permitida, conservando filtros. Los rechazos se devuelven al formulario. Fronti continúa invocando las acciones originales para recibir resultado estructurado. No cambia identidad, transacción, permisos ni mecanismo de notificación. Tres pruebas locales verifican rechazo sin navegación y defensa contra redirección externa; el recorrido real debe acreditar <=3 s por asignación, recepción y resolución antes de considerar corregido el bloqueo.

CI reutiliza `playwright-core` ya fijado en `package-lock.json`; se elimina la instalación adicional de Playwright 1.58.2 fuera del lockfile. La versión de Chromium queda en la evidencia. Las pruebas de navegación no acreditan Safari físico.

La Compuerta 37016248539 aprobó 1384 pruebas (una omisión previa) y build, pero la redirección de Next también se bloqueó. Esa alternativa queda descartada como solución acreditada. El transporte vigente en validación usa `/api/operational-actions/[procedure]` con sólo dos procedimientos: Coordinación y estado de tarea. Exige mismo origen, JSON limitado a 32 KiB y campos explícitos; invoca las acciones originales con sesión/permiso nativos. Devuelve errores de formulario o un destino local permitido. El navegador navega después de recibir éxito, evitando que el resultado dependa de una transición RSC. Esto no crea otra implementación de dominio. Se mantienen los mismos límites de tiempo. El historial privado de Fronti muestra enlace al origen y duración real de cada paso, sin presentarla como ahorro estimado.
