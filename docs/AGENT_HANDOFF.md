## 2026-10-08 · AROH 1.65.0 · Novedades simples y lectura central por área

Segunda parte del bloque UI/UX; depende del PR #281 (estilo y densidad 1.64.1). Se parte de bb5dc117 y se incorporan las correcciones P2 de ese PR. No merge ni despliegue.

`book.simpleNovelties` en Administración → Parámetros → pruebas está apagado por defecto y sólo Sysadmin puede cambiarlo; la escritura conserva auditoría y reinicia la revisión final de relevos pendientes si cambia el modo. Activado: una planilla Fecha/Recepcionista/Reserva/HAB/Área/Novedad/Seguimiento/Estado, más bloque interno de Recepción, en el mismo OperationalEntry. El área relacionada ve la novedad en Housekeeping o Coordinación sin crear tareas, recepciones individuales ni cadenas de asignación. La modalidad simple bloquea las asignaciones por los servicios antiguos también. Resolver reutiliza changeEntryStatus con revisión vigente, auditoría y barreras nativas de trabajos pendientes; se permite a cualquier recepcionista aun sin turno activo. La revisión final de entrega y recepción usa una confirmación global «Estoy al tanto de las novedades», incluso sin urgentes. Caja/custodia se conservan. Apagado: permisos y recorrido anteriores.

Toda lectura directa de OperationalEntry en producción usa readEntries en entry-visibility.ts, que añade la política bajo AND sin permitir que un OR del consumidor la sustituya. Las consultas SQL, fuentes de tareas/alertas/seguimientos/alarma/auditoría/avisos y recepción comparten esa política y las vistas de procedencia ya presentes desde #279. Se reaprovecha ocultación por áreas y selección de resumen; autor, Supervisión y Sysadmin mantienen las excepciones explícitas, con revisión/auditoría para configurar visibilidad. Se verifican membresías adicionales, reaperturas, destinos y urgentes del relevo. Los barridos internos se limitan a motores existentes y filtran por receptor antes de entregar contenido. El guardia AST falla ante lecturas directas, alias, SQL sin política y barridos fuera de sus archivos autorizados; incluye casos que demuestran el fallo del guardia.

Sólo migraciones aditivas: reservationReference TEXT opcional y receptionInternal BOOLEAN DEFAULT false. No se crea PMS ni se alteran novedades existentes. El marcador interno está protegido para que editar etiquetas no cambie privacidad; los destinos/asignaciones preservan acceso. Las migraciones se aplicaron sólo al PostgreSQL local sintético.

Validación inicial: 128 casos de visibilidad recuperados aprobados; 7 pruebas nuevas de modo simple y guardia aprobadas; 77 de relevo aprobadas, incluida confirmación global. Lint/typecheck aprobados y build aprobado; se ejecuta npm run verify nuevamente sobre el código final. El navegador 1280/390 de la modalidad simple y la Compuerta/revisión Codex quedan pendientes hasta registrar resultado terminal; no atribuirles aprobación por esta nota.

## 2026-10-05 · Revisión focal Equipo del candidato b76e807

Se reprodujo una pérdida de identidad al reutilizar el `@usuario` de la plantilla CSV en una malla con fechas en columnas: el prefijo literal de seguridad quedaba en el lector de cuadrícula y el identificador resultaba nulo. Se aplica la misma normalización ya usada para filas por asignación, conservando la protección del archivo descargado y la revisión exacta por cuenta.

Validación local de esta corrección: regresión roja antes del cambio; 63 pruebas SSR/dominio en siete archivos aprobadas después, lint focal y `git diff --check` aprobados. La validación serial en PostgreSQL sintético aislado aprobó 62 pruebas de horarios y seguridad administrativa, incluido el caso nuevo con homónimos y aplicación a la identidad correcta. El servidor desechable quedó apagado al terminar. Selector/URL/menús revisados estáticamente y mediante SSR/dominio; elegibilidad, cobertura y orden User → Department → Collaborator cubiertos además por las regresiones PostgreSQL citadas, sin otro defecto acreditado. No se ejecutaron navegador, build ni tipos globales en este worktree; no se tocaron personas, permisos ni datos reales.

## 2026-10-05 · revisión focal de métricas y resumen de turno

Sobre candidato local `b76e8079fbe879733831d2858e61c91e3ba747c2`, sin publicación. El resumen reconoce `CUMPLIDO` como final, distingue resultado vigente, pendiente de revisión e intento histórico conservado, y no presenta la fecha de cancelación HK como resultado exitoso. Se mantiene la evidencia original y sus enlaces; no se cambia estado, escritura ni acceso de ningún objeto.

Indicadores propaga la exactitud del conteo de identidades del tablero a la carga por área y al texto visible. La consulta de eventos se declara parcial cuando las fuentes exceden la muestra de diez páginas, aunque la lista de eventos sea corta. `EN_ESPERA` cuenta como nuevo bloqueo nativo sólo al entrar a ese estado; actualizar una espera existente no duplica el evento.

Reproducción previa: cinco fallos de aserción y ocho casos verdes. Dos defectos de resumen reproducidos con PostgreSQL 17 efímero y fixtures sintéticas; cancelación con dominio puro; límites y bloqueo con el servicio real y Prisma/tablero simulados. Regresión final: 58/58 en siete archivos, incluyendo reserva/HK, permisos de evidencia, 31 excepciones/205 arqueos, paginación, períodos 7/30/90, fechas `@db.Date`, monedas y fechas faltantes. Lint focal, `git diff --check` y sintaxis TS/TSX correctos. PostgreSQL detenido y confirmado. No se ejecutó navegador, Next/build ni chequeo semántico global de tipos; requieren la validación conjunta del SHA integrado. No se amplían permisos, muestras, esquema, proveedores ni políticas.

## 2026-10-05 · F15: aislamiento y ciclo de vida de borradores

Revisión local sobre b76e807. Se reprodujeron con React real y jsdom seis defectos: editar un borrador obsoleto cambiaba su revisión; reutilizar el formulario entre entregas/actores conservaba campos y checks; una nota sin borrador no mostraba la nueva revisión guardada; el éxito recibido después del desmontaje dejaba el borrador recuperable. Caja y nota remontan según identidad/entrega/revisión. La revisión original se conserva al editar; sólo el resultado exitoso descarta su snapshot, sin borrar escrituras posteriores durante pending. Un formulario reemplazado por revalidación vuelve a los defaults del registro confirmado. Cantidades/notas siguen siendo los únicos campos persistidos; no cambian servicios, permisos ni operaciones.

Verificación focal: 11 escenarios de `scripts/ui/form-draft-repro.mjs`, los 14 grupos existentes de `shift-dialog-repro.cjs`, 14 pruebas de dominio/contrato y lint focal aprobados. El renderer usa el jsdom de QA existente mediante `AROH_JSDOM_MODULE`, sin dependencia nueva, servidor, navegador ni base. No se ejecutaron tipos/build/suite integrales ni UI auténtica; corresponde acreditarlos sobre el conjunto final. El recorrido de navegador F15 añade navegación entre entregas/Back/Forward, cambio entre dos participantes autenticados en una pestaña, revisión obsoleta conservada al editar/recargar, notas aisladas y descarte tras éxito antes de recargar. Reutiliza Next/fixture/Playwright de CI, sin respuesta fabricada; la navegación documental complementa la reutilización de componentes probada por el renderer. Sus tres contratos estáticos no acreditan recorrido de navegador.

## 2026-10-05 · Botonera y paleta compactas, preparación local sobre 1.58.1

Base local e33cbc57871ad2fcb0f8e5a7c2215e0e450a751b, árbol 456a61465ddf8f917c74e61ce59306dd65f5b926 idéntico a Production fdf8682a92e3fa3fbec3342c9d301c10507d6f22. Sin publicación, cambio de versión ni despliegue.

La cabecera usa un azul acuarela apagado con tokens claro/oscuro; botonera y acciones destacadas usan el azul oscuro existente. El acento del logo, los estados semánticos y la fuente vigente se conservan. `Button.gold` mantiene su API y pasa a representar énfasis azul oscuro, sin cambiar acciones ni estados. Nueva novedad hereda ese componente a través de Dialog; el lanzador de turno guiado ahora también usa Button y el acceso Aplicar del resumen operativo usa la misma paleta.

Operación pasa de 30 enlaces visibles al abrir a 8 accesos de módulo, manteniendo sus 26 URLs únicas. `secondaryDestinations` deduplica href exacto sólo en presentación sobre el catálogo ya filtrado por servidor; no modifica permisos, consultas, anclas ni rutas. Vistas secundarias se montan bajo demanda; sin megatarjetas estiradas ni sublinks que repitan el título. Móvil conserva la botonera inferior y un único disparador Más, mientras la cabecera muestra contexto. La propiedad activa sigue junto al logo sin un selector inerte. Perfil, apariencia, salida, búsqueda, ayuda, reportes, campana, chat y Fronti mantienen acceso.

Inicio agrupa las cuatro vistas de Coordinación en un desplegable y retira Abrir Libro del encabezado de Atención ahora, pues su indicador enlazado conserva ese destino. Acciones de turno, datos, indicadores y enlaces contextuales permanecen. No se modifican registros, servicios, formularios operativos, roles, dependencias, variables ni migraciones.

Verificación local: 103 pruebas focales aprobadas en navegación, sidebar, presentación, Inicio, shell, alineación y apariencia; lint focal y análisis sintáctico TS aprobados; compilación del bundle de componentes y CSS aprobada. Contraste de texto/acciones AA y foco 3:1 en ambos temas. El recorrido Chromium aislado está preparado en `scripts/ui/compact-navigation-isolated.mjs` con datos sintéticos y sin Next/DB; el ejecutor impide arrancar Chromium por socket() EPERM incluso con sandbox activado. No se acredita recorrido visual/teclado real. El script admite `NAV_QA_BUILD_ONLY=1` y `NAV_QA_OUTPUT` para generar una muestra autocontenida. Los recorridos integrados existentes de navegación y transporte se adaptaron para abrir Vistas explícitamente.

Pendiente antes de publicación: revisión visual 1280/1024/390/320 en claro/oscuro, teclado, Escape/Tab, ancho móvil, anclas, Back/Forward y borrador Fronti; luego lint/tipos/suite/build/recorrido integrado de Compuerta sobre el SHA final. No ejecutar build ni tipos globales en este ejecutor limitado; no usar Production para pruebas operativas. Incrementar versión únicamente al preparar una publicación autorizada.

## 2026-10-05 · Hotfix de mantenimiento temporal sobre 1.57

Base aislada 928f57b. Control formal `/admin/mantenimiento` respaldado por `SystemSetting system.maintenance`, exclusivo de la identidad SYSTEM_ADMIN verificada. Cambio/auditoría atómicos con revisión y recuperación de estado inválido; mensaje solicitado fijo. Guardas de páginas y Server Actions, wrapper en todos los métodos API salvo versión/disponibilidad pública, cuatro cron y callbacks/servicios automáticos. No migración ni cambios en roles, usuarios, contraseñas, turnos o registros hoteleros.

Validación local: 243 pruebas PostgreSQL sintético aprobadas en 16 archivos, incluidas 121 del control/cobertura; lint focal sin errores y análisis sintáctico sin errores. Tipos integral y focal excedieron la memoria del ejecutor; no se repiten ni se atribuye aprobación. Build y recorrido de mantenimiento desktop/móvil pendientes de CI del SHA final. La rama dispone de CI exclusiva sin caché, artefactos ni publicación; verificar resultado terminal antes de cualquier despliegue.

La fila compartida sólo protege artefactos compatibles. Clientes/URLs antiguos y Skew pueden seguir atendidos por código sin control; no afirmar congelación global. Solicitudes ya iniciadas pueden terminar. Procedimiento de activación, drenaje, continuación en 1.58 y reversión compatible en `docs/MODO_MANTENIMIENTO.md`. El commit funcional debe portarse a 1.58 sin importar el bump 1.57.1 ni el workflow de esta rama. No se activó mantenimiento ni se publicó producción durante la implementación.

## Revisión 39d35f8 · resultado del asunto y diagnóstico UI

Se limita el retorno vigente a tareas de atención canónica; una tarea ordinaria más reciente no reemplaza ni oculta ese resultado. Los pilotos HK no son atención activa ni resultado operativo, incluso para Administración. La Compuerta 37189799724 aprobó 1535 pruebas + una omisión y build; navegador encontró selector de primaria antiguo, lecturas de respuesta tras navegación y transición HK sin confirmación visible. Los dos primeros se corrigieron; HK registra revisión del formulario/DB y estado visible ante fallo para determinar la causa sin ampliar tiempos ni simular acciones.

## Compuerta 37189452895 · correcciones de regresión

1520 pruebas correctas, una omisión heredada y dos expectativas obsoletas: relevo compartido todavía esperaba contenido privado para su autor; polling esperaba updateMany en la ruta tras extraer el servicio canónico. Se actualizaron conservando las comprobaciones de aislamiento y evidencia persistida. Búsqueda reservada medida en 48/16 ms (antes 4–8 segundos), sin desactivar JIT ni ampliar tiempos. Se extendió el filtro OPERATIVO a indicadores e informes compartidos, con regresión dedicada. Nueva Compuerta requerida.

## Continuación 2026-10-04 · revisión de Etapa 4

Production 1.53.0 verificada en 907ed8b. Compuerta main 37188694284 y Release 37189100571 correctas. Los bloques 2–5 siguen sin publicar.

Correcciones en preparación: reserva canónica en listas/contadores, lectura compartida de relevos históricos, marcar únicamente avisos visibles, bloqueo de orígenes al asignar tareas, conservación del resultado hasta validación y resultado explícito firmado en Fronti. Housekeeping reabre por su transición nativa con permisos y auditoría idempotente; permite otra área tras terminar. Se implementó regularización exclusiva de Administración para vínculos piloto: confirmación y motivo, bloqueo del origen, copia de su contexto, auditoría anterior/posterior y evento con folio original. El piloto conserva isDemo, estado e historial. No se ejecutó esta reparación sobre producción.

Tipos locales correctos; nuevas regresiones PostgreSQL pendientes de Compuerta. No se ha usado base de producción para pruebas. Revisar todos los hallazgos de PR262–265 antes de publicar. Los bloques 3–5 también corrigen contexto de ubicación Fronti, navegación Avisos/HK, búsquedas y enlaces de Coordinación/Supervisión. Regresiones nuevas cubren regularización del piloto, reserva al marcar avisos, resultado firmado de Fronti y reapertura HK.

## 2026-10-04 · bloque 2 · búsqueda sin recorrer dos veces la reserva

PR261 integrada como 907ed8b para 1.53.0: Compuerta 37188266171 aprobó 1514 pruebas + una omisión heredada, migraciones PG16, lint, tipos, build y recorridos 1280/390; Codex revisó 49463f9 sin hallazgos importantes (5978051066). La verificación de Vercel y del release main sigue pendiente al escribir esta nota.

PR265 detectó timeout de búsqueda reservada (30 s por cuatro lecturas): cada lectura tardó 7.4–7.8 s, frente a 4.3 s en la CI aprobada de PR261. La CTE ya materializa todos los orígenes, pero invocaba otra vez el predicado transitivo por nodo. Se reutiliza únicamente la regla directa de cada nodo en esa CTE, incluyendo su propia reserva, y se consulta el mismo conjunto para Task/Alert/FollowUp; la eliminación lógica sigue explícita. No se desactiva JIT ni se amplían timeouts. Regresión adicional de búsqueda de seguimiento derivado con ciclo y lector permitido. El navegador espera la primaria visible antes de medir (la evidencia anterior registró 0 antes de render y no constituye una medida válida del número de acciones). Requiere Compuerta y Codex del nuevo SHA.

## 2026-10-04 · regresiones de continuidad y navegador en validación

La comprobación de reserva derivada sólo se aplica cuando hay otro seguimiento de origen; la continuidad propia de Supervisión conserva la asignación nativa (centro-supervision, entrega inalterable). Los seguimientos con origen reservado mantienen validación transaccional de lector, destinatario y visibilidad. El diálogo de estado se cierra/refresca únicamente tras confirmación real. El recorrido de reserva busca por prefijo para no confundir el encabezado «Resultados para…» con una fila oculta. Los fallos se corrigen, no se ignoran ni se amplían timeouts. Nueva Compuerta del SHA final y revisión Codex requeridas; producción sigue 1.52.0.

## 2026-10-04 · PR261 · continuidad derivada, avisos históricos y relevo compartido

Compuerta 37187188272 del SHA ada7b41 aprobó 1510 pruebas, una omisión heredada, PG16, lint, tipos, build y navegador 1280/390. Codex 5404934390 revisó fde30b5: auditoría Fronti ya corregida en d7c47dc; se reparan tres hallazgos restantes. La reserva transitiva incluye seguimientos derivados y ciclos históricos; creación/edición valida responsable y visibilidad dentro de la transacción, antes de auditoría/avisos. Campana, lista, conteos, Fronti y payload push aplican fuente vigente antes de paginar, conservando notificaciones originales. Relevo compartido permite todo OPERATIVO de compañeros y excluye PRIVADO/SUPERVISION. La migración aditiva 20261004080500 sólo actualiza vistas de lectura. Pruebas PostgreSQL cubren rollback, ciclo histórico, cambio de visibilidad, avisos/proactivo, push y relevo; navegador añade Notificaciones. Nueva Compuerta completa y Codex requeridos; producción comprobada 1.52.0/0b05951, sin publicar este bloque.

Bloques posteriores preservados como PR262 (1.54.0, derivación), PR263 (1.55.0, roles), PR264 (1.56.0, Fronti/Avisos) y PR265 (1.57.0, Turno/Caja/Llaves), todos borradores dependientes. Cada uno conserva sólo su funcionalidad adicional sobre los predecesores. Propagar esta corrección a cada rama antes de integrarla; no publicar un SHA anterior por una Compuerta verde. Tipos/lint locales del conjunto 1.57 y del parche aprobados; las pruebas de integración/recorridos de cada PR mandan. Lista única docs/etapa4/PENDIENTES.md.

## AROH Simple · turno, Caja y llaves preparados (1.57.0, sin publicar)

Mi turno prioriza continuar la operación y desplegar entrega cuando corresponde; participantes y tipo de turno quedan en Más. Los estados de recepción, entrega enviada, arqueo y cierre conservan sus formularios y barreras nativas. La continuidad reutiliza las tareas activas y vencidas del briefing nativo, deduplicadas por ID, de modo que un pendiente sin plazo vencido también aparece. Los pendientes muestran responsable, siguiente acción, plazo y, cuando existe, impedimento/resultado esperado; no se cierran por desplegar entrega.

Caja conserva todos sus cálculos, movimientos, garantías, arqueos, auditoría y permisos. La cabecera prioriza ingreso/egreso y garantía, con gimnasio, parking y regularización en Más; primero muestra modo actual y siguiente acción. No se presenta el efectivo esperado como confirmación física. Llaves organiza Inventariar, Entregar/recibir y Resolver excepción manteniendo enlaces anteriores; la vista de excepciones sólo filtra presentación de estados nativos y no afecta inventario físico ni stock privado. Baja y alta avanzada siguen bajo sus permisos en Más; recuperar nunca se declara por abrir/cerrar un diálogo.

Tipos y lint locales aprobados; recorrido de navegador preparado para PostgreSQL desechable en 1280/390 comprueba consulta sin turno, pendientes visibles, salida de diálogos, ausencia de movimiento financiero y de recuperación física ficticia. Todavía no hay evidencia de Compuerta completa, revisión Codex ni publicación. Rebasar únicamente este bloque sobre el anterior publicado, heredando todas las correcciones de reserva de PR261. Sin motor, migración, proveedor ni gasto nuevo. Pendientes únicos docs/etapa4/PENDIENTES.md.

## AROH Simple · intenciones y Avisos preparados (1.56.0, sin publicar)

Fronti interpreta la derivación desde el asunto visible o su folio y prepara el procedimiento finito existente. Pide sólo área o ubicación faltante, muestra contexto humano y exige autorización explícita; la ejecución vuelve a verificar permisos y revisión del origen. No transforma una respuesta del modelo en autorización ni sustituye el procedimiento especializado de HK/Mantenimiento. Solicitudes concurrentes y reintentos conservan una atención; autorizar/cancelar se ofrece únicamente mientras hay pasos pendientes. Comandos, delegaciones y diagnóstico conservan acceso avanzado cerrado por defecto. No se creó un motor nuevo ni se contrató otro proveedor.

Avisos reúne navegación a Recibidos, Recordatorios y Pendientes que continúan sobre notificaciones, alertas y seguimientos existentes; conserva todas las rutas y permisos. Sin migración nueva ni alteración de evidencia. Tipos/lint y regresiones de dominio locales aprobados; pruebas PostgreSQL y navegador 1280/390 preparadas para Compuerta, todavía sin evidencia de aprobación ni publicación. Rebasar únicamente este bloque sobre los predecesores publicados, conservando las correcciones de reserva de PR261. Lista única docs/etapa4/PENDIENTES.md.

## AROH Simple · derivación preparada (1.54.0, sin publicar)

Solicitar atención conserva el asunto y el contexto y utiliza Task o HousekeepingRequest según el área. No repite descripción/habitación ni crea otro motor. Lock del origen, revisión vigente y huella de solicitud impiden duplicados concurrentes; un reintento exacto conserva el mismo trabajo incluso tras derivarlo, y no se declara atención de un área distinta. El resultado actual del área vuelve al origen para revisión manual con permisos nativos; un intento anterior de un asunto reabierto conserva su etiqueta histórica. El solicitante autorizado puede revisar el retorno sin inventarse como ejecutor del trabajo especializado. HK conserva impedimento técnico, vínculo a Mantenimiento, reconfirmación e inspección independiente.

Este bloque fue rebasado con sus commits propios sobre ada7b41 de PR261; no copiar las versiones anteriores de los lectores reservados. Lint/tipos y pruebas PG/navegador deben aprobar sobre la rama final; scripts 1280/390 cubren ambas áreas con responsables reales de fixture y raíz sin dueño, sin transcripción del resultado. Todavía sin PR/publicación ni evidencia PG de este bloque. Tras squash de PR261 rebasar exclusivamente los commits propios desde ada7b41 sobre main. Lista única docs/etapa4/PENDIENTES.md.

## 2026-10-04 · Compuerta d7c47dc: reserva aprobada, fixture transversal corregida

Job 111390932958 aprobó las nuevas rutas de reserva y medición: buscar avisos 8/7 ms, frente a 5672/5677 ms del SHA anterior al ajuste de consulta; auditoría de fixture PG ejecutó 0.74 ms, sin JIT. Son datos sintéticos del runner, no conducta de usuarios. El único fallo fue operational-journey-e2e: su entrada empezaba EN_CURSO sin dueño. La fixture declara al recepcionista saliente como responsable en createEntry, con identidad real del recorrido; el servicio conserva el rechazo de entradas sin responsable. No se ignora la compuerta ni se usa este SHA fallido para publicar. Nueva Compuerta completa requerida.

## 2026-10-04 · PR261: lectores independientes e inicio canónico, sin publicar

Codex sobre c76038f identificó cinco rutas independientes pendientes: estado avanzado de asunto sin responsable, entrega de Inicio, seguimientos eliminados, auditoría y barrido proactivo. Se exige ownerId antes de EN_CURSO y en la escritura atómica; reabrir sin dueño puede dejar ABIERTO. Inicio/desk/briefing sanea filas y fotografía JSON histórica sin modificar originales. Incluir eliminados conserva la reserva histórica. Auditoría aplica origen canónico antes de límites/conteos mediante vista de sólo lectura sobre AuditLog, objetos y sus relaciones; cubre también comentarios, recordatorios y hallazgos proactivos. Fronti consultar_auditoria, contador de Administración e historial de objeto utilizan el mismo predicado; diagnóstico de RuntimeError permanece técnico. Los ciclos de prueba que comienzan atención declaran asignación explícita en su acción nativa. La migración aún no publicada añade esa vista sin tabla ni reescritura de evidencia.

El barrido revalida destinatario activo, permisos y origen antes de reclamar y nuevamente antes de notificar/auditar; bloquea fuente y reserva durante copia transaccional. Pruebas PG nuevas reproducen las cinco rutas, autor permitido, evidencia original y barrido concurrente sin reclamo/aviso para otra persona. Lint/tipos locales y nueva Compuerta completa/revisión todavía requeridos. Lista única docs/etapa4/PENDIENTES.md; Production continúa 1.52.0.

## 2026-10-04 · Timeout reproducido: diagnóstico de recorrido agregado

Compuerta 37186288517 del SHA 1329c961 aprobó los cuatro procedimientos separados, sin aumentar el límite de 30 s ni retirar aserciones; también build y navegador 1280/390. Las lecturas de opciones, historial, Libro, habitación y Supervisión medidas tardaron 8–16 ms; buscar avisos reservados tardó 5672/5677 ms por consulta. El timeout agrupaba varios recorridos, pero la búsqueda presenta una regresión concreta que debe corregirse antes de publicar. Se calcula una sola vez el conjunto de fuentes reservadas con la misma autorización canónica, antes del límite; nueva medición PG requerida. No se aumenta timeout ni se desactiva JIT globalmente. No es evidencia de abandono ni de tiempos de usuarios reales. Las correcciones funcionales de la siguiente revisión Codex requieren Compuerta nueva; no usar este verde para otro SHA.

## 2026-10-04 · PR261: timeout reproducido, publicación retenida

Compuerta 37185505915, jobs 111386487145 y 111387515813, reprodujo en el mismo SHA c76038f un timeout de 30 s en el caso que acumulaba opciones, historial, Libro, dos avisos, Fronti, habitaciones, búsqueda, Supervisión y mutaciones. No hubo un fallo de aserción; esto no demuestra todavía que sea flaky ni un tiempo de respuesta de una pantalla. Se separan los cuatro procedimientos con fixtures independientes, manteniendo todas las aserciones y el límite global. Las lecturas principales registran sólo nombre técnico y duración en PostgreSQL desechable para identificar una regresión de consulta. No se publica hasta Compuerta completa verde y revisión Codex; producción continúa 1.52.0. Lista única docs/etapa4/PENDIENTES.md.

## 04-10-2026 · PR261 · regla de inicio canónica, sin publicar

Codex sobre bf7737c señaló que el selector avanzado podía iniciar una tarea sin responsable y que una alerta archivada todavía impedía reasignar el trabajo activo. changeTaskStatus ahora exige responsable antes de EN_CURSO y compara responsable/estado además de revisión dentro de la escritura atómica; no autoasigna ni cambia permisos. La autorización histórica de destinatarios admite Alert archivada con su misma reserva transitiva. Pruebas verifican servicio y acción avanzada sin efectos, continuación después de asignar, y reasignación nativa/Coordinación sobre cadena con seguimiento y alerta archivados. Las fixtures de transiciones e inspección declaran ejecutor asignado; no se eliminan controles. Requiere nueva Compuerta y revisión por cambios funcionales concretos; no publicado. Lista única docs/etapa4/PENDIENTES.md.

## 04-10-2026 · PR261 · segunda revisión y origen archivado, sin publicar

Compuerta 37183925230 del SHA 21b4e95 aprobó migración compatible, 1500 pruebas (una omisión heredada), lint, tipos, build y recorridos 1280/390. Codex detectó dos ajustes posteriores: asignar a una persona autorizada debe admitir el origen archivado igual que la lectura canónica; el creador sin permiso de asignación no debe recibir Comenzar atención como primaria cuando no hay responsable. Ambas correcciones conservan los procedimientos y permisos existentes. La regresión usa un responsable operativo perteneciente al área real y verifica asignación tanto nativa como en Coordinación. La acción principal ahora espera asignación autorizada; los formularios avanzados existentes siguen sujetos a sus controles. Fronti aplica también la reserva canónica a vencimientos y propuestas por ID conocido. Compuerta y revisión del SHA final pendientes; Production continúa en 1.52.0. No declarar publicado por una validación de un commit anterior. Lista única docs/etapa4/PENDIENTES.md.

## 04-10-2026 · PR261 · correcciones de continuidad y reserva, sin publicar

Compuerta del SHA 21f280d falló al importar un mock incompleto de correo, no ejecutó las pruebas dirigidas del archivo. Se conserva el módulo real y se simula únicamente sendMail. Codex sobre b3ef600 detectó seis hallazgos relevantes: cadena histórica transitiva, origen archivado que ocultaba trabajo activo, recordatorios reservados, borrador histórico al enviar, resultado previo de asunto reabierto y comenzar sin responsable.

Se reutilizan las relaciones existentes mediante vistas SQL de sólo lectura (Prisma 6.19 views): UNION resuelve todos los orígenes sin duplicados y termina ciclos; incluye fuentes archivadas en autorización, sin reescribir evidencia ni crear motor/tabla operativa. Se verifica reserva de recordatorios antes de proyectar, asignar destinatarios y emitir avisos. sendHandover sanea snapshot/correo de borradores antiguos dentro de su transacción; conserva HandoverItem original, niveles y revisión física. Interfaz etiqueta resultado abierto como intento histórico y no ofrece comenzar sin dueño. Migración compatible 20261004070000_fuentes_reservadas_transitivas requiere PG16 desechable; no aplicada a Production. Pruebas nuevas incluyen cadena/ciclo, archivo, recordatorio y envío histórico; navegador 1280/390 conserva las comprobaciones del flujo. Repetir Compuerta y revisión del SHA final antes de integrar. Lista única docs/etapa4/PENDIENTES.md.

## 2026-10-04 · Acceso del dominio general recuperado

`operacionesaroh.app` estaba registrado y verificado en el mismo equipo Vercel, pero ausente de los dominios del único proyecto existente. Se asoció con redirección 308 a `hwl.operacionesaroh.app`; comprobación HTTP del dominio general y versión destino 1.52.0 / 0b05951 aprobadas. No hay proyecto, proveedor ni gasto nuevo. Nueva comprobación en navegador pendiente: sesión rechazó recargar su página de error por política de URL. E4-14 cerrado con evidencia HTTP; no inferir el estado físico de la llave histórica E4-13.

## Bloque 0 publicado · 1.52.0 / 0b05951 / PR260

Vercel dpl_4ox5CpG74v79GRPUB5L8Ni62XwGd READY, health operativo SHA/versión correctos y acta existente carga con historial intacto. Compuerta 37175857595: 1481 pruebas, una omisión heredada, PG16/migración/lint/tipos/build/navegador 1280/390 aprobados. Codex revisó be94c94 sin hallazgos relevantes; corte visual posterior conserva motivos/diffs completos. El acta histórica contiene observación de ausencia pese a confirmación; no se modifica posesión histórica sin verificación física. Dominio general devuelve 502; operativa hwl comprobada. Pendientes únicos E4-13/E4-14 en docs/etapa4/PENDIENTES.md. Continúan los demás requisitos funcionales.

## AROH Simple · bloque 1 preparado (1.53.0, sin publicar)

Fachada de asunto y siguiente acción en detalles de Libro/Tareas; una primaria contextual, alternativas y Más sin overlay. Conserva enlaces, permisos y formularios avanzados. La atención existente prevalece sobre crear otro trabajo; resultado del trabajo visible en su origen. La derivación reutiliza TaskForm con título, contexto, habitación, área, prioridad y plazo heredados. Habitación entra por Registrar / actuar y elige intención humana. Telemetría CLIENT_UI en OperationalMetricEvent, sin migración ni texto de formularios; rol/área vienen de la sesión. PENDING es un recorrido sin resultado observado, no demuestra abandono. Las correlaciones son recorridos de interfaz y no prueban una intención mental ni que dos objetos sean duplicados. Sin datos reales suficientes aún. No se eliminan rutas. Pendientes únicos: docs/etapa4/PENDIENTES.md.

## Bloque 0 · corrección de respuesta visible (en validación)

CI 37174856351 confirmó persistencia de No recibido con confirmed=false, pero el formulario permaneció en Guardando por transición RSC. Se reutiliza el transporte JSON operativo existente para ambas acciones, con origen/campos cerrados, mismas acciones nativas y navegación al acta sólo tras éxito. No se aumenta el timeout ni se sustituye la comprobación visible por recarga manual. Requiere nueva Compuerta y revisión Codex del ajuste funcional.

## Ajustes de revisión del bloque 0 · 1.52.0 (en validación)

Codex detectó seis hallazgos: corrección de No recibido inaccesible, revisor participante sin acceso, cronología antes del lock, palabras largas en móvil, contexto incompleto para Fronti y fixture UI inválida. Se corrigieron sin cambiar permisos ni confirmar posesión. El recorrido incluye corrección después de aprobación y revisor del turno en 390 px. La regresión de coordinación era sensible a medianoche: la prueba ahora respeta el inicio de disponibilidad; no se cambió el plazo operativo. Pendientes únicos en `docs/etapa4/PENDIENTES.md`.

## 04/10/2026 · Etapa 4 · bloque 0 · recepción veraz (1.52.0 preparada)

Base comprobada una vez: 1.51.1 / 163d61c, Vercel READY. Informes de simplificación y auditoría visual consultados. No se fabrica un relevo de otra persona en Production. El código bloqueaba recepción de elementos declarados sin confirmación física y no admitía declarar ausencia.

Nueva excepción sobre HandoverElement existente: No recibido + motivo + responsable; aviso a Supervisión, autorización independiente con tratamiento y conservación de confirmed=false. Sigue bloqueada hasta revisión; no permite autoautorizar, cambiar una entrega recibida ni confirmar bienes ajenos/no declarados. Lock del mismo handover serializa custodia, revisión y recepción; las barreras se vuelven a comprobar dentro del lock. Recuperación física conserva auditoría e invalida revisión final. Migración aditiva con CHECK físico, sin cambios de dinero, stock, permisos o proveedores. Fronti reutiliza acciones nativas y exige confirmación física/revisión.

Validación real en PR/CI por SHA: tipos/lint locales, integración sobre PostgreSQL desechable y navegador 1280/390. No declarar publicado hasta Compuerta, revisión Codex y comprobación de versión/SHA Production. Lista única: docs/etapa4/PENDIENTES.md. La documentación de Etapa 3 mantiene requisitos funcionales heredados; no ocultarlos ni asumir cierre general. Seguir con bloques pequeños hasta terminar el alcance autorizado. No hay Safari/iPhone físico.

## 03/10/2026 · v1.51.1 · Estabilización de secciones desplegables

Production 1.51.0 / `2e44337` quedó READY antes de que terminara la revisión Codex del PR #255. La revisión detectó cinco ajustes que no deben quedar pendientes: impresión de bloques cerrados, atajos internos de Supervisión, apertura de la lista de delegaciones solicitada, conteos visibles en Diagnóstico y relevo actualizado.

El parche 1.51.1 conserva el mismo alcance UI y no toca datos, permisos ni procedimientos. `DisclosureCard` marca sus bloques para que impresión muestre todo el contenido; los atajos de Supervisión navegan con `seccion` y abren el bloque pedido; `?delegaciones=1` abre inmediatamente la lista filtrada; Diagnóstico conserva los conteos de cada grupo plegado. La prueba estructural cubre estos contratos. Safari/iPhone físico sigue pendiente explícito.

Validar mediante Compuerta completa con PostgreSQL desechable, lint, tipos, regresiones, build y Chromium 1280/390 antes de integrar. Tras merge, comprobar Vercel Production, SHA y versión 1.51.1. No hay migraciones.

## 03/10/2026 · Etapa 3 bloque 2 · parche 1.50.1

Production vigente al retomar: 1.50.0 / 4e5eaf8b06aae6930399b4087f9ae7f2b1542c95, Vercel READY. Esa versión fue fusionada tras Compuerta verde, pero la revisión Codex posterior detectó seis hallazgos relevantes en Coordinación. No considerar el bloque 2 cerrado hasta publicar 1.50.1.

Parche preparado en `feat/etapa3-bloque2-continuidad`: normaliza por migración las aclaraciones pendientes creadas en 1.49; impide que una nueva aclaración sobrescriba un impedimento/espera existente; responder conserva la espera/bloqueo para que el responsable retome explícitamente; “Solicitudes de Recepción” se apoya en turno/origen histórico y no en el rol mutable actual; “Turnos anteriores” incluye `ENTREGA_ENVIADA`; métricas cuentan `EN_ESPERA` como impedimento; Fronti recibe el filtro `vista` de Coordinación. Se añadieron regresiones de origen inmutable, impedimento, relevo y contexto Fronti.

Migración nueva: `20261003145500_etapa3_aclaraciones_149`, sólo reparación acotada de aclaraciones 1.49 aún pendientes y con última acción de Coordinación = ACLARACION. Ejecutar únicamente por Compuerta PostgreSQL efímero antes de Production. Safari/iPhone físico sigue pendiente. Tras publicar 1.50.1, continuar con la solicitud UX independiente: secciones desplegables en todo el sistema, empezando por Administración para reducir scrolling.

## 02/10/2026 · Etapa 3 bloque 1 · PR #248

Base de Production comprobada una vez: 1.47.1 / d9472e4. Esta modificación prepara 1.48.0; consultar la PR para pruebas/commit/despliegue real. No atribuir publicación por la presencia de este documento.

Conecta devolución nativa Mantenimiento→HK en la transacción de la incidencia: resultado obligatorio, historial y aviso con alcance actual, versión del trabajo invalidada. Housekeeping conserva estado/responsable y exige retomar e inspeccionar donde corresponda; no modifica disponibilidad comercial. Fronti utiliza sus servicios/ejecutor para frases naturales concretas de consulta, asignación, atención, impedimento, resultado y revisión. Reintentos con la misma referencia conservan el plan autorizado.

Pruebas nuevas PostgreSQL y recorrido Chromium 1280/390 agregado a la compuerta existente, sin aumentar sus límites. Copilot debe revisarse una vez sobre el bloque terminado; cuota anterior agotada, no comprar créditos. Sin migración nueva, sin datos operativos de prueba en Production y sin permisos ampliados. Entorno local dejó de ejecutar; preparación mediante objetos Git en CI, sin mover referencias desde el token del workflow. Los archivos temporales de preparación no forman parte del árbol final.

Lista única: docs/etapa3/PENDIENTES.md. Etapa 3 no está completa; custodia, resto de coordinación y supervisión/gerencia pendientes. Safari/iPhone físico no acreditado.

## Actualización Etapa 2 · delegaciones finitas · 2 de octubre de 2026

PR draft #244 depende de #241 abierto, base/head comprobados al retomar. Última Compuerta anterior completa: 37022894691, head 671632bd, 1398 pruebas + una omisión previa, PG/migraciones/lint/tipos/build/browser escritorio y móvil. Evidencia detallada y tiempos en el cuerpo del PR. Vercel sigue sin despliegues nuevos; no se tocó producción.

Bloque nuevo: delegaciones finitas sobre FrontiExecution existente. /delegar guarda objetivo cifrado, acciones/datos exactos y vigencia explícita (máximo 31 días, 12 pasos); no ejecuta ni programa. /usar-delegacion ejecuta bajo sesión y permisos actuales, /revocar-delegacion cancela pendientes sin deshacer efectos. Misma deduplicación, historial, revisiones y servicios nativos. Migración aditiva 20261002153000_fronti_finite_delegations. No activar en producción. Pruebas nuevas: concurrencia, vigencia, revocación entre pasos, privacidad, pérdida de permiso, monto exacto Caja, cambios de registro y segunda aprobación. Browser ampliado en ambos anchos para creación desde chat sin efecto, uso, reintento, alcance y revocación. Requiere Compuerta nueva; no declarar aprobado con la evidencia anterior. Local dominio 137/16 y tipos aprobados antes del agregado final de integración.

Primera Compuerta de delegaciones 37027400679: migración/tipos/lint/1407 pruebas + una omisión/build aprobados. Browser pasó comandos/delegación de escritorio y falló al continuar a políticas: el chat había quedado abierto y tapaba una casilla. Corregido el recorrido para minimizar explícitamente, sin clic forzado ni aumento de esperas. Además se espera la segunda respuesta de la delegación para medir el resultado visible correcto y se acredita revocación concurrente idempotente con una sola auditoría. Repetir Compuerta final. Tercera revisión Copilot 5393737284 recibida: panel abierto en prueba y catálogo duplicado. Corregidos; catálogo canónico ahora src/domain/fronti-action-catalog.json compartido con generador, comprobación cerrada de correspondencia con handlers. Mantiene abiertas cobertura/atomicidad/fallback; no descartar observaciones sólo por acreditación parcial, detalles en COPILOT.md.

Segunda Compuerta 37028336251, head 0012a50f: verde completa, 1407 pruebas + una omisión, migración/build y recorridos a 1280/390 px. Delegación visible 114/108 ms, Fronti chat 450/116 ms, API 139/76 ms, políticas 195/183 ms. Artefacto 11235934028. Sigue únicamente el ajuste de catálogo canónico (Copilot), con local 137/16, tipos y lint aprobados; nueva Compuerta de ese commit antes de entregar. Resultado final debe quedar en cuerpo de PR para no crear commits sólo por actualizar su propia CI.

No hay PostgreSQL/Docker local. Ejecutar integración en Compuerta PG16 efímero. Motores locales: PRISMA_QUERY_ENGINE_LIBRARY=/tmp/etapa2-prisma/libquery_engine.so.node, PRISMA_SCHEMA_ENGINE_BINARY=/tmp/etapa2-prisma/schema-engine. Despliegue de ramas deshabilitado en vercel.json, workflows de release sólo main. Usar API GitHub para árbol/commit/ref sin fuerza respetando el head remoto; no mezclar la distinta ascendencia local/remota.

No está completa la Etapa 2. Pendientes: cobertura restante/variantes, delegaciones dinámicas y presupuestos acumulados, suplencias, indicadores/turnos completos, CRON_SECRET no consultable y Safari/iPhone físico. Mantener draft, sin merge/deploy/reglas reales. Usuario reiteró autorización para continuar; se mantienen límites concretos de producción. Copilot realizó dos revisiones reales anteriores; no atribuirle implementación ni revisión de cambios posteriores sin resultado.

## 02/10/2026 · v1.47.0 · Etapa 2 local, pendiente de integración y subida

- Rama local `feat/etapa-2-fronti-automatizacion` sobre árbol exacto de PR #241 (`50fb561e`, sigue abierto). No merge, deploy, migración/operación en producción ni nuevas reglas activadas.
- 59 adaptadores a Server Actions originales, planes privados cifrados, permiso/sesión fresca por paso, reclamación atómica y cancelación de pendientes. Comandos exactos en ambos accesos a Fronti privado; propuestas IA requieren autorización. No se declara cobertura general: matriz de 210 exports y pendientes en `docs/etapa2/MATRIZ_ACCIONES.md`.
- Reglas/plantillas pausadas, ocurrencias acotadas Santiago y tareas creadas con el servicio original; ejecución conectada al cron existente, apagada por variable ausente. Nuevos procedimientos requieren validación independiente. Migración aditiva preparada, no aplicada.
- 86 pruebas en 13 archivos sin PostgreSQL, tipos y lint aprobados. Build de código aprobado usando la fuente Inter local sólo como fixture, porque Google Fonts está bloqueado por la red. No equivale a build normal ni integración.
- Subida GitHub rechazada: «user rejected MCP tool call». NO rama remota/PR, NO revisión Copilot. Reintentar sólo con autorización posterior. Borrador concreto: `docs/etapa2/PR_BORRADOR.md`.
- Pendientes: PostgreSQL/CI/browser, latencia ~30 s de etapa 1 sin causa acreditada, CRON_SECRET no consultable, Safari físico, acciones/lecturas restantes, delegaciones generales, suplencias y resúmenes/indicadores completos. No publicar.

## 02/10/2026 · Continuación de Etapa 1 / PR #241

- Se mantiene autorización de implementación y preparación de PR; sin merge ni despliegue. Base main 52f7f229, último commit anterior 622ce10b con Compuerta aprobada: 1345 pruebas + navegador escritorio/ancho móvil.
- Corregidas las seis observaciones de revisión: sin plazo al quitar responsable, exclusión defensiva de filas sin dueño en cron, recepción al iniciar una novedad propia, asignación fechada al organizar HK histórico, fecha de disponibilidad HK compartida por pantalla/cron y escalamiento a coordinadores autorizados del área destinataria.
- Fronti cataloga Coordinación como módulo operativo y reutiliza el lector filtrado de la bandeja, incluyendo cuentas exclusivas HK. Regresiones para acceso y filtros; no añade acciones de IA ni permisos administrativos.
- Se añaden siete regresiones PostgreSQL. Tipos/lint y Compuerta del nuevo commit deben verificarse antes de integrar. El navegador registra tiempos separados de navegación, respuesta POST y estado visible para investigar la demora de unos 30 s; todavía no se atribuye causa.

## 02/10/2026 · v1.46.0 · Etapa 1 en rama, sin merge ni despliegue

- Rama `feat/etapa-1-operacion-conectada` sobre main 52f7f229. Usuario autoriza implementación y PR; prohíbe merge/despliegue.
- `/coordinacion` agrupa fuentes existentes, confirma recepción, reasigna con siguiente acción y conserva continuidad. Lectura de horarios con permisos; sin gestión PMS, asistencia o descuentos de descansos.
- HK separa recepción/inicio y recepción/aceptación de relevo. Mantenimiento exige gravedad y crea continuidad atómica mediante servicio canónico. No se generan movimientos de Caja/llaves.
- Migración aditiva `20261002093000_operacion_conectada`; privacidad de nuevos lectores y cron fail-closed son dependencias concretas, no cierre general de H01/H08. Reconciliar estos PR antes de publicar y confirmar secreto de cron.
- Tipos y 111 pruebas locales de dominio/navegación/contexto aprobados. Compuerta debe ejecutar integración y recorridos autenticados en PostgreSQL sintético; no hay servidor PostgreSQL local ni pruebas sobre Neon.
- Primera Compuerta: migración/lint/tipos aprobados, 1340 pruebas aprobadas y una omisión previa; falló únicamente cobertura del tutorial por la ruta nueva. Añadido paso de Coordinación. Segunda revisión añade horario futuro, tareas con origen cerrado, recepción HK y menú real; repetir Compuerta.
- Segunda Compuerta: 1343 pruebas aprobadas (1 omisión previa), migración/lint/tipos/build aprobados. Navegador detectó sesión sintética rechazada: AUTH_SECRET de CI era más corto que el mínimo real. Corregida sólo la clave ficticia de CI; la autenticación de producción permanece intacta. Repetir navegador y suite con agregados por área, paginación y seguimientos independientes.
- Tercera Compuerta: 1345 pruebas aprobadas (1 omisión previa), migración/lint/tipos/build aprobados. Navegador completó asignación y recepción y comprobó menú reducido; la espera de Resolver observaba el cambio transitorio a «Guardando…» y navegaba antes de terminar la acción. Corregida la prueba para esperar respuesta POST y estado Completada antes de consultar Resultados; sin relajar ninguna comprobación. Evidencia final en PR #241.
- Guía: `docs/ETAPA_1_OPERACION_CONECTADA.md`. Carga por área completa y métricas temporales etiquetadas por página/muestra. Sin datos históricos inventados. Pendientes globales de auditoría conservados.

## 01/10/2026 · v1.45.0 · Housekeeping diario por cargo y área

- Sustituye la portada de avisos por trabajo del día, vistas por cargo, filtros, ejecución, inspección de otra persona, impedimentos, correcciones y continuidad. Usa HousekeepingRequest existente; avisos y pruebas históricas conservan folio/historial. Organización explícita incorpora avisos operativos antiguos al circuito nuevo.
- Permisos separados request/work/assign/inspect/plan/view.all; cargos Mucama, Supervisor/a de Housekeeping y Ama de llaves. Ámbito por área principal y pertenencias activas; no se cambian cargos de usuarios reales. Recepción solicita; Gerencia consulta. Cobertura temporal limitada, revocable, con vigencia de hasta 31 días. No afecta Caja, configuración técnica o privacidad de reservas de llaves.
- Rutinas confirmadas por día, sin crear limpiezas por mera existencia de habitaciones. Disponibilidad declarada independiente de horario/asistencia. Propuestas Fronti determinísticas basadas en carga estimada y disponibilidad; confirmación humana por asignación. Programación lee mallas publicadas, incluyendo noches del día anterior; no crea turnos.
- Resultado en la novedad original; incidencia Mantenimiento única vinculada por impedimento; entregas de llaves abiertas en el relevo, nunca stock privado. Relevos congelan pendientes y custodias y requieren otro receptor. Historial, notas, versiones e idempotencia preservados.
- Migración 20261001212500_housekeeping_workday aditiva, roles/permisos explícitos y ampliación del CHECK de estados. Pruebas nuevas de circuito, privacidad, concurrencia, rutinas, cobertura, reconfirmación de origen y Fronti. Local sin PostgreSQL ni TEST_DATABASE_URL: integración se ejecuta por Compuerta en Postgres efímero; no se usa Neon Production para pruebas.
- Lint/tipos y primera compilación local aprobados. 68 pruebas locales distintas de dominio, navegación, acceso directo, Fronti, informes y renderizado por cargo aprobadas sin base. Reasignar un trabajo bloqueado conserva el impedimento; retomar exige evidencia. Exportación general de Recepción y contexto Fronti fuera de alcance denegados a cuentas exclusivas del área. Compuerta ejecutará la migración y la regresión completa en PostgreSQL efímero antes de merge.
- Primera Compuerta: migración/lint/tipos aprobados, 1281 pruebas aprobadas y cuatro fallos. Corregidos el retorno void del bloqueo advisory (cast text canónico), la identidad duplicada de la fixture, el contrato de navegación de solicitudes y las actualizaciones innecesarias del catálogo al añadir cargos. No se aumenta el presupuesto de consultas ni se omiten regresiones.
- Compuerta del árbol 03443863: migración, lint, tipos, 1288 pruebas aprobadas (1 omisión existente) y build aprobados. Revisión adicional: candidatos requieren ejecución; consulta/vinculación de novedades comparte alcance por autor/área; relevo y rutinas notifican delegaciones vigentes; ayuda/tutorial usan permisos canónicos; búsqueda conserva área/fecha. Seis regresiones añadidas (tres PostgreSQL, una de onboarding, una SSR, una de navegación). Navegación/ayuda/tutorial excluyen los lectores generales de Recepción para cuentas exclusivas del área; Housekeeping aparece en la barra móvil. Lint/tipos y pruebas locales de los seis archivos afectados aprobados. Repetir Compuerta completa con estas correcciones antes del merge.
- Compuerta e39b0f1a: todas las 17 pruebas de integración HK aprobadas, 1291 pruebas aprobadas, dos fallos de catálogo por la fixture del cargo personalizado que no se retiraba al terminar. Corregida limpieza de la fixture (usuario, permisos del rol y rol) sin modificar expectativas ni producción. Repetir suite completa con el alcance de navegación/ayuda antes de publicar.
- Guía operativa: docs/HOUSEKEEPING_OPERACION.md. Publicar sólo con Compuerta verde y verificar SHA/versión/tag en Production.

## 2026-10-01 · v1.44.0 · Áreas, custodia de personal y stock privado

- Destinos `KeyArea` separados del catálogo PMS: las 89 habitaciones y sus mínimos no cambian. Creación, renombrado/desactivación y llaves propias; no se desactiva una área con custodia abierta.
- `/llaves/personal`: departamento receptor obligatorio, selección múltiple de llaves/destinos, colaborador usuario opcional (área principal o pertenencia adicional activa), autorizador activo con nivel >= Supervisor. Se registra quién informó la autorización; seleccionar un nombre no representa una aprobación autenticada por esa persona. Folio humano global, documento imprimible, historial y devolución individual auditada. Copias libres de Recepción pueden prestarse a un destino y vuelven a su reserva original; no se cambia su habitación base.
- Estado `ENTREGADA_PERSONAL`, transacciones, idempotencia y unicidad parcial de custodias abiertas; el PMS no sobrescribe la entrega. Asignaciones de huéspedes usan condiciones atómicas de disponibilidad; las copias de áreas no se ofrecen a huéspedes.
- `SupervisorKey`/movimientos separados del inventario público. Lectura, modificación, entrega y recepción exclusivas del Supervisor propietario, incluso frente al administrador u otro supervisor. Versiones evitan ediciones obsoletas; bajas conservan evidencia. Solo las llaves efectivamente entregadas figuran en la custodia pública; no hay lectura de la reserva privada por Fronti/buscador/auditoría genérica.
- Toma completa incorpora áreas activas y custodias informadas, con confirmación física explícita. Documento congela áreas/custodias, además de snapshots originales de habitación. Inventarios históricos sin campos nuevos siguen consultables. Los 89 mínimos y los totales de habitaciones continúan separados del conteo adicional de áreas.
- Primer recorrido completo: 1261 pruebas pasaron, falló solo cobertura de contexto Fronti por las dos rutas nuevas. Corregidas ambas rutas y lector de entregas/áreas, sin lectura de reserva privada; comprobación adicional de privacidad en contexto/recibo. Formularios refrescan las listas y documentos después de guardar. Entrega de hasta 100 llaves usa operaciones en bloque y una única transacción.
- Migración aditiva `20261001160000_area_staff_keys`, revisada sin operaciones destructivas; comprobar aplicación y pruebas completas en PostgreSQL efímero de Compuerta antes de merge. Entorno local sin servidor PostgreSQL: `npm test` detenido en setup (P1001 a localhost), sin tocar Neon Production. Lint/tipos/build locales; integración y migración por Compuerta. No se crean previews/staging ni ramas Neon.

## 01/10/2026 · 1.43.4 · Chat push y navegación móvil

- Push conserva destinatarios por solicitud; se programa después del commit de mensajes, adjuntos y stickers. Respuestas Fronti incluyen al invocador con las mismas reglas de silencio. El worker vuelve a avisar en mensajes nuevos que reutilizan el ID.
- Móvil: viewport-fit y área segura inferior; Más en portal, scroll bloqueado/restituido, Escape y foco contenido; apertura breve y movimiento reducido. Cabecera con buscador en su propia fila, sin ancho mínimo que fuerce vista de escritorio. Chat por encima de la barra segura.
- Barra reducida conserva un icono por grupo autorizado; grupos/módulos desplegables y ancho con transición. Paneles cerrados se desmontan para no dejar capas invisibles.
- Sin migraciones, cambios de datos operativos ni credenciales. Validación local: lint, tipos y 74 pruebas específicas aprobadas; incluye rollback, silencio, aislamiento de solicitudes y avisos repetidos en worker. Suite completa en Compuerta con PostgreSQL efímero. Entrega real en iPhone pendiente de prueba en dispositivo. La primera Compuerta tuvo 1250 pruebas aprobadas y falló sólo ui-alignment-system por orden literal de clases de cabecera; se conserva el orden esperado sin cambiar la disposición responsive y se repite la Compuerta.

# Relevo de agentes — AROH Central IA · Hotel HW Libertad

## 2026-10-01 · v1.43.3 · Carga de horarios con filas iniciadas

- Captura real: una jornada iniciada abortaba la importación mensual completa. Regla temporal compartida con edición; la carga omite las filas pasadas/iniciadas y conserva las futuras.
- Pantalla y Fronti muestran el conteo. Filas omitidas y motivo quedan en evento/auditoría; no se alteran casillas históricas ni se registra asistencia. Se recalcula al incorporar, con permisos, atomicidad, idempotencia y control de contradicciones.
- Primera Compuerta: 1.243 pruebas aprobadas y una omisión previa; falló la nueva fixture por añadir una noche a una casilla del mismo colaborador ya ocupada. El servicio rechazó correctamente la contradicción. Fixture corregida para una casilla libre; repetir Compuerta completa, sin relajar la regla.
- Archivo totalmente pasado no ofrece incorporar ni cambia versión. Regresiones de límites horarios/noches/zona y lote mixto/idempotente/totalmente pasado en PostgreSQL desechable. 81 pruebas locales, lint y tipos aprobados; Compuerta antes de merge. Sin migración.

## 2026-10-01 · v1.43.2 · Publicación de horarios verificada

- Una consulta real consecutiva devolvió la hora correcta pero inventó generación de turnos y firma de asistencia. Las preguntas sobre publicar ahora usan el lector verificado; las instrucciones de escritura conservan su flujo.
- Publicar nunca genera turnos operativos, abre Caja ni acredita asistencia. Regresiones de clasificación y ejecución sin proveedor en PostgreSQL desechable.
- Integra sobre v1.43.1 conservando las mejoras de avisos. Compuerta requerida antes de merge; prueba real consecutiva posterior. Sin migración ni cambios de permisos, proveedores o costos.

## 01/10/2026 · AROH 1.43.1 · Notificaciones resumidas

- Sustituye el contrato de tres bloques de Fronti proactivo por un título concreto y un resumen de hasta 240 caracteres. Arqueos, tareas vencidas, conteos de llaves y fallas utilizan resúmenes determinísticos específicos; las novedades usan la cadena de proveedores existente para seleccionar el dato decisivo y la acción explícita.
- La respuesta de IA debe ser JSON breve, sin metadatos ni IDs internos. Se rechazan cifras no presentes en la evidencia, plazos omitidos, plantillas largas y reinterpretaciones de habitaciones como equipos/salas. Si falla la inferencia, se conserva un extracto del registro, sin inventar una gestión.
- La campana, el historial, los toasts y el push comparten la presentación canónica. Los avisos anteriores se resumen al leerlos; «Ver detalle» conserva el texto original. No se reescriben registros históricos.
- Los avisos de diferencias de llaves de un mismo día del hotel se agrupan en campana y en cada lote de push. Cada aviso conserva su ID, enlace, fecha y lectura individual. El contador de no leídas y el cursor de push siguen contando avisos originales; no se suman descuadres entre arqueos ni se afirma que avisos históricos sean incidencias vigentes.
- Sin migraciones, cambios de permisos, credenciales o políticas de prioridad. Los datos de origen y la evidencia completa permanecen en los registros/auditoría. El barrido conserva sus reglas de acceso, cooldown, deduplicación concurrente y límites.
- Rama: fix/notificaciones-resumen-inteligente. Validación de integración por Compuerta con PostgreSQL efímero, nunca Neon Production. Publicación por el flujo existente main → Vercel y verificación de SHA/versión/tag.


## 2026-10-01 · v1.43.0 · Equipo, Fronti y uso humano

- Production anterior v1.42.0 confirmada: PR #231, commit 6d2f19b, Compuerta y Release verdes.
- Evidencia real: carga PDF de 192 filas conserva errores de usuarios de una revisión anterior; Fronti respondió con horas UTC como si fueran locales y afirmó erróneamente que publicar abre turnos. No hubo errores de runtime registrados en las últimas 12 horas; errores de push del 29/09 ya corregidos en código vigente.
- `refreshScheduleImport` revisa las filas extraídas contra personas/códigos actuales sin reasignar, publicar ni sobrescribir casillas. Re-subir el mismo archivo recalcula una revisión no aplicada. Versiones y permisos se validan al incorporar. Las observaciones de extracción se conservan.
- Identidad del colaborador usa nombre vigente del usuario en calendario, detalles y Fronti; UI muestra @usuario y oculta identificadores USR internos. Códigos de turno se conservan; formato común `RD01 · 08:00–19:00`, noche `RN01 · 21:00–08:00 (día siguiente)`.
- Fronti recibe herramienta `consultar_horarios`, lector compartido con Equipo, alcance y filtros propios/públicos originales, tipos de turno, cobertura, personas, configuración y revisión de archivos. Horas ya formateadas en zona del hotel. Revisión de errores dentro del calendario devuelve datos verificados sin inferencia ni dependencia de proveedor. No confirma asistencia ni inicia turnos. Otras conversaciones/propuestas conservan proveedor, memoria, permisos y confirmación existentes.
- Transiciones de entrada breves sólo con opacidad; no pisan centrado, no dejan capas al cerrar, respetan movimiento reducido e impresión. Diálogos anidados: Escape y foco sólo en el superior; restauran scroll al cerrar. Chat por debajo de diálogos y apertura mutuamente excluyente con Fronti; auto-scroll sólo dentro del asistente. Tiempo máximo de espera visible y almacenamiento de sesión opcional.
- Vocabulario más simple en Equipo, navegación, Fronti, reservas, garantías, Caja y supervisión. No se renombran estados, roles ni campos persistidos. Observaciones y falta de personal desplegables para evitar páginas interminables.
- Validación: lint y tipos; regresiones de Fronti/contexto/proveedores/navegación/horarios locales. Integración completa en Compuerta PostgreSQL desechable antes de merge. Sin migración nueva ni cambio de credenciales/proveedores/costos.


## 01/10/2026 · AROH 1.42.0 · Operación práctica autorizada

- Usuario = colaborador: cuenta existente obligatoria para altas y nuevas asignaciones; nombre canónico, identidad única por usuario, pertenencias aditivas y referencia semanal en horas. Añadir otra área conserva referencia, función e historial. Edición global exige alcance sobre todas las áreas. Se mantienen perfiles históricos sin cuenta para vincularlos, sin borrarlos.
- Horario completo: sin configuración ni descuentos de colación o descanso mínimo. Se preservan snapshots históricos y se mantienen solapes, ausencias, versiones y permisos. Estas reglas reemplazan las opciones descritas en 1.41.0.
- Llaves: toma única de 89 habitaciones, cambios de piso dentro del mismo borrador y confirmación agrupada después de revisión física. Excepciones y custodia conocida explícitas. Documento imprimible propio por toma guardada; snapshots y referencia idempotente. Conteos antiguos por piso siguen consultables.
- Housekeeping: área receptora, responsable opcional, tomar y comenzar, derivar/relevar con motivo y nueva recepción. Notifica creación, movimiento y resultado a usuarios habilitados; vencimientos mediante cron existente, una vez por revisión. No amplía permisos, no confirma asistencia ni altera el registro original vinculado.
- Navegación: listas de página sin límite interno vertical, calendario horizontal y bloqueo de desplazamiento compartido entre diálogos, ayuda y soporte. Separa inventario, movimientos e historial; Housekeeping incorpora Mis avisos y vinculación independiente.
- Migración aditiva: 20261001180000_operacion_practica. Guía operativa docs/OPERACION_PRACTICA.md. Validación local: 20 pruebas de dominio y 57 de navegación/diálogos/contexto, lint, tipos y build aprobados. Las regresiones completas de PostgreSQL desechable aprobaron en la segunda revisión de PR #231. La revisión final incorpora seguimiento de inicio y notificaciones por pertenencia compartida; integrar sólo con Compuerta final aprobada. Publicación por main y comprobación de Production/tag v1.42.0 mediante el workflow de release.

## 01/10/2026 · AROH 1.41.1 · Menú plegable y barra reducible

- Corrige la agrupación meramente visual: sólo un grupo abierto, por defecto el de la ruta actual. Se puede cerrar también el grupo activo. Módulos con subopciones tienen flecha independiente del acceso principal; grupos de un módulo muestran directamente sus destinos para evitar clics redundantes.
- Barra fija reducible de 224 a 64 px: iconos por módulo, etiquetas accesibles y título al pasar el cursor. Subopciones en panel flotante fuera del contenedor desplazable; cierre por Escape, clic externo, navegación y cambio de ventana. Avisos pendientes visibles en grupos cerrados y modo reducido.
- Preferencia local versionada por usuario, sin datos de autorización. Permisos filtrados por visibleNavGroups en servidor; no se amplían roles ni se modifican datos operativos.
- Móvil reutiliza los grupos plegables dentro de Más; conserva perfil y cierre de sesión, sin duplicar los cuatro accesos inferiores.
- Selección específica por ruta y consulta: Housekeeping y Auditoría no activan Administración, y una sección de Equipo no marca todas sus subopciones. Suspense delimita useSearchParams.
- Verificación local: 47 pruebas de navegación/representación/identidad aprobadas; compilación de producción aprobada. Suite completa pendiente de Compuerta con PostgreSQL desechable; no se prueba con Neon Production. No se dispone de navegador local para prueba visual autenticada.
- Cambio de interfaz únicamente, sin migración. Publicación por PR y flujo normal de Production; incrementar a 1.41.1.


## 01/10/2026 · AROH 1.41.0 · Equipo y horarios

- Nuevo /equipo: calendario por área con vistas semana, ciclo de ocho días y mes; glosa junto al colaborador. Navegación agrupada en Operación, Equipo, Gestión y Administración, conservando permisos anteriores.
- Activado inicialmente sólo para Administrador de sistema. Ocho permisos schedule.* habilitables por rol; alcance por área principal y concesiones adicionales. schedule.view.all sólo consulta publicados y no amplía permisos de escritura. schedule.self.view sólo muestra asignaciones propias publicadas.
- Colaboradores independientes de cuentas de acceso, membresía por área y vínculo opcional a cuenta operativa real. Plantillas inmutables por revisión; RD01/RD02/RN01 precargadas en Recepción sin personas ni jornadas reales. Configurar colaciones antes de interpretar horas/cobertura.
- Mallas borrador/publicadas, cambios atómicos con versión optimista e idempotencia: mover, reasignar, intercambiar o agregar. Prohíbe solapes personales entre áreas, conflictos con ausencias y descansos mínimos configurados. Sin borrado físico ni cambios retroactivos de jornadas iniciadas.
- Lectura determinística PDF/XLSX/CSV/TSV con revisión previa y coincidencia exacta de personas, códigos y horarios; no sobrescribe casillas. Fixture anonimizada reproduce las 192 casillas de la malla aportada. Su fila de suma de horas y firmas intercaladas obligan a reconocer filas por glosa, no por posición adyacente.
- Extras separados en extensión y turno adicional: solicitud, aprobación/rechazo, realización informada y validación. Pendientes no cubren brechas; rechazos futuros liberan el turno adicional o los minutos de extensión conservando evidencia. Colación reduce cobertura aun si se paga. Totales semanales cruzan áreas publicadas y separan noches por semana civil; no confundir el bloque de ocho días con una semana.
- Publicación/cambios publicados generan notificación y recepción persistida por revisión para cuentas vinculadas y habilitadas. Confirmación de horario no prueba asistencia. Calendario consultable fuera del turno operativo; no crea ni abre Shift, Caja o custodia.
- Catálogo nacional de feriados 2026 y administración manual con fuente; noches pueden cruzar dos feriados. Horas America/Santiago con DST, no offset fijo. Franjas de cobertura toleran medianoche omitida; asignaciones con horas inexistentes se rechazan explícitamente.
- Migración aditiva 20261001143000_equipo_horarios: tablas aisladas, restricciones y permisos sólo admin. Documento operativo/técnico: docs/EQUIPO_HORARIOS.md.
- Verificación local: lint y typecheck aprobados; build aprobado; 73 pruebas locales de dominio/importación/navegación/tutorial/contexto Fronti aprobadas y lectura directa del PDF mediante pdf.js (192 casillas / 96 Libre) aprobada. Primera Compuerta: migración aprobada y 1.199 pruebas aprobadas; una regresión exigió registrar /equipo en el contexto Fronti. Se integra lector canónico con prueba de privacidad. Se verifica XLSX real con horas formateadas y empaquetado del worker PDF en /equipo; no se omite la regresión. Cierre verificado: PR #228, Compuerta aprobada (1.209 pruebas; una omisión previa de empaquetado PDF antes del build), Production 1.41.0 y tag v1.41.0 comprobados; no se usa Neon Production para pruebas.
- Pendiente posterior: entrega automática de avisos Housekeeping/Mantenimiento al iniciar el turno de área, escalamiento/reintentos y reportes diarios. Esta release prepara la planificación; no agrega un motor de asistencia, remuneraciones o reservas.


## 01/10/2026 · AROH 1.40.0 · Housekeeping habilitable y administrador operativo

- Instrucción humana vigente sustituye la separación técnica anterior: Administrador de sistema ahora es operativo, asignable y dispone de permisos de turno, habitaciones, llaves y Supervisión. Actúa con su propia identidad; no suplanta usuarios ni se saltan estados, custodia o comprobaciones de propiedad.
- Housekeeping se habilita por rol en Roles y permisos: housekeeping.view (consulta) y housekeeping.manage (crear/vincular/confirmar/gestionar; incluye acceso). No se habilita automáticamente a otros roles. Página, acciones, servicios, navegación, búsqueda, auditoría y contexto de Fronti utilizan la misma regla.
- Los avisos nuevos son operativos (isDemo=false). Pruebas administrativas anteriores conservan isDemo=true, su historial y privacidad; sólo el administrador las consulta/gestiona. No se convierten ni se borran registros anteriores.
- Migración 20261001130000_housekeeping_access_admin_operation registra los permisos, habilita la participación del administrador y elimina únicamente la restricción de pruebas para nuevos avisos. No cambia permisos de otros roles.
- Se habilitan selectores de responsables, Mi turno, Chat y operación de Supervisión para el administrador. Se conservan bloqueos por estado, concurrencia, notas obligatorias y autoría auditada.
- Verificación inicial: 1.160 pruebas aprobadas; dos fallos explicados por el nuevo destino sin tutorial y una expectativa antigua de Fronti que excluía operaciones del administrador. Se incorpora el recorrido modular de Housekeeping y se comprueba que una revocación explícita sigue filtrando herramientas de Fronti. No se omiten pruebas.
- Alcance: habilitar acceso y participación. La asignación automática por horarios de Housekeeping, escalamiento y notificaciones persistentes al personal siguen pendientes; no se inventan turnos del área ni se confunden con Recepción.


## 01/10/2026 · AROH 1.39.0 · Housekeeping privado

- Piloto exclusivo del rol ADMINISTRADOR_SISTEMA en /admin/housekeeping. Guardas en página, acciones y todos los servicios; sin nuevos permisos que puedan habilitarlo accidentalmente.
- Avisos manuales o vínculo único a novedades abiertas existentes; contenido original sin copias ni cambios del estado de origen.
- Recepción, gestión, aclaración/bloqueo, resultado, cancelación y reapertura con historial transaccional. Cambios del origen exigen reconfirmar; versiones optimistas impiden cambios concurrentes incompatibles.
- Todos los avisos son isDemo=true, con restricción SQL. No hay asignaciones operativas del administrador, notificaciones a personal ni cambios PMS/Recepción.
- # global, fechas Chile, formularios compartidos y auditoría existente. Migración aditiva 20261001123000_housekeeping_pilot; limpieza técnica incorpora las dependencias sin ejecutarse durante esta implementación.
- Informe previo: docs/HOUSEKEEPING_PRELIMINAR_2026-10-01.md. Pruebas: dominio, acceso a página/acciones y flujo persistente/concurrencia en PostgreSQL desechable de CI.
- Horarios, responsables del área, escalamiento real y permisos del personal quedan para la siguiente fase acordada.


## 30/09/2026 · AROH 1.38.0 · Fronti: acciones continuas y confirmación verificable

- Causa raíz: el catálogo de herramientas se elegía únicamente con el último mensaje; una respuesta por campos perdía la intención previa de crear. La selección conserva ahora la solicitud literal reciente del usuario, sin convertir mensajes del modelo en autorizaciones; preguntas nuevas y cancelaciones cortan la continuidad.
- La propuesta de Novedad/Incidencia conserva persona o área responsable y vencimiento. Resuelve nombres contra los catálogos operativos, respeta usuarios ocultos/inactivos/no operativos, pide aclaración ante ambigüedad y revalida antes de confirmar.
- Las fechas naturales (hoy, mañana, en dos días con número, horas/minutos) usan las funciones canónicas de America/Santiago; no se exige ISO al usuario ni se fija UTC-3. Campos opcionales no bloquean una novedad simple; prioridad predeterminada y datos completos son visibles antes de guardar.
- Las tarjetas muestran descripción, responsable, área, habitación, prioridad, vencimiento y seguimiento, con lectura desplazable en móvil. El encabezado identifica AROH Central IA.
- Tras obtener una tarjeta válida, la respuesta es determinística: aún no está guardada. No se consume otra inferencia que pueda perder la propuesta o fingir éxito. Propuestas idénticas de una misma respuesta se deduplican.
- La escritura sigue pasando por createEntry, con permisos y bloqueo operativo de turno. La confirmación retorna el # global real y enlace al registro, actualiza las vistas y no libera una confirmación consumida si falla un paso posterior de seguimiento.
- Se refuerza la validación de herramientas al ejecutar; no se amplían roles ni capacidades. Completar tareas por # usa humanId, no el correlativo legado del módulo.
- Pruebas nuevas: reproducción de conversación por campos, continuidad/cancelación, permisos, catálogos, fechas de verano/invierno, tarjetas, persistencia simulada completa, caducidad y doble confirmación. No se crean registros de prueba en Production.
- Sin migración Prisma, sin cambios de datos históricos ni proveedores nuevos. Base v1.37.7 / e7501461499f6a17e5a545ae3c97e9641c705928. Release v1.38.0.


## 30/09/2026 · AROH 1.37.7 · sidebar persistente al desplazarse

- El sidebar de escritorio usa `sticky top-0`, `h-dvh` y `self-start`; mantiene marca y pie visibles, y el menú dispone de scroll interno con `overscroll-contain`.
- `body overflow-x: hidden` creaba un ancestro de scroll que impedía el comportamiento sticky del shell. Se sustituye por `clip`, conservando el control horizontal sin crear otro contenedor de desplazamiento. También permite al topbar sticky seguir el scroll del documento.
- La navegación móvil y la impresión mantienen su comportamiento. Cambio exclusivamente de layout/CSS, sin datos, permisos, Prisma ni migraciones.
- Base de release: v1.37.6 / c18f04421823af71126874b546e03fe97f2870b1.



## 30/09/2026 · AROH 1.37.2 · alineación visual transversal

- **Novedades / habitación** ya no usa una grilla de dos columnas ciega para sus métricas: una sola métrica ocupa todo el ancho; con cantidad impar la última ocupa dos columnas. La tarjeta es `flex-col` y empuja la zona de métricas al fondo para mantener una lectura estable entre habitaciones.
- Botones compartidos: alturas mínimas `sm/md/lg` = 2rem / 2.25rem / 2.75rem.
- `Badge` y `Chip` centran contenido y usan altura/line-height estable.
- `.input-base` usa `min-h-10`; `.card` usa `min-w-0`; `.card-header` usa `min-h-11`.
- Topbar y contenido principal comparten gutter horizontal de 1rem.
- Esta versión es únicamente de UI/consistencia. No tocar flujos, permisos ni datos para resolver alineación.
- Release: **v1.37.2**.


## 30/09/2026 · AROH 1.37.1 · hora Chile canónica

- Corrección transversal de escritura: `datetime-local` representa hora local sin zona y nunca debe pasarse directamente a `new Date()` / `Date.parse()` en Vercel.
- El parser común `zOptionalDate` usa ahora `parseHotelDateInput()`: horas sin zona se interpretan en `America/Santiago`; ISO con `Z`/offset se conserva como instante absoluto.
- Esto cubre Novedades/Incidencias, Tareas, Seguimientos, Alertas, Reservas de referencia, Garantías, Comunicados y vencimientos/periodos que usan el esquema común. Caja en vivo y Alarmas operativas continúan con `parseHotelDateTimeLocal()`.
- Caso de regresión explícito: `30/09/2026 11:00` debe persistir como `2026-09-30T14:00:00.000Z` y volver a mostrarse **11:00** en Chile, no 08:00.
- También se prueba invierno UTC-4 para evitar fijar manualmente `-03:00`.
- No migrar timestamps históricos automáticamente: sólo corregir datos antiguos cuando exista evidencia del valor local que el usuario pretendía registrar.
- Sin migración Prisma. Release: **v1.37.1**.


## 30/09/2026 · AROH 1.37.0 · tutoriales modulares + Ayuda completa + Fronti explicativo

- El tutorial deja de ser únicamente un onboarding global. Cada usuario conserva en `User.tutorialKnownModules` los módulos que ya conoce.
- Cuando un permiso vuelve visible un módulo que esa cuenta todavía no conoce, AROH presenta automáticamente **sólo el tutorial de ese módulo**. Si se habilitan varios a la vez, los encadena sin repetir los anteriores.
- «Cerrar esta vez» sólo afecta la sesión. Completar u omitir permanentemente un tutorial de módulo lo marca como conocido; puede reabrirse desde Ayuda.
- La migración inicializa como conocidos los módulos actuales de quienes ya habían completado el tutorial general, evitando bombardear a usuarios existentes tras desplegar.
- Ayuda incorpora **Tutoriales por módulo** y amplía el manual buscable con Novedades / habitación, tareas programadas/validadas, seguimientos, Alertas, Notificaciones, Web Push, Caja/arqueos/regularización/Tesorería, Gym, Estacionamiento, Gerencia, Fronti, Supervisión, auditorías, medidas correctivas, salud, rendimiento, usuarios ocultos, permisos, soporte/adjuntos, chat, búsqueda global, historial e IDs humanos.
- Fronti proactivo adopta un contrato explícito de explicación: **Qué pasó → Qué está mal / qué revisar → Qué hacer**, sin inventar causas, montos, personas ni estados no demostrados.
- El radar proactivo incorpora descuadres recientes de Caja con **esperado / contado / diferencia / responsable** y abre el arqueo exacto; también detecta tareas vencidas abiertas y abre la tarea concreta.
- Los hallazgos de inventario de llaves enlazan al piso afectado cuando la telemetría contiene ese contexto.
- Migración: `20260930112000_tutoriales_modulares`.
- Release: **v1.37.0**.



## 30/09/2026 · AROH 1.36.2 · trazabilidad gerencial + detalle de habitación

- Gerencia deja de usar «Ver evidencia» como salto genérico: cada señal muestra el detalle detectado y enlaces al registro concreto cuando existe ruta individual.
- Diferencias de Caja muestran arqueo, esperado, contado, diferencia, responsable y acceso directo a `/caja/arqueos/[id]`.
- Incidencias críticas, tareas vencidas, correctivas, hallazgos y habitaciones críticas exponen sus orígenes concretos.
- Fronti genera una sugerencia breve a partir de los hechos ya detectados; si IA no está disponible, la interfaz lo declara y conserva la acción determinística.
- Novedades / habitación corrige la navegación en móvil/tablet: al tocar una habitación el panel de detalle se presenta antes del mapa y el enlace apunta a `#detalle-habitacion`.
- Gimnasio y Estacionamiento se muestran en Novedades / habitación sólo como **reflejo de Caja de los últimos 30 días**. No se duplican ni se convierten en novedades.
- Los folios reflejados enlazan nuevamente a Caja para conservar la fuente única de verdad.
- Release: **v1.36.2**.


## 30/09/2026 · AROH 1.36.0 · Novedades / habitación

- AROH reafirma su alcance: **no es PMS**. FNSrooms sigue siendo la fuente para reservas, ocupación, check-in y check-out.
- Se retira «Central de Reservas» como módulo raíz. La ruta histórica redirige a `/novedades/habitacion`.
- Nuevo módulo **Novedades / habitación**: mapa operativo interactivo de las 89 habitaciones (401–429, 501–530, 601–630).
- Habitación funciona como **contexto físico**, no como estado de alojamiento.
- El monitor reúne Novedades/Incidencias, Tareas, Seguimientos, Alertas programables, Garantías y otros registros operativos asociados.
- Formularios de Novedades, Tareas, Alertas, Garantías, Gimnasio y Estacionamiento usan selector canónico de habitación.
- Las Alertas heredan la habitación del objeto de origen cuando corresponda, sin duplicar la Novedad/Tarea.
- Estacionamiento sustituye «Patente» por **ID Reserva**; `vehiclePlate` queda sólo como compatibilidad histórica y los registros nuevos usan `reservationCode`.
- Gerencia no incorpora llegadas/ocupación como KPI propio; métricas PMS permanecen como fuentes externas/no conectadas.
- Semántica preservada: Tarea = trabajo; Alerta = llamada de atención programable; Notificación = aviso navegable.
- Release objetivo: **v1.36.0**.


## 30/09/2026 · AROH 1.35.0 · Gerencia estratégica

- Rama: `feature/gerencia-estrategica-v1-35-0`.
- Nuevo módulo raíz `/gerencia`, visible mediante `management.dashboard.view`; acceso inicial para GERENCIA y Administrador de sistema.
- El sidebar conserva la regla 1.34.1: Gerencia vive bajo el grupo «Dirección» y no despliega submenús inline.
- El cockpit es read-only y abre con **Decisiones requeridas**; después muestra scorecard, tendencias contra período anterior, exposición de control y cobertura de fuentes.
- Las señales se calculan con hechos determinísticos de AROH: tareas, incidencias, turnos/entregas, reservas, arqueos, llaves, auditorías y medidas correctivas.
- No inventar ocupación, ADR, RevPAR, TRevPAR, GOPPAR, Flow Through/Flex, costo laboral/POR/PAR, reputación ni benchmark hasta conectar una fuente autoritativa.
- No generar rankings de personas. Gerencia analiza procesos, excepciones, riesgo y capacidad de ejecución.
- Semántica protegida: una decisión puede convertirse deliberadamente en Tarea; una atención temporal en Alerta; Notificación sigue siendo sólo aviso. El cockpit no crea objetos ni cambia estados automáticamente.
- `/indicadores` deja de contar Alert legada y usa `OperationalAlarm` para «Alertas activas».
- Fronti cataloga `/gerencia`, pero los hechos del cockpit no dependen de inferencia IA.
- Release objetivo: **v1.35.0**. Migración aditiva sólo de permiso.

## 29/09/2026 · AROH 1.34.1 · sidebar simplificado

- Rama: `fix/sidebar-simplificado-v1-34-1`.
- Corrección de UX sobre 1.34.0: el sidebar vuelve a ser **selector de módulos**, no árbol de navegación secundaria.
- No renderizar dentro del sidebar Incidencias, Tareas, Seguimientos, Historial, Notificaciones, subsecciones de Caja, pisos de Llaves ni subsecciones de Supervisión/Administración.
- Las vistas secundarias permanecen en el sistema y se acceden desde el módulo propietario.
- `/supervision/informes` se incorpora a la navegación interna del Centro de Supervisión para no depender del sidebar.
- No cambia permisos, rutas, datos, Prisma ni lógica operativa.
- Regresión en `tests/navigation.test.ts`: el bloque `SidebarNav` no puede volver a renderizar `item.menu`.
- Release objetivo: **v1.34.1**. Sin migración Prisma.


## 29/09/2026 · AROH 1.34.0 · sistema visual corporativo

- Rama: `feature/aroh-corporate-visual-system`.
- Referencia visual canónica: storyboard AROH Central IA; azul noche casi negro + blanco/gris frío + cian, geometría recta y modular.
- Cambio de presentación: no modifica reglas operativas, permisos, datos, Prisma ni máquinas de estado.
- Escritorio: sidebar oscuro persistente; lienzo de trabajo claro. Móvil conserva barra inferior independiente.
- La clave histórica `gold-*` permanece temporalmente por compatibilidad de clases, pero sus tokens representan cian. No reintroducir dorado visual.
- El sidebar muestra navegación secundaria del módulo activo para no perder acceso a Tareas, Seguimientos, Caja, Turnos, Llaves, Supervisión o Administración.
- Wordmark visible: **AROH Central IA**; alojamiento separado como contexto.
- Tarjetas, botones, chips, campos, overlays, chat, Fronti, ayuda, notificaciones, soporte, tutorial, gates, alarmas y modales comparten el mismo sistema.
- Regresiones: `tests/corporate-visual-system.test.ts`, `tests/corporate-visual-pages.test.ts`, `tests/corporate-visual-all-pages.test.ts` y contrato de navegación en `tests/navigation.test.ts`.
- Release objetivo: **v1.34.0**. Sin migración Prisma.

## 29/09/2026 · AROH 1.33.3 · continuidad del mismo recepcionista

- **Revierte la restricción funcional de 1.33.2**: una persona que participó en el turno saliente puede recibir la entrega y continuar en el turno siguiente.
- No borrar ni retirar al usuario de las asignaciones históricas para habilitar el relevo. El turno saliente conserva su trazabilidad real y debe estar formalmente `CERRADO`; su `ShiftAssignment.leftAt` debe haber quedado registrado antes de iniciar el nuevo turno.
- `startReceptionShift()`, `receiveShiftCash()` y `receiveHandover()` aceptan al mismo usuario del turno anterior. La recepción sigue creando/enlazando un turno distinto, permanece `INICIADO` y no pasa a `ACTIVO` hasta completar entrega, recuento de Caja/garantías, custodia y revisión final.
- El gate y la UI vuelven a presentar `HANDOVER_PENDING` al continuador; la pantalla de entrega permite los cinco pasos aunque el receptor también sea emisor histórico.
- Regresión obligatoria: la jornada E2E encadena DÍA → cierre → NOCHE con la misma persona, incluyendo Caja, y comprueba que sólo quede viva la asignación del turno nuevo.
- Sin migración Prisma. Release objetivo: **v1.33.3**.

## 29/09/2026 · AROH 1.33.2 · hotfix de autorecepción de turnos

- No ofrecer recepción normal al mismo usuario que figura en las asignaciones del turno saliente.
- `startReceptionShift()` mantiene la barrera server-side «la entrega debe ser recibida por alguien distinto del turno saliente»; la UI debe anticiparla y nunca presentar un botón imposible.
- La detección visual usa la entrega pendiente y `desk.awaitingReceipt`; no relajar la segregación de recuento/custodia/firmas para resolver este caso.
- Sin migración Prisma. Release objetivo: **v1.33.2**.


## 29/09/2026 · AROH 1.33.1 · cierre de revisión Fronti proactivo

- Se cierra el feedback pendiente de la revisión de v1.31.0: el límite se aplica después del cooldown, el interruptor global `fronti.enabled` también detiene la proactividad y las escaladas de urgencia de reservas cambian su fingerprint.
- La deduplicación deja de depender de conteos susceptibles a carreras: `FrontiProactiveClaim` reclama atómicamente cada señal por destinatario antes de inferencia/fan-out.
- El cron de Vercel entrega un deadline explícito al barrido y cada inferencia tiene presupuesto acotado; siempre queda margen antes de `maxDuration=120`.
- El polling de notificaciones usa el scheduler con `after()`; no deja promesas fire-and-forget fuera del ciclo de vida de la request.
- Novedades/incidencias recién creadas de alta prioridad, críticas o con seguimiento son candidatas directas durante 20 minutos; no dependen de que otra regla fabrique una Alert.
- Migración aditiva: `20260930005000_fronti_proactive_claims`. Release objetivo: **v1.33.1**.

## 29/09/2026 · AROH 1.30.0 · adjuntos persistentes de soporte

- Soporte reutiliza el R2 privado ya existente; no introducir blobs en Neon ni otro proveedor de almacenamiento.
- `/api/soporte/adjuntos/init` sólo firma la subida. El navegador hace PUT directo a R2; no exigir `isR2Operational()` porque ese sondeo mide conectividad servidor→R2 y puede fallar aunque la transferencia directa del navegador sea viable.
- Los objetos archivados se registran como `SupportRequestAttachment`; `attachmentNames` queda como inventario compatible con registros anteriores y con el respaldo por correo.
- `/api/soporte/adjuntos/[attachmentId]` exige `support.view` y responde con redirect a GET temporal firmado; no volver a proxificar el binario por Vercel.
- Si la subida directa falla, el `SupportRequest` no debe perderse: el archivo conserva el correo como respaldo.
- Migración: `20260929185000_support_request_attachments`. Release objetivo: **v1.30.0**.

## 29/09/2026 · AROH 1.30.0 · adjuntos de soporte

- `SupportRequestAttachment` conserva metadatos; los binarios viven en R2 privado, nunca en Neon.
- Flujo de escritura: navegador solicita URL PUT temporal → navegador sube directo a R2 → `/api/soporte/solicitud` vincula sólo los uploads logrados.
- Fallar al archivar **no puede bloquear el reporte**. Se mantiene la copia SMTP con el adjunto original; la respuesta informa si el archivo no quedó disponible en la bandeja.
- Flujo de lectura: `/api/soporte/adjuntos/[attachmentId]` exige `support.view` y redirige a una URL GET firmada de 5 minutos.
- No exponer `storageKey` en la UI ni hacer público el bucket.
- El probe backend de R2 sigue degradado en Production; no usar `isR2Operational()` como gate del init de soporte, porque esta ruta prueba navegador→R2 y tiene fallback seguro.
- La puesta en cero debe borrar `SupportRequest` antes que usuarios; `SupportRequestAttachment` cae por cascada.
- Migración: `20260929185000_support_request_attachments`. Release objetivo: **v1.30.0**.

## 29/09/2026 · AROH 1.29.0 · bandeja interna de soporte

- `Reportar / solicitar` persiste primero un `SupportRequest`; SMTP es aviso secundario.
- Bandeja: `/admin/soporte`. Lectura exige `support.view`; gestión exige `support.manage`.
- El Administrador de sistema recibe ambos permisos por migración; Supervisor/Gerencia no los reciben por defecto.
- Estados: nueva → en revisión → resuelta/descartada. Los cierres exigen nota de resolución y generan `AuditLog`.
- La página de soporte debe permanecer catalogada en Fronti; la regresión transversal falla si se elimina del mapa.
- No guardar blobs de capturas/adjuntos en Neon. La bandeja conserva nombres y el contenido sigue por SMTP.
- Migración: `20260929183500_support_inbox`. Release objetivo: **v1.29.0**.

## 29/09/2026 · AROH 1.28.0 · usuarios ocultos

- `User.hiddenFromSelectors` es una propiedad administrativa independiente de `active` y del rol.
- Una cuenta oculta conserva login, permisos, operación propia, historial, trazabilidad y destinatarios automáticos/globales; **no equivale a inactiva**.
- `listOperationalUsers()` es la regla canónica para selectores generales y excluye cuentas ocultas.
- También se bloquean vías directas que podían saltarse el selector: incorporación manual a turnos, nuevos chats/grupos, alarmas individuales/grupales y menciones `@usuario`.
- Las referencias históricas y conversaciones ya existentes conservan el nombre del usuario; los broadcasts de equipo/globales siguen incluyéndolo.
- Administración muestra el estado **Oculto** y permite activarlo/desactivarlo sin cerrar sesiones.
- Migración aditiva: `20260929173000_usuario_oculto_operacion`. Release objetivo: **v1.28.0**.


## 29/09/2026 · AROH 1.27.0 · Fronti contextual transversal

- Rama: `feature/fronti-contextual-v1-27-0`.
- `fronti-v2/page-context.ts` cataloga cada `src/app/(app)/**/page.tsx`; una prueba recorre el árbol real y falla si aparece una pantalla autenticada sin mapa contextual.
- `consultar_contexto_pantalla` es una herramienta read-only nativa que resuelve módulo, sección, filtros y entidad abierta, y consulta una fotografía compacta desde servicios reales respetando permisos.
- El cliente envía `pathname + search + hash + document.title`; el servidor infiere entidades dinámicas y sanea query params sensibles.
- El selector de herramientas combina intención textual + `recommendedTools` del módulo actual para resolver referencias como «aquí/esto/esta pantalla».
- `runReceptionAssistant` recibe el `FrontiRuntimeContext` y lo conserva también cuando Fronti participa dentro del chat.
- El gate de Recepción permite herramientas `mode: read` fuera de `ACTIVE`; propuestas/escrituras siguen bloqueadas. No relajar esta separación.
- La visibilidad standalone depende sólo de `canUseFronti(...)`; el rollout por usuario se conserva.
- NO incluir proactividad/eventos/background agents en esta release. Alcance exclusivo: contextualidad transversal bajo demanda.
- Sin migración. Release objetivo `v1.27.0`; antes de merge: Compuerta completa y después health/smoke/tag de Production.

## 29/09/2026 · AROH 1.26.3 · hotfix panel Reportar / solicitar

- El panel de soporte debe montarse en `document.body` mediante `createPortal`.
- No volver a dejar overlays `position: fixed` como descendientes directos del header con `backdrop-filter`, porque ese ancestro puede convertirse en containing block y recortar el viewport.
- La prueba en `tests/shell-horizontal.test.ts` protege esta invariante.
- Sin migración Prisma. Release objetivo: **v1.26.3**.

## 29/09/2026 · AROH 1.26.2 · dropdowns de navegación

- Mantener el shell horizontal de v1.26.x, pero la navegación secundaria usa dropdowns compactos; no reintroducir mega-menús de ancho completo.
- El dropdown se renderiza mediante portal para escapar del `overflow-x-auto` de la fila principal y se reposiciona en resize/scroll.
- Cabecera y fila de módulos comparten `max-w-[1680px]` centrado.
- Tipografía de módulos/opciones: `text-[0.82rem]`; marca AROH y alojamiento suben levemente para legibilidad.
- Animación `nav-dropdown-enter` con alternativa sin movimiento para `prefers-reduced-motion`.
- Sin cambios de datos ni Prisma. Release objetivo: **v1.26.2**.

## 29/09/2026 · AROH 1.26.1 · identidad final del producto

- Producto: **AROH Central IA**. El alojamiento se muestra debajo como contexto de propiedad.
- La cabecera horizontal de v1.26.0 se conserva; sólo cambia la identidad visible de producto.
- No volver a usar «Central de Operaciones» como marca del sistema. «Libro/Novedades» permanece como módulo interno.
- Branding alineado en UI, metadatos, correos, Fronti, términos, arqueos e icono accesible.
- No renombrar todavía repositorio, proyecto Vercel ni dominio; el subdominio se migra en una fase separada.
- Sin migración Prisma. Release objetivo: **v1.26.1**.

## 29/09/2026 · Central 1.26.0 · shell horizontal y soporte

- Rama: `feature/navegacion-horizontal-v1-26-0`.
- Se reemplaza el sidebar de escritorio por cabecera horizontal + mega-menús; móvil conserva su navegación inferior.
- La búsqueda superior queda global. QuickActions deja la cabecera y vive en Novedades; filtros/buscadores de módulo no se eliminan.
- Cabecera: identidad → búsqueda → Fronti vigente → Alojamiento → cuenta → notificaciones/chat existentes → Ayuda → Reportar/Solicitar.
- Ayuda incorpora «Iniciar recorrido» y mantiene procedimientos determinísticos del repositorio.
- Nuevo soporte: `/api/soporte/solicitud`, captura/adjunto opcionales, contexto técnico y SMTP a `support.recipient` (por defecto `eherrera@hoteleshw.com`).
- Fronti sólo cambia de lanzador en escritorio mediante evento `fronti:open`; no se añadieron herramientas, contexto transversal ni automatización proactiva/event-driven.
- Sin migración. Release objetivo `v1.26.0`. Antes de merge: Compuerta completa y verificación de Production.


## Actualización 29/09/2026 · Central 1.25.0 · jornada operativa y cambio de identidad

- Producto: **Central de Operaciones · Hotel HW Libertad**. No renombrar todavía repo, proyecto Vercel ni dominio; el cambio de subdominio es una migración separada.
- Fuente única de fecha operativa: `resolveOperationalBusinessDate()` en `services/shifts.ts`. Turno abierto → `Shift.date`; último cierre DÍA → misma fecha; último cierre NOCHE → día siguiente; sin historial → calendario del hotel.
- `getDashboardData` y Supervisión consumen esa fecha. `getSupervisionCenterSummary` limita `SupervisionAuditImport` a la jornada vigente.
- La apertura de Supervisión sí puede consultar jornada vigente + cierre anterior para probar continuidad; esa excepción no debe volver a contaminar el dashboard diario.
- `reportedBusinessDate()` prioriza fecha de archivo y encabezado. La regresión cubre un PDF 29/09 que contiene una llegada 01/10.
- Cierre de Recepción: conservar `closeShift()` como autoridad. Revalida `cashBlockersForSending` + `assertShiftCashClosed` y después crea la tarea de validación de cierre.
- Pruebas nuevas: `tests/fecha-operativa-turnos.test.ts` y regresión de fecha en `tests/supervision-audit-import.test.ts`.
- Release: **v1.25.0**, sin migración Prisma.

## Actualización 29/09/2026 · Libro 1.24.0 · Apertura operacional de Supervisión

- El botón «Iniciar turno» ahora abre una preparación guiada; ya no activa Supervisión ni acepta prioridades libres.
- `SupervisionShiftStatus.PREPARACION` representa esa fase. El turno se activa únicamente con `completeSupervisionOpening`.
- Gate de apertura: arqueo personal de cada fondo activo, diferencias explicadas y confirmación humana de pendientes, garantías/custodias y llaves. Caja/garantías sí son barrera real.
- La Caja reutiliza `CashAudit` y su validación física de garantías en efectivo; no existe una segunda caja de Supervisor.
- Evidencia PMS: fotografía operacional de hoy mediante **Habitaciones con actividad** o, como respaldo equivalente, **Entradas + In House + Salidas**. El cierre del día anterior usa **Formulario de auditoría + Cobros + Cargos diarios**. Ventas por canal, Producción por habitación y Revenue son gestión no bloqueante.
- Los informes pueden mezclar fechas y se reutilizan por fecha operativa. Si el PMS no entrega evidencia completa, se puede iniciar sólo con una contingencia escrita y auditada; no se deja el hotel sin Supervisión por una falla externa.
- El lector PDF detecta anotaciones de enlace sobre el ID FNS como señal auxiliar: enlace en una entrada/salida = `PENDIENTE` (alta); ausencia de enlace = `PROCESADO_PROBABLE` sólo si el mismo PDF demuestra la convención mixta. No auto-confirma movimientos; color/subrayado quedan pendientes de validación con archivos reales.
- La apertura guarda snapshot estructurado en `openingState`; las prioridades se generan desde objetos reales pendientes y los informes de gestión faltantes.
- Migraciones: `20260929110000_supervision_apertura_operativa` + `20260929110500_supervision_apertura_unique_index`. Release objetivo: **v1.24.0**.

## Actualización 28/09/2026 · Libro 1.23.0 · Central de Reservas, Gerencia y correo individual

- Nuevo rol de sistema `CENTRAL_RESERVAS` / «Ejecutivo/a de Central de Reservas». Trabaja reservas, novedades, tareas, alertas y seguimientos sin permisos de turnos de Recepción, movimientos de Caja, llaves ni administración técnica.
- Nueva ruta `/central-reservas`: bandeja previa a la operación con reservas que requieren acción, llegadas en 24/72 h, cambios recientes, garantías/saldos pendientes y continuidad vinculada. Reutiliza `ReservationReference`, tareas, alertas y seguimientos; **no crea un PMS paralelo**.
- Gerencia de operaciones pasa de consulta casi pasiva a dirección transversal: Centro de Supervisión, asignación de acciones, seguimientos, comunicados, rendimiento, historial, auditoría y Caja en lectura. Sigue sin iniciar/recibir/entregar/cerrar turnos, escribir Caja, operar llaves ni editar reservas.
- `User.email` vuelve como canal opcional de avisos, nunca como identidad. El login continúa exclusivamente por `username`; el correo puede repetirse.
- Cada usuario puede registrar su correo y activar/desactivar avisos en `/perfil`; Administración también puede gestionarlo desde Usuarios.
- El despachador único de notificaciones añade correo mediante `OperationalMailOutbox`. Chat y timers/alarmas quedan fuera del correo para evitar ruido. Las notificaciones internas siguen siendo la fuente inmediata dentro del Libro.
- Las credenciales iniciales se envían al correo individual cuando existe; si no, se conserva la casilla de credenciales del hotel como respaldo.
- Se conserva íntegramente la Supervisión accionable incorporada en **v1.22.0**; este release se construye sobre ese `main`.
- Migración aditiva: `20260928213000_central_reservas_gerencia_correo_usuario`.
- Release objetivo: **v1.23.0**.

## Actualización 28/09/2026 · Libro 1.20.0 · auditorías accionables, arqueos imprimibles y servicios

- Auditorías sorpresa: el cierre ya no guarda una etiqueta inerte. «Persona» exige destinatario y crea notificación; «Supervisión» distribuye al equipo supervisor; «Operativo» publica mediante notificaciones al equipo operativo. «Reservado» no distribuye.
- El historial de auditorías muestra el resultado completo: alcance, muestra, resumen, observaciones, cada punto, estado y evidencia.
- Arqueos de Caja: cada arqueo nuevo conserva un snapshot de billetes/monedas y puede abrirse en una hoja imprimible con fondo esperado, contado, diferencia, garantías y firmas. Los arqueos históricos siguen siendo imprimibles, pero sin inventar un desglose que antes no se guardaba.
- Estacionamiento reutiliza la infraestructura de folios: fecha, habitación, huésped, patente, recepcionista, estado/anulación y exportación CSV. No crea movimientos de Caja.
- Llaves incorpora «Todos los pisos · 89 hab.» para consulta, búsqueda y operación transversal. El inventario oficial sigue guardándose por piso para conservar trazabilidad.
- Migración aditiva: `20260928183000_auditoria_caja_estacionamiento`.
- Release objetivo: **v1.20.0**.

## Actualización 28/09/2026 · Libro 1.19.5 · cierre de turno desbloqueado

- Corrige el cierre formal que quedaba atrapado en `ENTREGA_ENVIADA`: la Server Action pedía semánticamente `shift.manage` y el gate de Recepción bloqueaba ese permiso durante `CLOSING`, aunque el recepcionista fuera dueño del turno.
- `closeShiftAction` usa ahora `shift.close`; el servicio conserva la comprobación final de propietario o `shift.manage` para Supervisión.
- Si una regla de negocio rechaza el cierre, el modal se cierra y deja visible el error real en pantalla en vez de parecer que el botón no hizo nada.
- Prueba de regresión añadida en `tests/reception-shift-gate.test.ts`.
- Sin migración ni cambios de datos. Release objetivo: **v1.19.5**.


## Actualización 27/09/2026 · Libro 1.19.3 · alarmas ocultas de bajo costo

- Corrige la regresión detectada después del hotfix de capacidad 1.19.2: una pestaña oculta ya no pierde el despacho oportuno de timers/recordatorios.
- El stream pesado continúa apagado en segundo plano; un pulso dedicado consulta sólo alarmas cada 30 s y carga el feed únicamente cuando realmente despacha alguna.
- No revierte el ahorro de Chat/Notificaciones de 1.19.2.
- Sin migración ni cambios de negocio. Release: **v1.19.3**.

## Actualización 27/09/2026 · Libro 1.19.2 · alivio de capacidad Vercel

- Notificaciones: comprobación 2 s → 15 s.
- Chat: comprobación 1,5 s → 10 s; presencia 45 s → 90 s.
- Chat y feed general de Notificaciones se suspenden en pestañas ocultas.
- Motivo: alerta de Vercel al 90% de Fluid Active CPU incluido.
- Sin migración. Release: **v1.19.2**.

## Actualización 27/09/2026 · Libro 1.19.1 · sincronización canónica

- Patch documental únicamente: actualiza `PROJECT_CONTEXT.md` y este relevo con el estado publicado en 1.19.0.
- Sin cambios funcionales, de permisos, esquema o migraciones.
- Production pasa a **v1.19.1** manteniendo la misma lógica operativa de 1.19.0.

## Actualización 27/09/2026 · Libro 1.19.0 · recepción guiada y emergencia única

- Recepción entrante persistente en cinco pasos: entrega → Caja/garantías → custodia → revisión final → activar.
- El turno receptor permanece `INICIADO` hasta completar el relevo; durante ese estado la operación general queda cerrada por el gate.
- Un usuario que está fuera ve el turno operativo vigente y puede incorporarse desde `/turno`; no debe abrir otro turno para reforzar el mesón.
- Emergencia: máximo una operativa a la vez. La restricción existe en servicio y PostgreSQL.
- Al cerrar el turno de origen, la emergencia se libera automáticamente y el turno vigente continúa normal, conservando `emergencySourceShiftId` y `emergencyResolvedAt`.
- La entrega excepcional queda enlazada al mismo turno de emergencia; regularizarla no crea un turno adicional.
- Recontar Caja o modificar custodia invalida confirmaciones de recepción posteriores.
- Migración: `20260928011000_recepcion_turno_guiada`.
- Release funcional base: **v1.19.0**, commit `6a171274`; v1.19.1 sólo sincroniza documentación canónica.

## Actualización 27/09/2026 · Libro 1.17.2 · Chat anclado al borde derecho

- La pestaña cerrada de **Chat operativo** queda pegada al borde inferior derecho del viewport, también en escritorio.
- Al abrirse en tablet/escritorio, el panel nace desde el mismo borde derecho y conserva la lógica de pestaña + ventana del chat clásico.
- Se elimina la dependencia visual del ancho de la barra lateral (`lg:left-64`), por lo que el Chat no cambia de posición al variar la navegación.
- En móvil pequeño se conserva el panel a pantalla completa; la pestaña cerrada queda sobre la navegación inferior, alineada a la derecha.
- Release sin migración: **v1.17.2**.

## Actualización 27/09/2026 · Libro 1.17.1 · coherencia de Supervisión

- Continuidad activa: tareas, seguimientos y medidas abiertas no se ocultan por fecha de creación.
- Fechas del Centro y Rendimiento se interpretan en `America/Santiago`.
- Conteos de Auditorías/continuidad/asuntos sin responsable se separan de las muestras limitadas.
- «No aplica» queda fuera del denominador de cumplimiento de procedimientos.
- Salud: lenguaje de emergencia y cierres incompletos en estado de atención.
- Informe de estado pasa a «actividad + estado vigente», evitando que un pendiente antiguo desaparezca del informe.
- Sin migración. Versión 1.17.1.

## Actualización 27/09/2026 · Libro 1.17.0 · blindaje de flujos

- Cierre de Recepción: las revisiones de pendientes/final quedan persistidas y
  `sendHandover()` las exige en servidor. Cambiar el borrador las invalida.
- Urgentes: requieren aceptación expresa antes del envío.
- Caja: historial filtrado en servidor, totales reales, confirmación de fechas
  efectivas atípicas y doble confirmación al devolver efectivo.
- Garantías nuevas: deben quedar identificadas al menos por huésped, habitación
  o referencia. Supervisión señala garantías históricas con salida financiera faltante.
- Checklists: `ChecklistRunMode.RONDA` y `AUDITORIA_SORPRESA`; una sola
  ejecución abierta por supervisor. Auditoría sorpresa exige alcance + muestra.
- Dashboard de auditoría: valida fecha aparente del PDF, reporta completitud,
  no marca verde con controles inciertos y guarda sólo huella técnica
  (SHA-256/tamaño/parser/fecha/completitud), nunca PDF, nombre ni texto crudo.
- Finalizar Supervisión exige confirmar revisión de críticos, auditoría y continuidad.
- Versión: 1.17.0. Migración: `20260927160000_blindaje_flows`.

## Actualización 27/09/2026 · Libro 1.16.0 · dashboard de auditoría

- Nueva carga dentro de `/supervision` para los informes diarios del PMS.
- Ruta de proceso: `POST /api/supervision/auditoria-diaria`; cada PDF se
  procesa por separado y se descarta después de extraer los datos.
- Persistencia nueva: `SupervisionAuditImport`, vinculada al turno de
  Supervisión activo y a una fecha de negocio.
- No se conserva archivo, nombre original ni texto crudo. Sólo se guardan
  métricas, controles, hallazgos y advertencias estructuradas.
- Formatos reconocidos: Formulario auditoría, Cobros, Ventas por canal,
  Producción por habitación, Salidas, Revenue, In house y Cargos diarios.
- Los escaneos sin capa de texto no usan OCR; se reportan como advertencia.
- El resumen se incorpora a `SupervisionShiftHandover.snapshot` al cerrar/
  entregar Supervisión. Finalizar un turno activo crea automáticamente ese
  snapshot si todavía no existía.
- Fecha predeterminada de carga: ayer según America/Santiago.
- El inventario de llaves continúa fuera del cierre de Recepción.
- Nueva migración `20260927143000_supervision_auditoria_dashboard`.
- Cobertura principal: `tests/supervision-audit-import.test.ts`.


## Actualización 27/09/2026 · Libro 1.15.2 · hotfix cron Hobby

- El deploy de 1.15.1 fue rechazado por Vercel porque `*/5 * * * *` no es
  válido en Hobby.
- El cron de outbox pasa a una ejecución diaria (`5 10 * * *` UTC).
- Cada envío operativo intenta además rescatar hasta 3 correos vencidos de la
  outbox, por lo que los fallos transitorios pueden recuperarse durante la
  actividad normal sin esperar al cron.
- La operación nunca queda bloqueada por SMTP.


## Actualización 27/09/2026 · Libro 1.15.1 · respaldo operativo por correo

- Entrega de turno: copia automática a eherrera@hoteleshw.com + recepcion@hoteleshw.com.
- Caja (ingreso/egreso/regularización), garantías/devoluciones, Novedades e
  Incidencias: copia automática a eherrera@hoteleshw.com.
- Reaperturas/correcciones generan nuevos eventos/correos; no se sobrescribe la historia.
- Outbox persistente `OperationalMailOutbox` con eventKey idempotente, intento
  inmediato y reintentos; SMTP nunca bloquea la operación.
- Nueva migración `20260927131500_respaldo_operativo_email`.
- Nuevo cron `/api/cron/operational-mail`.
- Cobertura: `tests/operational-mail.test.ts`.


## Actualización 27/09/2026 · Libro 1.15.0 · timers y recordatorios

- Nueva ruta `/avisos` para crear timers y recordatorios.
- Timers: cuenta regresiva; si nacen dentro de un turno de Recepción, se cancelan al cerrarlo.
- Recordatorios: sobreviven a los cambios de turno.
- Destinatarios: individual, grupo o global; global sólo Supervisión/Administrador.
- Las alarmas vencidas reutilizan el stream SSE existente, aparecen en un modal persistente y pueden detenerse o posponerse 5/10/15 min por destinatario.
- No hay plataforma adicional ni push del sistema operativo en esta etapa; una sesión cerrada recibe la alarma al reconectar.
- Nueva migración `20260927124500_avisos_operativos`.
- Cobertura principal: `tests/operational-alarms.test.ts`.


## Actualización 27/09/2026 · cierre guiado v3

- Release objetivo: **v1.14.9**.
- El cierre saliente pasa a un flujo secuencial: Caja/custodia → pendientes → revisión final → envío → cierre formal.
- El primer paso no puede saltarse mientras Caja/custodia sigan incompletas.
- Con Caja habilitada, `sendHandover()` exige el cierre formal de Caja además del arqueo.
- Enviar exige confirmación explícita y constituye el punto de no retorno del cierre normal.
- Cancelar exige confirmación, devuelve el turno a ACTIVO, invalida arqueos de preparación y reabre Caja formal si ya se había cerrado.
- Cancelar **nunca borra hechos financieros ejecutados**: las transferencias a Tesorería y sus movimientos sobreviven y reaparecen al reanudar el cierre.
- El inventario de llaves permanece fuera del cierre; sigue siendo un control autónomo que alimenta Supervisión.


## Actualización 27/09/2026 · Libro 1.14.9

- Cierre saliente guiado: Caja/custodia → pendientes → revisión → envío → cierre formal.
- Antes del envío se puede volver atrás o cancelar con confirmación explícita.
- Cancelar invalida la preparación, pero conserva transferencias y movimientos financieros reales.
- Si Caja ya estaba cerrada, la cancelación la reabre al devolver el turno a ACTIVO.
- El inventario de llaves permanece independiente del cierre.


## Actualización 27/09/2026 · turno de emergencia controlado

- Release objetivo: **v1.14.8**.
- El antiguo botón de «contingencia» se sustituye por una apertura de
  **emergencia** con advertencia previa, causa cerrada y aceptación expresa.
- `Shift` conserva `emergency`, motivo, turno de origen y momento de
  aceptación. La emergencia no cierra ni regulariza el turno saliente.
- El motor genera/reabre una alerta crítica automática
  `shift-emergency-source:<shiftId>` mientras el saliente siga sin cierre.
- Los turnos vencidos se alertan por falta de cierre formal incluso si ya
  enviaron la entrega.
- Tras publicar, regularizar en Production el turno vigente abierto el
  27/09/2026 bajo el flujo anterior y emitir comunicado obligatorio a TODOS.


> Canal persistente de continuidad entre ChatGPT, GitHub Copilot, Cursor/Codex y otros agentes.
> No guardar secretos, connection strings, passwords, tokens, cookies ni PII.

## Estado actual

- Fecha de referencia: **2026-09-27**.
- Versión vigente en Production: **v1.19.3**.
- Siguiente versión: definir según el próximo cambio aprobado.
- Código fuente de verdad: GitHub `Ericklhc1/Libroderecepcion`.
- Rama de release: `main`, protegida por ruleset y Compuerta obligatoria.
- Hosting único de Production: Vercel `libroderecepcion`, región `gru1`.
- Base de Production: Neon, rama `production` en `sa-east-1`.
- Flujo canónico: rama de trabajo → PR a `main` → Compuerta → merge →
  Vercel Production → health/smoke → tag `vX.Y.Z`.

## Auditoría profesional del 20/09/2026

- Production sirve exactamente `v1.1.2` y el SHA de `main`.
- El despliegue actual está `READY`; no registró errores `error/fatal` en la
  ventana revisada.
- Compuerta #436: 71 archivos, 738 pruebas aprobadas y una omitida; migraciones,
  lint, tipos y build en verde.
- Verificación local independiente: instalación reproducible, lint, tipos y
  build en verde.
- Las invariantes estructurales de habitaciones, estadías, llaves y turnos se
  comprobaron sin publicar datos operativos de Production.
- Informe completo: `docs/AUDITORIA_PROFESIONAL_2026-09-20.md`.

## Riesgos abiertos

1. La política de protección, respaldo y restauración de Neon requiere una
   revisión privada de infraestructura.
2. Existen residuos de previews históricos que no deben limpiarse sin una
   autorización explícita y una verificación privada de recuperación.
3. GitHub conserva una PR borrador y la rama/ruleset `preproduction`, ya
   reemplazados por el flujo directo a `main`.
4. `npm audit --omit=dev` informa cinco vulnerabilidades conocidas —cuatro
   altas y una moderada— en la cadena Next/PostCSS y Prisma/config. La solución
   automática exige cambios mayores; no ejecutar `npm audit fix --force`.
5. No existe todavía una prueba de navegador autenticada que recorra el turno
   completo. La cobertura actual es de servicios/integración más smoke público.

## Corrección de coherencia operativa v1.1.4

- El recorrido autenticado de Recepción y Supervisión encontró deriva en la
  matriz persistida de ambos roles. La migración
  `20260920180000_normalizar_roles_recepcion_supervision` la reconcilia con
  `ROLE_PERMISSIONS` sin perder políticas `requiresApproval` existentes.
- Recepción deja de ver validaciones de cierre de turno reservadas para
  Supervisión/Administración.
- Inicio ya no considera una llave correctamente asignada a una habitación
  ocupada como incidencia; sí detecta estados anómalos y vínculos obsoletos.
- Auditoría tiene acceso propio y «Administración» queda reservada a permisos
  técnicos.
- Los horarios se muestran como 07:00–20:00 y 20:00–08:00, sin cambiar la
  semántica de intervalos ni los límites de la lógica.

## Cierre de recorrido v1.1.5

- La portada `/admin` exige ahora un permiso técnico; Supervisión conserva
  Auditoría y el historial de turnos mediante sus accesos propios.
- El historial comunica el modelo real: los turnos no se programan y los
  relevos pueden solaparse, con una participación activa por persona.
- Supervisión sólo ve «Archivar» en estados que el servidor realmente admite;
  el Administrador mantiene su reparación forzada auditada.
- El nombre persistido de `shift.manage` deja de prometer programación y pasa
  a «Supervisar y administrar turnos».
- La carga PMS deja de exigir la plantilla exacta de FNS: admite PDF, Excel
  `.xlsx`, CSV y TSV; reconoce por significado ID, estado/tipo, llegada,
  salida, habitación, cliente/nombres/apellidos y campos auxiliares.
- Se aceptan columnas reordenadas, cabeceras en dos líneas, sinónimos
  español/inglés, IDs alfanuméricos y varios archivos del mismo tipo. Las filas
  idénticas se deduplican y las discrepantes permanecen visibles para revisión.
- La revisión previa muestra campos reconocidos/no usados y fechas. Siguen
  siendo obligatorios un ID inequívoco y un estado operativo; nunca se enlaza
  una reserva por nombre ni se aplican filas dudosas en silencio.

## Conciliación PMS v1.1.6

- La identidad operacional deja de incluir el estado. Una ocurrencia se
  identifica por reserva, habitación y llegada, usando localizador, huésped,
  salida, `businessDate` y estado previo para validar la transición.
- `CHECK_IN → IN_HOUSE → CHECK_OUT` actualiza una sola `RoomStay`; cargar los
  informes en otro orden no retrocede el estado y una extensión posterior
  puede reabrir una salida todavía pendiente.
- `ID` y `Localizador` se leen en campos separados. El ID de reserva manda;
  el localizador es evidencia secundaria y vía de enlace, nunca se concatena.
- Contradicciones de fechas, localizador, huésped, habitación o doble ocupación
  se omiten y se muestran como conciliación irresoluble para Supervisión.
- La migración `20260921103000_conciliar_identidad_estadias` normaliza de forma
  lógica y auditada las 10 transiciones duplicadas verificadas en Production y
  las 9 filas creadas por concatenación. Los payloads originales de
  `PmsImportBatch` se conservan como evidencia.
- Un índice parcial garantiza una sola fila viva por
  `(reservationId, roomId, arrivalDate)`. Las reentradas reales y los segmentos
  explícitos de room move conservan llegadas diferentes.

## Centro de Supervisión v1.2.0

- Rama de trabajo: `feat/centro-supervision-v1-2-0`.
- El Centro es una capa transversal: Novedades, Caja, Turnos y Llaves
  desembocan como señales sin duplicar la fuente operativa.
- `SupervisionShift` es independiente de `Shift`; Recepción nunca depende de
  que exista o cierre un turno de Supervisión.
- Hay un único Supervisor de Recepción: sus tareas y seguimientos sobreviven al
  turno y el flujo normal ya no contempla entrega a otro supervisor.
- **Seguir** crea/reutiliza un `FollowUp` enlazado por `sourceEntity + sourceId`.
- El Administrador conserva acceso técnico pero los servicios le impiden
  operar como Supervisor o entrar en asignaciones.
- Migración aditiva: `20260921170000_centro_supervision`.
- Documento técnico: `docs/CENTRO_SUPERVISION.md`.

## Reglas de continuidad

1. GitHub es la fuente de verdad del código.
2. `main` siempre debe ser desplegable.
3. Trabajo funcional normal: rama + PR a `main`; nunca commit directo.
4. La Compuerta debe quedar verde antes del merge.
5. No usar Neon Production para desarrollo interactivo, fixtures ni pruebas.
6. No crear otro hosting, staging persistente o rama de base de datos sin
   instrucción humana explícita.
7. Cada Production verificada debe tener un tag único `vX.Y.Z`.
8. No borrar ramas Neon de respaldo o `preview/*` sin autorización explícita.

## Siguiente acción

Resolver la higiene de infraestructura mediante una decisión humana explícita:

1. conservar o eliminar los previews históricos después de revisar en privado
   sus puntos de recuperación;
2. retirar la rama/ruleset `preproduction` y cerrar la PR obsoleta si se confirma que
   ya no tienen valor de recuperación;
3. definir una política de snapshot/restauración compatible con el plan de Neon;
4. planificar la actualización controlada de Next/PostCSS y Prisma sin usar
   correcciones forzadas.

## Mensaje para otros agentes

No reintroducir hosting alternativo, ramas intermedias de release, previews
alojados ni bases persistentes de desarrollo como parte del flujo. Para pruebas
usa el PostgreSQL efímero de CI o una base local desechable que nunca sea
Production.


## Observabilidad operativa P0 · v1.12.0

- Rama: `feature/observabilidad-operativa-p0`.
- Se añade una sola entidad aditiva, `OperationalMetricEvent`, sin FK ni
  snapshots operativos.
- La escritura usa `after()` y manejo tolerante a fallos: ningún INSERT de
  telemetría forma parte de la transacción ni de la respuesta crítica.
- P0 instrumenta apertura normal/contingencia, recepción, inicio/cierre de
  turno, arqueos, cierre formal de Caja y envío de entrega.
- El cierre completo se correlaciona por `shift-close:<shiftId>`; la recepción
  entrante usa `handover-receive:<handoverId>`.
- El arqueo mide desde la primera interacción con el formulario hasta su
  confirmación, no sólo el tiempo de servidor.
- `/supervision/salud` muestra datos observados para Hoy/7/30 días usando
  `supervision.center.view`, sin rankings individuales.
- Novedades reutilizan timestamps existentes. Fronti, tutorial, llaves y
  errores UI genéricos quedan deliberadamente fuera de esta etapa.
- Migración no destructiva:
  `20260926160000_operational_observability_p0`.
- Documento: `docs/OBSERVABILIDAD_OPERATIVA.md`.


## Observabilidad operativa P1 · v1.13.0

- Rama: `feature/observabilidad-operativa-p1`.
- P1 reutiliza `OperationalMetricEvent`; no añade tablas, índices ni
  migraciones.
- Novedades registra creación, primera entrada a `EN_CURSO` y primera llegada
  a `RESUELTO/CERRADO`, referenciando sólo IDs y tipo de registro.
- Inventario de llaves mide desde la primera interacción con el formulario
  hasta el guardado y marca diferencias sin copiar cantidades ni notas.
- Tutorial registra inicio, pasos alcanzados, cierre sólo de sesión,
  desactivación y finalización; no registra clics generales ni contenido.
- `/supervision/salud` añade tiempos de Novedades, inventarios y estado del
  Tutorial para Hoy/7/30 días.
- Fronti persistente y `ACTION_FAILED/ACTION_TIMEOUT` quedan fuera hasta P2.
- Documento: `docs/OBSERVABILIDAD_OPERATIVA.md`.


## Observabilidad operativa P2 · v1.14.0

- Rama: `feature/observabilidad-operativa-p2`.
- P2 reutiliza `OperationalMetricEvent`; no añade tablas, índices ni
  migraciones.
- Fronti persiste `FRONTI_REQUEST`, `FRONTI_SUCCESS`,
  `FRONTI_FAILURE` y `FRONTI_TOOL_CALLED` desde su colector central.
- Cada ejecución Fronti usa `fronti:<uuid>` como correlación y conserva sólo
  proveedor/modelo, duración, outcome, loops, tools y fallback; nunca prompts,
  respuestas, argumentos ni resultados de tools.
- `runAction` registra `ACTION_FAILED` sólo para errores inesperados; no
  convierte validaciones ni errores de dominio esperados en fallos técnicos.
- `ACTION_TIMEOUT` marca acciones que completaron en 20 s o más. Es un
  umbral técnico de observación, no un KPI ni una meta humana.
- `/supervision/salud` añade éxito observado, latencia media/mediana/P90,
  fallback y tools de Fronti, además de fallos/demoras técnicas transversales.
- El panel sigue sin desglose individual ni ranking.
- Documento: `docs/OBSERVABILIDAD_OPERATIVA.md`.


## Estabilización operativa · v1.14.1

- Rama: `fix/estabilizacion-operativa-v1-14-1`.
- Se añade una jornada E2E transversal en PostgreSQL efímero de CI que encadena
  Recepción, Libro, Llaves, Caja, relevo y Supervisión.
- Esa jornada detectó una calle sin salida real: tras cerrar, un participante
  saliente veía su propia entrega como `HANDOVER_PENDING` aunque el servicio
  le prohíbe recibirla. El gate ahora excluye cualquier entrega cuyo turno de
  origen incluya al usuario entre sus asignaciones.
- Los fallos conocidos de Fronti dejan de contaminar todos el canal
  `console.error`: desactivación es informativa y fallos temporales son warning.
- `/api/health/asistente` distingue disponibilidad de degradación parcial de
  la cadena de proveedores.
- `/api/health/storage` añade un HEAD firmado no destructivo para validar
  conectividad/TLS real de R2, no sólo presencia de variables.
- Production actual presenta una capa Cloudflare de Fronti degradada por
  `CLAVE_RECHAZADA`; Groq 120B y Groq 20B siguen sanos. No retirar el fallback:
  corregir credencial cuando exista acceso seguro a configuración.
- R2 Production resuelve el account ID desde el alias heredado
  `R2_ACCOUND_ID`; el código lo tolera y el healthcheck ahora lo advierte.
- La sesión de esta campaña no expuso navegador autenticado ni project_id de
  Neon. No se forzaron usuarios/datos de prueba en Production ni se intentó
  extraer secretos.
- Informe: `docs/ESTABILIZACION_OPERATIVA_2026-09-26.md`.


## Diagnóstico R2 · v1.14.2

- Base verificada: v1.14.1 / `8c99b05b5e0fdda3e07c6322868cd617f153623d`.
- v1.14.1 confirmó en Production que R2 está configurado pero no alcanza
  respuesta HTTP desde Vercel; el probe firmado devuelve `TypeError`.
- `/api/health/storage` se amplía de forma no destructiva para probar
  `default/us/eu/fedramp` y distinguir transporte de autenticación.
- La forma del Account ID se diagnostica sólo por presencia, longitud y patrón
  esperado; nunca se devuelve su valor.
- No se cambia todavía el host operativo, no se añaden blobs a Neon y no se
  modifica el contrato de adjuntos.
- Documento: `docs/DIAGNOSTICO_R2_2026-09-26.md`.


## Gate operativo R2 · v1.14.3

- Base: v1.14.2 / diagnóstico R2 en Production.
- El Chat deja de inferir disponibilidad por presencia de variables: usa salud real
  de R2 con probe HEAD cacheado 60 s y timeout de 2,5 s.
- Si R2 está caído, `storageEnabled=false` y la interfaz deshabilita archivos,
  notas de voz y creación de stickers propios sin bloquear mensajes, GIF ni
  Compartir Libro.
- Las APIs de adjuntos/stickers aplican el mismo gate y responden con error
  operativo claro en vez de intentar una subida/lectura condenada a fallar.
- El healthcheck añade diagnóstico booleano seguro para detectar si Account ID
  coincide accidentalmente con Access Key o Secret, sin devolver valores.
- Sin migraciones, sin cambio de permisos, sin almacenamiento de blobs en Neon.

## Actualización 27/09/2026 · v1.18.1 · regularización extraordinaria de turnos

- Se corrigen los turnos no demo que quedaron abiertos hasta el 27/09/2026 bajo versiones anteriores del relevo.
- La migración enlaza las entregas históricas pendientes con el turno que continuó cronológicamente la operación y refuerza explícitamente DÍA 27/09 con Humberto → NOCHE 27/09 con Yailin.
- El último handover sin receptor posterior queda ANULADO con motivo administrativo para no bloquear la siguiente apertura.
- Ningún arqueo físico se fabrica retroactivamente: cuando falta un cierre de Caja, la constancia creada se identifica expresamente como regularización administrativa y usa un snapshot vacío.
- Las alertas de validación de los cierres del 26–27/09 quedan resueltas bajo autorización de Supervisión y las tareas vinculadas pasan a VALIDADA.
- En adelante, resolver una alerta `shift-validation:*` valida también su tarea vinculada para evitar el estado contradictorio «alerta resuelta + tarea pendiente».
- Migración: `20260927214500_regularizar_turnos_26_27_sept`.

## Etapa 2 · ampliación en verificación (2 octubre 2026)

Continuar hasta resolver la etapa solicitada; no cerrar sólo por completar un bloque.
Base remota antes de esta ampliación: PR #244, SHA 818108d7, Compuerta 37029291952 verde. PR #241 sigue abierto; #244 depende de su rama. Sin merge, despliegue, migración en Neon, datos operativos ni comunicaciones reales.

Cambios nuevos: catálogo 184 adaptadores; formularios privados de secretos/archivos y entrega única de credenciales; delegaciones dinámicas en FrontiExecution (migración aditiva 20261002170000), usos/acciones/presupuesto acumulados y revocación de pendientes; suplencia PROPOSE/APPLY en OperationalAutomation con servicios nativos de Coordinación/HK; indicadores por período y turno propio con muestras, privacidad, eventos y estimaciones explícitas. La simulación sigue inerte y el interruptor global no se activa.

La lectura Vercel get_project funciona pasando idOrName además de projectId; no expone variables y CRON_SECRET sigue sin verificarse. No hay iPhone/Safari físico. Estas limitaciones no bloquean seguir desarrollando.

Verificación de esta revisión: dominio local anterior 143/143; nuevas pruebas PostgreSQL y navegador añadidas, resultado CI aún pendiente. No dar cobertura general por registrar adaptadores: revisar matriz y acreditar contratos/recorridos restantes, especialmente atomicidad de revisión de todas las variantes y rutas HTTP/exportaciones. No publicar secretos ni datos reales. Próximos pasos: completar comprobaciones nuevas, corregir CI, revisar Copilot y actualizar evidencia por SHA.

## Corrección de compuerta y cuarta revisión Copilot

CI 37037311294 sobre 0e114e0e: 1418 aprobadas, 4 fallidas, 1 omitida; fallo PostgreSQL 23514 por CHECK de autorización que no admite DYNAMIC. Build/navegador omitidos. Se amplía el CHECK conservando ventanas, parentesco y límites, con regresiones negativas. Revisión Copilot 5394563088 recibida: también se corrigen fin de día inclusivo, enlace a indicadores y recuentos obsoletos. Revisión autorizada propagada a edición/asignación/archivo/restauración de tareas, novedades, seguimientos y garantías: comparación dentro del servicio y CAS/lock en la escritura. No basta la comprobación previa del chat. Dominio local 143/143, lint con dos avisos previos; nuevo CI requerido. Producción intacta.

## Entrega autorizada · 2 octubre, 14:42 Santiago

El usuario autorizó explícitamente integrar/desplegar después de compuerta; la prohibición anterior de publicar quedó sustituida. PR #241 fusionado en main: 8fcfe2a0966c352ed9eb600ff051a963b6fc35fa, mismo árbol que su head aprobado 50fb561e. PR #244 retargeteado a main, sin cambios funcionales nuevos. Su bloque SQL/CAS tiene CI 37039196791 verde: 1424 pruebas + 1 omitida, 153 archivos, migraciones PostgreSQL 16, lint/tipos/build y navegador 1280/390. Artefacto 11242060533.

CRON_SECRET confirmado como Secret de Production en la interfaz Vercel, agregado por el usuario, sin leer valor. Su redeploy 1.45.0 dpl_GbRr5NpDAcpVzTBjzjWrxfgTCLKf está READY. Despliegue 1.46.0 dpl_9cE2YRUeALVcrK5WGULzz1bbopUD en curso. Verificar salud SHA/versión y registros cron bajo autenticación estricta; esperar Release antes de la siguiente versión. No activar políticas nuevas ni realizar pruebas operativas reales.

Copilot: cuatro revisiones reales; respuesta 5394647977 indica cuota agotada y no constituye quinta revisión. No habilitar sobrecoste. Safari físico sigue pendiente. Siguiente acción: compuerta de #244 reconciliado con main, integrar una vez verde, verificar 1.47.0, después continuar cobertura restante por grupos.

## 1.47.0 publicada y siguiente bloque de continuidad

PR #244 integrado: 26331193bfe1b07f1ff87da4942bb8d9fb6d74c7. Vercel dpl_7rn6caSVB4pbuMNZcDwBzF89JqrB READY, salud 1.47.0/SHA exacto, las tres migraciones de Fronti aplicadas según build logs, cron web-push 200 y nuevas automatizaciones globalmente desactivadas. Compuerta main 37043659344 y Release 37044358938 aprobados; tag v1.47.0 creado. La comprobación posterior del main 1.46.0 agotó 3 minutos del navegador (1352 pruebas/build pasaron); #244 corrigió el transporte y pasó los recorridos completos sin ampliar límites.

Bloque separado 1.47.1, rama fix/etapa2-continuidad-registros: los pasos sucesivos sobre el mismo registro conservaban todos el hash inicial y se detenían por su propio primer cambio. Las acciones de edición/asignación/estado de tareas, edición/estado de novedades y edición de seguimientos devuelven hash del registro realmente confirmado por el servicio. El ejecutor avanza sólo las revisiones de pendientes del mismo registro y misma revisión original; jamás vuelve a consultar el estado para asumirlo autorizado. Cambio externo sigue provocando CHANGED; permiso, caducidad, cancelación e inspección independiente se revalidan normalmente. Sin migración. También se omiten gravedad/impacto vacíos de novedades, conservando semántica nativa de campo no aplicable.

Cinco regresiones PostgreSQL agregadas: continuidad/reintento, cambio externo entre pasos, misma identidad no inspecciona, novedad editar-atender-resolver-archivar-restaurar y seguimiento vinculado editar-resolver-archivar-restaurar. Verificación CI pendiente; no atribuir aún esta ampliación a producción. Copilot sin cuota de revisión, no insistir ni habilitar sobreconsumo.


### PR #247: fallo reproducido y revisión corregida

Compuerta 37044898523: 1428 aprobadas, 1 fallida, 1 omitida. Edición de NOVEDAD enviaba occurredAt=null a columna obligatoria; Prisma mostraba Unknown argument departmentId al rechazar el conjunto de entrada. Se conserva la fecha registrada si no se comunica una corrección; una fecha explícita sí la reemplaza. Gravedad/impacto vacíos se interpretan en el esquema nativo como null, en vez de suprimir la intención de borrar impacto. Incidencias mantienen gravedad obligatoria.

Revisión automática Codex 5395154247 (no Copilot) identificó además hash anterior a ensureIncidentWorkflow y borrado de impacto omitido. Edición y aseguramiento del flujo quedan en una transacción con bloqueo del registro; sólo se devuelve la revisión final bajo ese bloqueo. No se toma una lectura posterior al commit como autorización. Nuevas regresiones cubren incidencia encadenada sin duplicar tarea/seguimiento, impacto vaciado, fecha conservada/corregida y rechazo de gravedad vacía. Se requiere nueva compuerta completa antes de integrar. Sin cambio en producción 1.47.0.

## Etapa 4 · bloque de asuntos, validación 4 octubre 2026

Producción comprobada: 1.52.0 / 0b05951 / PR #260. PR #261 (1.53.0) todavía sin publicar. La lista única de esta etapa permanece en docs/etapa4/PENDIENTES.md.

Compuerta 37177496401 falló al detectar el marcador sintético privado en el navegador. La repetición diagnóstica 37177967115 sobre 6c34ccd aprobó 1492 pruebas, build y recorridos 1280/390 sin reproducir la proyección; no se atribuye causa demostrada a esa intermitencia. La consulta PostgreSQL confirmó que la reserva canónica excluye tanto seguimiento como tarea vinculada. Se protege además la lectura de opciones de formularios y la bandeja de tareas con el mismo alcance reservado, antes de serializar datos al cliente. La siguiente compuerta debe acreditar estos cambios.

Correcciones de revisión Codex: sólo el responsable asignado confirma recepción; la validación específica conserva separación de ejecutor; resultados devueltos se identifican como último intento histórico; clics desconocidos no heredan la etiqueta Más en telemetría. Sin motor nuevo ni migración de este bloque. No atribuir mejoras preparadas a producción ni inferir abandono de un resultado pendiente.

Compuerta 37178544968 (1338b46): 1493 pruebas y build aprobados, navegador fallido. El diagnóstico identifica la proyección en Historial (evento Seguimiento), no en la consulta principal ni las opciones. getHistory ahora recibe explícitamente al lector y reutiliza followUpReadWhere para eventos y comentarios vinculados; no altera ni elimina evidencia. Regresión PostgreSQL verifica exclusión para terceros y conservación para el autor. La anterior repetición verde no basta como prueba de ausencia; se exige una Compuerta completa del head corregido.

Revisión Codex 5404428941 (1338b46) encontró alcance pendiente en el lector común de Libro, transiciones distintas de validación y etiqueta del resultado en detalle de tarea. Se propaga identidad al lector común, informe PDF y contexto Fronti; tareas, seguimientos, alertas legadas y conteos vinculados usan reserva canónica. Transición y edición de tarea comprueban reserva en servicio; la acción nativa la comprueba para todos los estados. Evidencia rechazada permanece como último intento histórico, tanto en origen como en detalle. Regresión verifica lecturas, historial y denegación sin cambio de estado para un tercero, incluida cuenta administrativa. Nueva compuerta y revisión requeridas antes de publicar.


## Etapa 4 · PR261 en validación · reserva y resultado

1.53.0 aún no publicada. Codex 5404461583 encontró lecturas y mutaciones que omitían la reserva del seguimiento de origen: contexto de Fronti, monitor de habitación, búsqueda y asignación/checklist/archivo/restauración. Se propaga actor obligatorio y alcance nativo al servicio, consultas, búsqueda SQL antes del LIMIT y CAS de escritura; Inicio, Gerencia y Supervisión reutilizan el mismo criterio. Checklist y evidencia auditada quedan en la misma transacción. No se crea motor ni tabla.

La NOVEDAD conserva la regla existente de resultado opcional en ambas entradas; la INCIDENCIA exige resolución al resolver/cerrar en el servicio. Ver resultado apunta a su evidencia; sin ella, Ver historial evita prometer contenido inexistente. Pruebas PostgreSQL ampliadas con IDs privados conocidos, lectura autor/tercero y denegación sin cambio; navegador cuenta visibilidad efectiva, no geometría de descendientes de details cerrado. CI 37179634842 aprobó PG/tipos/lint/build y recorridos previos, pero falló el conteo de acciones del bloque: requiere nueva compuerta completa, revisión sobre el nuevo SHA y publicación verificada. Pendientes exclusivamente en docs/etapa4/PENDIENTES.md.


Codex 5404515370 sobre a72f00ba: cuatro hallazgos corregidos. Búsqueda de Alert comprueba los dos orígenes antes del LIMIT; se reutiliza el mismo alcance en lectura interna, enlace de Supervisión y mutaciones nativas, sin modificar reglas financieras. INCIDENCIA requiere resolución no vacía tanto RESUELTO como CERRADO en servicio y formulario; NOVEDAD sigue opcional. Novedad sin resultado muestra Ver historial. Telemetría conserva inicio/intención al enviar diálogo, contabiliza un intento y reinicia sólo al reintentar tras resultado observado; visibilidad tiene alternativa compatible si checkVisibility no existe. Regresión PG de alerta privada (dos orígenes) y resolución; navegador acredita contador/duración desde formulario y reserva una vez renderizado.

Compuerta 37180883635: PG/lint/tipos/build y recorrido nuevo de Asuntos 1280/390 aprobados; fallo ajeno reproducido en lectura evaluate durante navegación de prueba Etapa2/políticas. Se sustituye por lectura getAttribute con espera/reintento nativos de Playwright, conservando las aserciones y presupuesto. Exigir compuerta completa del siguiente SHA antes de publicar.


### Etapa 4 · PR261 · reserva transversal y asignación sin pérdida

La revisión de eb54977 halló receptores sin acceso al origen, origen de alerta incompleto, comentarios/correo por ID, señales de Fronti, briefing/snapshot, eliminados/restauración, rendimiento/tablero y borrado involuntario de causa/resultado al asignar. Corrección preparada: predicados nativos antes de lectura/escritura, destinatarios elegibles, origen heredado, snapshot compartido sin contenido reservado y presentación histórica con referencia redactada sin borrar evidencia ni controles. Campos de causa/resultado omitidos permanecen intactos; vacío explícito conserva la semántica de edición. Pruebas PG dirigidas añadidas; no se atribuye aprobación ni publicación hasta Compuerta y producción del SHA exacto. El único fallo de regresión anterior fue la expectativa literal del mensaje de rechazo de resultado vacío en Etapa 3, manteniendo comprobación de rollback. Lista única: docs/etapa4/PENDIENTES.md.
## AROH Simple · bloque roles/excepciones preparado (1.55.0, sin publicar)

Entradas nativas por rol/área: Recepción mantiene Inicio/turno; Mantenimiento prioriza por recibir; Housekeeping su trabajo; Supervisión excepciones; Gerencia decisiones. Coordinación y HK reutilizan búsqueda/área/estado y Más filtros, antes de paginar/contar, conservando rutas históricas y alcance. El trabajo vinculado muestra folio del origen con responsable y estado efectivos, evita raíz falsamente sin responsable. Supervisión abre fuentes reales para seis señales; críticos/vencidos explicitan muestra disponible, continuidad anterior no implica automáticamente riesgo. No nueva bandeja/motor/tabla ni cambios financieros. PostgreSQL y navegador de roles/390 están preparados y necesitan CI, Codex y despliegue comprobado. Pendientes únicamente en docs/etapa4/PENDIENTES.md.

## 2026-10-05 · propuesta local: diálogos de cierre de turno

Base 13304d03d9c0a77a7e5c40a8296146e7ad48b20f; sin integración ni publicación. Enviar entrega, cancelar preparación y cerrar turno (con y sin guía) reutilizan `Dialog` con el `ActionForm` completo dentro del portal: error visible y vínculo HTML nativo conservados. Mientras la acción está pendiente se bloquean Escape, X, fondo y Volver; el mensaje aclara que ya está en curso. Un rechazo mantiene el formulario; sólo el éxito explícito cierra y conserva el refresh/push anterior. No cambia la regla operativa ni `ActionForm`. Una excepción de transporte muestra resultado no confirmado (podría haberse completado), conserva campos y exige revisar el turno antes de reenviar; no reintenta automáticamente. Los errores de control de Next con digest `NEXT_` se relanzan intactos.

`Dialog` mantiene un único ciclo de foco, pila y scroll mientras cambia `dismissible`; su listener lee el valor vigente y el diálogo superior consume Escape incluso si está bloqueado. La prop opcional `overlayClassName` conserva `no-print` únicamente en los diálogos migrados; los consumidores anteriores mantienen su comportamiento de impresión. El bloque de navegación inicial es independiente y no forma parte de este diff.

Regresión aislada: `scripts/ui/shift-dialog-repro.cjs` usa el renderer real empaquetado por Next, jsdom suministrado por el entorno y acciones sintéticas. Cubre las cuatro variantes, foco/Tab/Escape/X/Volver, pending/doble clic, rechazo/éxito, enlace nativo del formulario, validación required, restauración de campos tras error y reintento; también consumidores existentes/anidados, cambio de dismissible, callbacks actuales y scroll. El modo `--baseline` reproduce los fallos originales. No representa prueba en navegador, servidor ni base de datos. Incluye envío inmediato/Escape y envío antes del primer efecto de FormStatus; una señal inicial pending=false no desbloquea una operación en curso. Lint focal, sintaxis del script y 22 pruebas focales de gate/UX aprobados, conservando el contrato de permisos y reemplazando la expectativa obsoleta de cerrar ante error. Typecheck integral no acreditado (primera ejecución terminada con 137; repetición detenida por coordinación de memoria). Build, suite PostgreSQL y QA visual pendientes de validación conjunta; no usar producción.

## 2026-10-05 · validación conjunta de dos reparaciones UI de Turnos

Se combinan navegación inicial y diálogos sobre el árbol 1d00af932fe5042ee3d0be5c4517dbf6b7f24a4c (checkout 13304d03, equivalente al merge main 5a287748). El adaptador de los dos formularios iniciales avanza tras respuesta explícita incluso si la revalidación desmonta el formulario; conserva rutas alternativas, ActionState/FormData y router.push sin recargar el shell. Coalesca envíos repetidos, limpia listeners y no avanza ante rechazo o una nueva intención de navegación detectada. Sin Navigation API, una salida/vuelta programática a idéntica URL sin eventos de enlace/historial puede eludir la guardia; no se afirma cobertura universal.

Verificación conjunta local: 174 pruebas focales en 14 archivos, 10 escenarios de navegación con renderer real y nueve grupos de diálogos aprobados; lint completo aprobado con dos advertencias de imports de tipo preexistentes en servicios no modificados. Las comprobaciones de tipos focales de componentes nuevos/compartidos pasan con el contrato ActionState exacto aislado del grafo servidor. El único typecheck integral conjunto terminó por SIGKILL (equivalente 137), tras 8,69 s y RSS máximo 1.351.420 KiB; no emitió diagnósticos y no acredita aprobación. Build, suite PostgreSQL y prueba de navegador del conjunto siguen pendientes de Compuerta sobre SHA publicado en rama. No se cambia workflow, Vercel, versión, servicios, reglas, permisos, esquema ni dependencias. La preparación de CI no autoriza promover a Production.

## 2026-10-05 · escenas de navegador dirigidas de Turnos, preparadas para CI

Sobre cb8a214b (árbol 834be446), `scripts/ui/shift-ux-browser.mjs` se invoca al final del recorrido de superficies existente, sin cambiar workflow, límites, caché ni artefactos. En 1280/390 comprueba avance automático de preparación/recepción sin pulsar Continuar; las cuatro variantes de cierre/entrega/cancelación mantienen errores reales del servidor dentro del diálogo, bloqueo durante pending, foco/Tab/Escape/X/Volver, reintento explícito, un solo POST y evidencia nativa de estados/auditoría. En escritorio, una navegación elegida durante la petición debe prevalecer sobre el callback tardío. Se exige el mismo documento y borrador Fronti intacto, sin enviar mensajes al asistente.

Las fixtures se reinician sólo en PostgreSQL CI de loopback, bajo el guard existente y con contextos previos cerrados. La espera de servidor se produce con un lock breve de User, liberado en finally; no se fabrica ninguna respuesta. Las precondiciones de rechazo cambian únicamente fixtures sintéticas (revisión pendiente, rol temporal del actor, Caja sin arqueo). SMTP por entorno y base debe estar ausente; la outbox no puede registrar envío externo. Los formularios actuales no tienen campos editables, así que no se atribuye a este recorrido restauración de texto interno. La evidencia va al JSON/log de superficies ya existente. Lint/sintaxis y 177 pruebas focales locales aprobados; navegador dirigido y suite integral pendientes del nuevo SHA de CI. No desplegar ni promover a partir de esta nota.

## 2026-10-05 · doble submit antes del primer pintado

Compuerta f25d1330 aprobó tipos, suite y build, pero el nuevo recorrido se detuvo durante Cancelar cierre pendiente. La promesa de respuesta del arnés no tenía manejador temprano y su rechazo al cerrar ocultó la aserción inicial. Se conserva ahora el error/cuenta original, se espera el request real antes de medir y no se relaja ningún resultado esperado.

La investigación aislada con renderer real reprodujo dos llamadas de acción tras dos clics anteriores al pintado de disabled. El wrapper local del diálogo captura el primer submit de forma síncrona y descarta el segundo antes de que React lo encole; no cambia ActionForm ni acciones servidor. La guarda se libera cuando el error ya está presentado o ante éxito. La reproducción pasa de dos llamadas a una y permite un reintento explícito después del rechazo, manteniendo validación HTML, campos, pending, foco y controles Next. Diez grupos de diálogo, lint y pruebas focales aprobados localmente; nueva Compuerta y recorrido auténtico requeridos.

## 2026-10-05 · resultados nativos, retorno y fixture determinística

El ensayo aff73c2b mostró el rechazo real de Cancelar dentro del modal y un único POST; falló la búsqueda literal del mensaje en los bytes Flight. El arnés ahora observa pasivamente `aroh:action-result`, correlaciona formId e intento y exige ok:false/true junto al mensaje visible, persistencia y auditoría. No acepta HTTP 200 como éxito ni fabrica respuestas. El error vuelve a enfocar su panel conectado, conservando la captura original de foco del diálogo.

Cancelar/Cerrar se incorporan al mismo adaptador cliente acotado: sus contratos exitosos sin ID vuelven a /turno aunque la revalidación retire el formulario, pero una navegación posterior del usuario prevalece. La reproducción con renderer real y desmontaje modelado fallaba antes con cero retornos y ahora acredita una acción/retorno, rechazo/reintento y ausencia de retorno ante ruta nueva. ActionForm y servidor permanecen intactos.

El otro fallo de Libro correspondió a filas de fixture con createdAt empatado: el servicio ordena sólo por fecha y dos órdenes válidos de las mismas 55 tareas cambian la pertenencia de página 2. Se reprodujo ese mecanismo sobre el lector real con Prisma simulado; el run no captura el plan SQL exacto. La fixture de tareas recibe fechas distintas, como ya hacía la de novedades; se conservan todos los asserts, filtros, Back/Forward y esperas. No se modifica el orden servidor; su desempate determinístico queda como revisión heredada separada. Validación focal local: 182 pruebas, lint y 14 grupos de renderer aprobados. Nuevo recorrido real/Compuerta requeridos antes de promoción.

## 2026-10-05 · candidato conjunto local de 1.58

Integración aislada sobre aff73c2b: mantenimiento y recuperación administrativa fuera del shell operativo, más el parche UX de resultados nativos/retorno de Turnos. El parche UX se aplica sin conflictos sobre la integración de mantenimiento; no se modifican servicios de operación, estados servidor, roles, cuentas, permisos, migraciones ni versión 1.58.0. Los worktrees de origen se conservan.

Verificación focal local: 211 pruebas PostgreSQL/dominio/interfaz y 14 grupos del renderer real con jsdom aprobados; lint focal de aplicación, pruebas y scripts MJS correcto. El arnés CJS pasa sintaxis y renderer; su ejecución con las reglas ESLint de TypeScript reproduce seis avisos de estilo como errores que ya existían sin el parche (require/module), sin cambios para silenciarlos. No se ejecuta build ni typecheck integral local por el límite de memoria conocido.

La Compuerta de 1.58 incorpora un paso separado para `scripts/maintenance/browser.mjs`, con fixture PostgreSQL sintética reiniciada, bloqueo de salidas externas, cierre del servidor y fallo explícito si el recorrido falla. Conserva todos los pasos anteriores, permisos, disparadores, límites, caché/artefactos desactivados en la rama candidata y reglas de despliegue. YAML y shell validados; tres pruebas de contrato del workflow aprobadas. El código conjunto aún necesita Compuerta integral y navegador del SHA final antes de publicación de Production; los resultados previos de otras revisiones no se trasladan como aprobación de este conjunto.


## 2026-10-05 · espera de resultados nativos en el arnés de Turnos

Compuerta 37326644571 sobre 0c905cc1 aprobó tipos, regresiones, build, mantenimiento, Libro y bloque 2 en escritorio/móvil. El grupo inicial agotó sus tres minutos tras `cancel-explicit-retry`, sin evidencia de la espera interna exacta. Se verificó en Playwright 1.63 que `response.finished()` no usa el timeout de página y puede esperar indefinidamente el fin del transporte. Eso no equivale al retorno de la Server Action: ActionForm emite el recibo nativo después de `await action`, mientras Flight puede seguir transmitiendo el árbol.

El arnés deja de esperar el EOF antes del recibo, conserva formId/intento, resultado único y ok esperado, y mantiene ruta, estado de base, auditoría, POST único y borrador Fronti. La escena de navegación posterior también exige ese recibo, sin retorno manual ni respuesta fabricada. Marcadores de fase y límites de recibo/captura diagnóstica permiten reportar la causa antes del timeout; los tiempos de CI no cambian. Ocho pruebas aisladas del observador (stream sin terminar, rechazo, ausencia/duplicado, fallo original y timeout) y seis contratos pasan, junto a lint/sintaxis. Son pruebas del arnés con promesas y páginas simuladas, no una reproducción real del bloqueo de navegador. La causa exacta del run sigue siendo hipótesis hasta la siguiente Compuerta; no se modifica código de aplicación.

## 2026-10-05 · preparación documental local, sin capacidad remota nueva

Se añade `/supervision/documentos` como acceso aislado desde Supervisión bajo permisos vigentes center.view/audit.create. PDF/XLSX/CSV/TSV permanecen en memoria del navegador, con original descargable, PDF en canvas, evidencia por página/coordenada o hoja/celda, selección/corrección humana, sumas por moneda exactas, fechas estrictas y versiones exportables. El parser CSV canónico se mueve a dominio puro con defaults compatibles. No se modifica el flujo persistido actual de auditoría diaria.

La UI identifica **borrador local, no compartido, no registrado**: preparar aprobación/devolución no es una decisión operativa autenticada. La sesión se pierde al salir; exportar JSON y original es explícito. No hay persistencia compartida, subidas cloud, IA nueva, correos, cambio de cadena de Fronti, servicios, permisos, dependencias o migraciones. Capacidad/cuota real no acreditada mantiene cerrados almacenamiento e inferencia. El contrato de futura persistencia autorizada, seguridad y límites está en `docs/REVISION_DOCUMENTAL_MANUAL.md`.

Verificación inicial: 62 pruebas focales con PostgreSQL efímero (39 nuevas, 23 de importadores existentes) aprobadas; lint y tipos focales aprobados. Dos intentos del arnés aislado Next/Chromium terminaron en compilación sin diagnóstico y no acreditan QA visual. Build, tipos/suite integrales y ruta autenticada pendientes del conjunto; no usar estos resultados como autorización de producción.


### Recorrido documental integrado de CI

El arnés documental pasa a reutilizar el Next compilado/servidor y `/tmp/etapa1-fixture.json` existentes. Se invoca con el adaptador Playwright actual y el guard de PostgreSQL loopback/CI; no inicia compilador, servidor ni nuevas sesiones de base. Cubre permisos de la ruta real, workers CSV/XLSX/PDF, canvas, evidencia, correcciones/devolución local, deduplicación por bytes, rechazo sin perder borradores, exportación de JSON/original, escaneo con transcripción, límite de páginas, móvil y alcance entre usuarios. Bloquea HTTP externo y mutaciones; aún requiere ejecución en CI. Se detuvieron los ensayos locales para no competir por memoria con la integración.

## 2026-10-05 · revisión focal del candidato: decisiones sobre el origen vigente

Las decisiones por área ya validaban la versión de la atención, pero no la revisión del asunto que había leído la persona. Se incorpora `sourceRevision` obligatoria desde el formulario hasta el servicio y se compara bajo el bloqueo del origen. Si el contenido cambia conservando la misma versión de la atención, se rechaza la decisión sin escribir estado ni auditoría y se exige volver a leer; con la revisión actual puede continuar. La distribución sigue apagada por defecto y no se modifican permisos, índice global, plazos ni políticas de urgencia.

Cuando no hay una guardia elegible, formulario y error explican que el asunto original sigue guardado y que puede continuarse por el canal directo vigente con jefatura/guardia. No se inventa un destinatario ni se presenta un aviso como recibido. Verificación PostgreSQL desechable: 24 casos en distribución/recuperación aprobados, incluida la regresión del origen cambiado; navegador y compuerta integral del candidato posterior aún pendientes.

## 2026-10-07 · HK-2 · Housekeeping 1.62.0

Base main 660e0915 / #276. Rama feat/aroh-housekeeping-hk2-20261006. Tablero de habitaciones derivado únicamente de limpiezas modernas visibles del día y pendientes anteriores: sucia, pendiente inspección, limpia inspeccionada y sin registro. Prioriza pendientes sobre resultados y enlaza al mismo trabajo por folio; no modifica PMS ni inventa limpieza sin evidencia.

RESOLVER integrado en changeHkWork/WorkActionCluster: en POR_REVISAR exige housekeeping.inspect, otra persona y registra inspectedAt/inspectedById conservando el resultado de ejecución; en EN_GESTION sin inspección exige housekeeping.assign. Conserva APROBAR, permisos por área/cobertura, nota obligatoria, versión optimista, origen vigente, dependencia de Mantenimiento, eventos y auditoría. Sin migraciones, datos históricos ni cambios de HK-1.

Validación local: 18 pruebas de dominio/UI aprobadas y typecheck aprobado. Lint con los tres avisos previos. Integración local bloqueada por ausencia de PostgreSQL; no se usa ninguna base remota del hotel. La suite completa y recorridos autenticados requieren Compuerta del SHA candidato antes de integrar.

Compuerta inicial 37620226742 / PR #277 / SHA 2cb301ce: 215 archivos y 2.253 pruebas aprobadas (una omisión preexistente), tipos, build, fechas Santiago/UTC y todos los bloques de navegador posteriores aprobados. Fallo determinado en scripts/etapa3/browser.mjs: intentaba pulsar directamente «Aprobar revisión», ahora dentro de Más tras priorizar Resolver. No es una falla intermitente ni se amplían timeouts. Se actualiza el recorrido a Resolver y se agregan comprobaciones reales de tablero sucia → pendiente inspección → limpia inspeccionada, evento RESOLVER y ausencia de resolución para la mucama, en escritorio y móvil. Sintaxis y lint del arnés aprobados; se exige nueva Compuerta del SHA final.

## 2026-10-07 · candidato 1.63.0 · Nivel 1 restante y cancelar apertura

Base exacta main 3d7adf9187f9b689780a574bbde604314f2203ff / #277; rama feat/aroh-nivel1-resto-20261007. Fecha de turno en ficha usa formatCalendarDate como la lista, sobre el motor Santiago existente. Novedades e indicadores dejan de filtrar por rol del creador; Supervisión incluye sus novedades asignadas usando getBookItems con paginación propia, y el filtro de responsabilidades no suprime un asunto por hijos asignados a otra persona.

Auditoría global queda excluida de los permisos efectivos del mesón; el nuevo entry.content.edit separa texto de atención/reasignación. Concesiones nuevas fuera del mesón copian sólo los permisos de edición existentes; no se eliminan grants históricos ni se modifica la configuración de HK. UI, action y catálogo Fronti comprueban el mismo permiso de contenido; eliminar conserva entry.delete. Fronti deja de esperar stopTyping antes del POST, con indicador accesible y timeout/errores claros en ambas superficies. El bloqueo del heartbeat es una causa posible acreditada por el orden de llamadas del cliente; no se atribuye el incidente concreto de 40 segundos a un proveedor sin logs de ese intento.

/admin/limpieza permite retirar individualmente mensajes Fronti privados/Chat, notificaciones, movimientos/arqueos de Caja y HK: sólo SysAdmin, confirmación escrita, motivo, CAS y auditoría obligatoria atómica. Modelos nuevos de eliminación lógica se filtran canónicamente al leer/mutar; SQL de memoria y relaciones HK también excluyen eliminados. Caja reutiliza voidedAt/affectsExpected, conserva documentos y snapshots históricos. El retiro individual desde /admin/turnos reutiliza removeShiftMember, conserva la participación y promueve apoyo; SysAdmin puede retirar la última persona dejando ANULADO, sin archivar ni borrar el turno. El flujo operativo ordinario sigue impidiendo dejarlo sin personas. Limpiezas no generan avisos externos.

Solicitud urgente incorporada: cancelSupervisionOpening sólo actúa sobre PREPARACION transversal del iniciador o SysAdmin, con CANCELAR, motivo y auditoría obligatoria. Conserva openingState, no marca un inicio ni un cierre operativo. CANCELADO es terminal; permite nueva preparación. Expiración por medianoche de America/Santiago, visible en panel propio y listado administrativo de preparaciones ajenas. Activar y cancelar toman el mismo bloqueo de fila.

Migraciones 20261007120000_nivel1_admin_cleanup y 20261007121000_supervision_cancel_opening exclusivamente aditivas. No se ejecutaron sobre Neon/Production. PostgreSQL local desechable para pruebas. Primera suite integral: 2.268 aprobadas y tres fallos (catálogo de nueva pantalla, contrato textual de notificaciones y manifiesto PDF previo de .next). Los dos contratos se actualizan a la conducta pedida; el PDF se revalida sobre build regenerado, sin omitir asserts. Verificación integral final y Compuerta pendientes al preparar este candidato. No merge ni verificación del sitio: los realiza el usuario.

La segunda suite integral detectó timeout del test preexistente de fallo SMTP contra un hostname inexistente: el primer run lo aprobó y el segundo agotó 30 s sin cambios en correo. Su transporte depende del DNS del entorno y del timeout predeterminado de Nodemailer. Se sustituye únicamente esa fixture por un servidor SMTP sintético de loopback que rechaza con 421, manteniendo el envío real de Nodemailer, la comprobación del resultado fallido y la persistencia del detalle, reforzadas con el texto concreto del servidor. Sin cambios al runtime SMTP ni aumento de límites; no se entrega ningún correo externo. Reproducción focal e integral final requeridas.

La revisión React mantiene los permisos en servidor, tipos de servicio importados sólo como type, diálogos y formularios compartidos, indicadores aria-live y cargas independientes en Promise.all. Asignado a mí utiliza getBookItems con paginación propia para Novedades; Mis responsabilidades mantiene getCoordinationBoard y su agrupación nativa.

## 2026-10-07 · revisión automática del PR #278 · cinco hallazgos

Se corrigen los cinco comentarios en la misma rama, manteniendo 1.63.0. Retiro final bloquea la fila del turno, reutiliza releaseIncompleteShiftReception (extraído de cancelShiftAction sin relajar Caja/custodia) y endShiftLifecycle (participación + cancelShiftTimers compartido con cierre/anulación), todo en la transacción auditada. SQL de memoria TURNO exige deletedAt IS NULL. updateEntryAction exige también entry.edit si se presenta cualquier campo del esquema fuera de contenido; incluso valores vacíos de campos operativos no eluden la barrera.

HK libera requestKey mediante una clave histórica aleatoria y desvincula sourceEntryId/routineId, guardando las claves originales en audit.before. Cuando el texto dependía del asunto, conserva una fotografía de título/descripcion en la fila histórica para cumplir el CHECK de contenido; no elimina filas ni eventos. prepareHkDay deja de usar el identificador primario determinista (la idempotencia sigue en requestKey y rutina/día), de modo que regenera el trabajo tras limpiar. Fronti en Chat actualiza ChatConversation.updatedAt en la misma transacción, como deleteOwnChatMessage. Sin nuevas migraciones ni modificaciones a las migraciones previas; no se requieren cambios de índices.

Regresiones de las cinco rutas: retiro final INICIADO/ACTIVO, bloqueo por Caja confirmada, memoria compartida después de limpiar, permiso exclusivo de contenido y campos operativos, recreación HK por origen/requestKey y regeneración real de rutina, versión del stream de Chat antes/después. La primera ejecución focal detectó enum de fixture incorrecto y el CHECK nativo al liberar sourceEntryId sin fotografía; ambos corregidos, sin alterar restricciones ni omitir pruebas. Segunda ejecución focal: 30 aprobadas; se añade la comprobación de Caja y se exige npm run verify más Compuerta sobre el SHA final antes de merge. PostgreSQL local desechable exclusivamente; no producción.


## 2026-10-07 · AROH 1.64.0 · alcance reducido del PR #279

Por instrucción del propietario se retira la visibilidad configurable de novedades por área y su exclusión individual de entrega. Se eliminan UI, acción/servicio, filtros de lectores/escritores, invalidación de borradores, huellas de revisión por selección y sus pruebas. Las migraciones aditivas se mantienen intactas; columnas/relación/vistas asociadas quedan sin uso. No se implementa aún el futuro modelo de novedades simples con un área relacionada: corresponde al bloque UI/UX.

Se conservan impresión compacta A4 horizontal B/N de Recepción (Caja entrega/recibe, garantías fotografiadas, elementos, tablas densas y firmas de 24 mm), trigger autorizado CREATE OR REPLACE sólo en migración nueva que crea pendiente/auditoría en Shift, Centro con Validar/Observar y enlaces concretos a cierre/arqueo/garantía, confirmación de Crear seguimiento y correcciones independientes de reserva de tareas/seguimientos privados. Alertas/tareas históricas de cierre intactas, fuera de Recepción y del relevo; rollback SQL exacto de la función anterior en descripción del PR.

Base main df8938f8; rama feat/aroh-impresion-cierre-20261007; versión 1.64.0. Validación del alcance reducido en curso sobre PostgreSQL local y datos sintéticos. Requiere nueva Compuerta y revisión Codex del nuevo HEAD; resultados del alcance anterior no acreditan este cambio. Sin datos del hotel, merge ni despliegue; merge y verificación del sitio reservados al propietario.

## 2026-10-07 · UI/UX operativa · primera parte del bloque 1.65.0

Base exacta bb5dc117 / #279. Rama feat/aroh-ui-ux-20261008; versión intermedia 1.64.1, antes de novedades simples y visibilidad central en 1.65.0. Geometría compartida recta, tablas densas con encabezado oscuro, contenedor operativo sin límite de ancho y acciones nativas desplegadas en escritorio/plegadas en móvil. Caja compacta; todas las vistas de Coordinación visibles y resumen de fila compacto; Nueva llave visible, filtros de Novedades en línea, habitaciones vacías sin «Sin contexto», Inventario tabular con valorización/custodia conservadas, HK en cuatro columnas, guías de jornada/turno retiradas, seis KPIs de Supervisión en fila, notas métricas de Gerencia desplegables/tooltips, Equipo sin disclaimer, Administración abierta y detalle de auditoría colapsado. Duplicados de Inicio/Avisos agrupados sin perder originales, enlaces ni lectura individual; cabecera con etiquetas de los iconos.

Sin migraciones ni cambios de reglas/permisos operativos. PostgreSQL 17 instalado exclusivamente bajo work/ en este entorno y base sintética de loopback libro_test. El sandbox impedía sockets; Git, instalación y pruebas requieren ejecución autorizada fuera del sandbox. Base recuperada inicialmente por conector y después completada por git fetch --refetch, con SHA de commit/árbol verificados.

Se mantienen todos los recorridos previos, actualizando sólo el acceso a Más según el ancho; se añade operational-sheet-browser con las 16 rutas a 1280/390 en la Compuerta. Primera suite: 2.325 aprobadas y cinco fallos de contratos visuales anteriores/manifest PDF previo. Contratos actualizados a lo solicitado; empaquetado PDF revalidado con tres pruebas aprobadas contra build regenerado. Verificación final y recorridos en curso. No merge ni despliegue; reservados al propietario.

Correcciones de revisión del PR #282: paginación independiente de novedades en las pantallas del área, conservando filtros; borradores del relevo se invalidan al crear/editar/resolver novedades visibles con el modo simple; bloqueo compartido del parámetro usa la misma clave que Sysadmin, incluso sin fila previa, y la revisión/envío/recepción releen el modo dentro de la transacción; Sysadmin conserva su identidad y área al recibir avisos nativos; seleccionar un área oculta exige ajustar su visibilidad primero. Añadidas regresiones PostgreSQL: 109 pruebas focales aprobaron; el único fallo adicional fue el nuevo presupuesto real de consultas, corregido al reutilizar los totales de las dos consultas agrupadas y aprobado en el primer PR. Tipos/lint completos aprobaron. Compuerta, suite completa y navegador ON/OFF del HEAD final pendientes; no se acreditan todavía.
