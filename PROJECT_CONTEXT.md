# AROH Central IA · Hotel HW Libertad — contexto técnico


## Actualización 30/09/2026 · AROH 1.37.0 · onboarding modular y Ayuda viva

- `User.tutorialKnownModules` convierte el onboarding en estado por usuario y por módulo. El acceso efectivo se deriva de permisos; un módulo visible que no esté marcado como conocido dispara su recorrido específico.
- El tutorial general sigue existiendo para el primer ingreso. Al terminarlo, el servidor marca como conocidos todos los módulos habilitados en ese momento, evitando una segunda ronda redundante.
- Usuarios que ya habían finalizado el tutorial antes de esta versión se migran con sus módulos actualmente visibles como conocidos.
- Ayuda y tutorial dejan de ser documentación mínima: cubren el producto vigente, incluida la semántica Novedad/Tarea/Seguimiento/Alerta/Notificación, Novedades / habitación, Caja y folios, Web Push, Supervisión, Gerencia, Fronti, soporte, chat, usuarios ocultos y búsqueda por #ID.
- Fronti proactivo debe explicar cada hallazgo con el contrato «Qué pasó / Qué está mal o qué revisar / Qué hacer». La detección sigue siendo determinística y la IA no puede inventar causas ni modificar estados por sí sola.
- El radar cubre además descuadres recientes de Caja (esperado, contado, diferencia, responsable y enlace al arqueo) y tareas vencidas abiertas (estado, prioridad, responsable, habitación si existe y enlace directo).
- Migración aditiva: `20260930112000_tutoriales_modulares`. Versión: **v1.37.0**.


## Actualización 29/09/2026 · AROH 1.33.2 · hotfix de autorecepción de turnos

- **Mi turno** deja de ofrecer «INICIAR RECEPCIÓN DE TURNO» a la misma persona que participó en el turno saliente y acaba de cerrar/enviar esa entrega.
- El backend ya impedía la autorecepción para conservar separación entre entrega, recuento, custodia y firmas; la interfaz ahora refleja esa misma regla en vez de devolver al usuario al mismo punto.
- Cuando la entrega pendiente pertenece al propio usuario, la pantalla explica que debe recibirla otra persona autorizada.
- No cambia el modelo de datos ni se requiere migración Prisma. Versión: **v1.33.2**.


## Actualización 29/09/2026 · AROH 1.33.1 · hardening Fronti proactivo

- El barrido proactivo respeta simultáneamente `fronti.enabled` y `fronti.proactiveEnabled`.
- Los límites se aplican después de descartar señales en cooldown y la deduplicación concurrente se reclama en PostgreSQL con `FrontiProactiveClaim`.
- Las reservas incorporan severidad al fingerprint para que una escalada temporal ALTA → CRÍTICA no quede silenciada por el cooldown anterior.
- Novedades/incidencias recientes relevantes se incorporan directamente como candidatas.
- Polling/eventos usan `after()` y el cron opera con deadline interno inferior a los 120 s de Vercel.
- Migración: `20260930005000_fronti_proactive_claims`. Versión: **v1.33.1**.


## Actualización 29/09/2026 · AROH 1.32.1 · hotfix de inicialización Web Push

- Corrige la creación/lectura del par VAPID en Production: el bloqueo asesor de PostgreSQL ya no devuelve una columna `void` que Prisma no puede deserializar.
- Se conserva el mismo modelo Web Push de v1.32.0: suscripción por dispositivo, service worker, VAPID propio, cron de rescate y prueba real desde la campana.
- No cambia la semántica de notificaciones ni permisos. Hotfix sin nueva migración.
- Release objetivo: **v1.32.1**.

## Actualización 29/09/2026 · AROH 1.32.0 · Web Push nativo y PWA

- AROH incorpora **Web Push real** mediante Push API + Service Worker + VAPID propio: las notificaciones pueden llegar al sistema operativo aunque la pestaña de AROH esté cerrada.
- Cada navegador/dispositivo autorizado registra una `PushSubscription` vinculada a la cuenta. El usuario concede o retira el permiso desde la campana con ondas; no se activa silenciosamente.
- El push transporta una **señal vacía**. El servicio push de Apple/Google/Mozilla no recibe el texto operativo: el Service Worker despierta y recupera el contenido desde AROH con la sesión vigente.
- Windows/macOS/Android usan Web Push en navegadores compatibles. En iPhone/iPad se declara AROH como PWA `standalone`; iOS/iPadOS requiere añadir la web a la pantalla de inicio y conceder permiso desde la app instalada.
- Se cubren notificaciones centrales, chat/menciones, respuestas de Fronti, resultados de auditoría y alarmas. Las rutas que crean notificaciones fuera del despachador común programan push explícitamente.
- Las alarmas vencidas ya no dependen de una pestaña abierta: `/api/cron/web-push` corre cada minuto en Vercel Pro, materializa alarmas pendientes y rescata entregas push.
- Las llaves VAPID se generan una sola vez, la privada queda cifrada con `AUTH_SECRET`, y una inconsistencia no provoca rotación automática que invalide dispositivos.
- Los endpoints de alta/baja de dispositivos exigen sesión vigente, términos aceptados y mismo origen. Suscripciones expiradas 404/410 se eliminan automáticamente.
- Se conserva el sistema previo como respaldo: toast, sonido y sondeo cuando AROH está abierto.
- Healthcheck técnico: `/api/health/push`. Migración aditiva: `20260929201000_web_push_subscriptions`. Release objetivo: **v1.32.0**.

## Actualización 29/09/2026 · AROH 1.31.0 · Fronti proactivo y diagnóstico real de proveedores

- Fronti incorpora una capa **proactiva de fondo** sobre señales ya detectadas de forma determinística. La IA explica, correlaciona y sugiere revisión humana; **no modifica por sí sola** Caja, turnos, garantías, reservas, llaves ni estados operativos.
- El barrido proactivo cruza alertas activas, reservas próximas o con acción pendiente y señales repetidas de observabilidad. Los hallazgos se deduplican y respetan una ventana de enfriamiento para evitar ruido.
- Configuración administrable: `fronti.proactiveEnabled`, `fronti.proactiveCooldownHours` y `fronti.proactiveMaxFindingsPerRun`.
- La cadena de fondo prioriza capacidad liviana y sin costo monetario adicional: Cloudflare Workers AI → Groq 20B → Groq 120B. Si la inferencia falla, queda una explicación determinística conservadora y la operación continúa.
- Vercel Pro se aprovecha para ejecutar el respaldo periódico de Fronti y aumentar la frecuencia de rescate de correo operativo. Los cron comparten autenticación centralizada y admiten `CRON_SECRET`.
- El diagnóstico de Cloudflare ya no interpreta automáticamente un 401/403 como «clave mala»: distingue acceso denegado por permisos/cuenta/alcance y lee también el formato `errors[]` del proveedor.
- Administración > Fronti muestra el origen efectivo de la credencial, el origen del Account ID de Cloudflare y permite **Probar inferencia real** sin reemplazar secretos.
- La proactividad complementa la capa contextual transversal de v1.27.0; no crea un segundo motor de reglas ni duplica datos operativos.
- Sin migración Prisma ni cambios masivos de datos. Release objetivo: **v1.31.0**.

## Actualización 29/09/2026 · AROH 1.30.0 · adjuntos persistentes de soporte

- Las capturas y archivos de **Reportar / solicitar** se archivan en **Cloudflare R2 privado**; Neon guarda sólo metadatos y la relación con el `SupportRequest`.
- La subida usa una URL PUT temporal firmada y ocurre **directamente desde el navegador a R2**. Si el archivo ya quedó archivado, no vuelve a viajar como base64 hacia Vercel.
- La bandeja `/admin/soporte` lista los adjuntos persistentes y los abre mediante una ruta autenticada que exige `support.view`; la ruta genera una URL GET temporal firmada y redirige al navegador, sin proxificar el binario por Vercel.
- El diseño evita depender de la conectividad servidor→R2, que mantiene antecedentes de fallos TLS en Vercel. Si la subida directa falla, el reporte igual se persiste y el archivo conserva el correo como canal de respaldo.
- `attachmentNames` se conserva como inventario/histórico; `SupportRequestAttachment` representa sólo objetos realmente archivados.
- No se guardan blobs en PostgreSQL. Migración aditiva: `20260929185000_support_request_attachments`. Release objetivo: **v1.30.0**.

## Actualización 29/09/2026 · AROH 1.30.0 · adjuntos consultables de soporte

- **Reportar / solicitar** puede archivar la captura y el archivo adjunto en Cloudflare R2 privado; Neon guarda sólo metadatos en `SupportRequestAttachment`.
- La subida se intenta directamente desde el navegador con una URL PUT temporal firmada. El reporte **no depende** del almacenamiento: si R2/CORS falla, el `SupportRequest` igualmente se registra y el adjunto sigue viajando por SMTP cuando el correo está disponible.
- `/admin/soporte` muestra los adjuntos persistidos con nombre y tamaño. Abrir uno exige `support.view` y genera una URL GET firmada de cinco minutos; el binario no atraviesa Vercel.
- Los reportes históricos de v1.29.0 conservan `attachmentNames` y se identifican como referencias históricas cuando no existe objeto archivado.
- La puesta en cero y la purga demo eliminan los registros de soporte antes de borrar usuarios; los metadatos de adjuntos caen por cascada.
- El healthcheck backend de R2 continúa degradado desde Vercel. Esta release no cambia credenciales ni declara resuelto ese transporte; usa una ruta navegador→R2 independiente y mantiene degradación segura.
- Migración aditiva: `20260929185000_support_request_attachments`. Release objetivo: **v1.30.0**.

## Actualización 29/09/2026 · AROH 1.29.0 · bandeja interna de soporte

- **Reportar / solicitar** persiste cada envío primero en Neon como `SupportRequest`; el correo deja de ser la única evidencia.
- Nueva bandeja `/admin/soporte` con búsqueda, filtros por tipo/estado, solicitante, referencia y contexto técnico.
- Estados: `NUEVA`, `EN_REVISION`, `RESUELTA`, `DESCARTADA`; cerrar o descartar exige resolución y genera auditoría.
- Permisos granulares: `support.view` y `support.manage`. El Administrador de sistema recibe ambos por defecto; otros roles sólo por habilitación explícita.
- `support.recipient` se mantiene como **copia de aviso por SMTP**. Si SMTP falla, el registro no se pierde.
- Los binarios de adjuntos no se guardan en Neon: la bandeja conserva sus nombres y el contenido continúa por el canal de correo vigente.
- Fronti cataloga `/admin/soporte` como pantalla administrativa contextual.
- Migración aditiva: `20260929183500_support_inbox`. Release objetivo: **v1.29.0**.

## Actualización 29/09/2026 · AROH 1.28.0 · usuarios ocultos

- Administración incorpora **Usuario oculto** como estado de visibilidad, separado de cuenta activa/inactiva y del rol.
- Un usuario oculto puede iniciar sesión y operar con normalidad; conserva permisos, trazabilidad, registros históricos y recepción de avisos automáticos/globales.
- No aparece como persona seleccionable en formularios operativos, responsables, participantes nuevos, turnos, Chat, alarmas individuales/grupales, Supervisión ni menciones por `@usuario`.
- El historial no se reescribe: asignaciones, autores, conversaciones y acciones ya existentes siguen mostrando a la persona.
- La regla canónica de selectores generales vive en `listOperationalUsers()`; flujos globales no deben reutilizar ese filtro si necesitan alcanzar a todo el equipo activo.
- Migración aditiva `20260929173000_usuario_oculto_operacion`. Release objetivo: **v1.28.0**.


## Actualización 29/09/2026 · AROH 1.27.0 · Fronti contextual transversal

- Fronti recibe contexto determinístico de **todas las rutas autenticadas** de AROH Central IA: módulo, sección, filtros visibles, título y entidad dinámica cuando la URL identifica un objeto concreto.
- Nuevo lector `consultar_contexto_pantalla`: obtiene una fotografía viva y autorizada de la pantalla actual usando servicios reales del sistema. No genera SQL ni persiste resúmenes duplicados.
- Detalles contextualizados: novedades/incidencias, tareas, reservas, habitaciones, arqueos, entregas de turno y resultados de auditoría; las pantallas de Caja, Reservas, Llaves, Avisos, Indicadores, Supervisión, Notificaciones, Historial, Perfil y Administración tienen lectores específicos o reutilizan las herramientas determinísticas existentes.
- Las preguntas deícticas («¿qué falta aquí?», «revisa esto», «¿y ahora?») heredan automáticamente las capacidades pertinentes del módulo actual en vez de depender sólo de palabras literales escritas por el usuario.
- Los filtros de URL forman parte del contexto, pero se excluyen nombres sensibles como token, cookie, sesión, credenciales, claves y contraseñas.
- Fronti standalone se muestra a cualquier cuenta que cumpla la política existente `fronti.enabled + frontiAccessEnabled`; ya no se oculta adicionalmente por ser un rol operativo.
- En perfiles de Recepción, las **consultas de lectura** siguen disponibles durante NO_SHIFT, recepción y cierre para explicar la situación. Las propuestas/escrituras continúan bloqueadas por el gate operativo hasta que corresponda.
- Se mantiene seguridad por permisos del usuario y confirmación de acciones sensibles. No se amplían permisos por estar Fronti abierto en una pantalla.
- Esta release **no implementa Fronti proactivo/event-driven** ni acciones autónomas de fondo; esa capa queda separada para revisión posterior.
- Sin migración Prisma ni cambios masivos de datos. Release objetivo: **v1.27.0**.

## Actualización 29/09/2026 · AROH 1.26.3 · panel de soporte fuera del header sticky

- Se corrige el drawer **Reportar / solicitar**: antes se renderizaba como `fixed` dentro de la cabecera `sticky` con `backdrop-blur`, por lo que el navegador lo tomaba respecto de ese contenedor y quedaba recortado a la altura del header.
- El panel ahora se monta con **React Portal en `document.body`**, igual que los overlays globales correctos del sistema.
- Mantiene overlay de pantalla completa, cierre por Escape/clic exterior, formulario desplazable y bloqueo de scroll de fondo.
- Se agrega regresión explícita para exigir portal + `fixed inset-0` en el componente de soporte.
- Sin cambios de esquema ni datos. Release objetivo: **v1.26.3**.

## Actualización 29/09/2026 · AROH 1.26.2 · navegación desplegable compacta

- La navegación secundaria de escritorio deja de abrir franjas tipo mega-menú a todo el ancho y pasa a **dropdowns compactos anclados al módulo**.
- Los dropdowns usan tarjeta flotante, sombra suave, bordes redondeados, indicador de selección y animación breve respetando `prefers-reduced-motion`.
- La tipografía de módulos y opciones sube aproximadamente un punto visual para mejorar legibilidad sin agrandar la cabecera.
- Cabecera y navegación viven dentro de un contenedor centrado de ancho máximo; en pantallas muy anchas o con zoom reducido no se pegan a los extremos.
- Si el ancho disponible no alcanza, la fila de módulos conserva desplazamiento horizontal; el dropdown usa portal para no quedar recortado por ese contenedor.
- Sin migración de esquema ni cambios de datos. Release objetivo: **v1.26.2**.

## Actualización 29/09/2026 · AROH 1.26.1 · identidad final del producto

- El nombre del producto/sistema es **AROH Central IA**.
- La cabecera global muestra **AROH Central IA** como identidad principal y debajo el **nombre del alojamiento activo** (por ejemplo, Hotel HW Libertad).
- «Central de Operaciones» deja de ser el nombre del producto. «Libro/Novedades» continúa como módulo interno.
- La identidad se alinea en cabecera horizontal, login, instalación, metadatos, correos, avisos, Fronti, términos, arqueos e icono accesible.
- No hay cambios de esquema ni datos. Repositorio, proyecto Vercel y dominio actuales se conservan; la migración de subdominio sigue separada.
- Release objetivo: **v1.26.1**.

## Actualización 29/09/2026 · Central 1.26.0 · navegación horizontal compacta

- Escritorio adopta una **cabecera horizontal compacta** y retira el sidebar del shell: identidad, búsqueda global, acceso vigente de Fronti, alojamiento, cuenta, ayuda y soporte quedan en la franja superior; los módulos viven en una segunda fila horizontal.
- Los módulos con navegación secundaria usan **mega-menús** compactos por proceso. Tareas, seguimientos, alertas e incidencias siguen sin convertirse en módulos raíz: aparecen sólo como vistas relacionadas bajo Novedades u otros módulos pertinentes.
- La antigua franja global de «Nueva novedad / Nueva incidencia» desaparece. Esas acciones pasan a **Novedades**, mientras los buscadores, filtros y acciones específicas permanecen dentro de cada módulo.
- **Ayuda** reúne búsqueda de procedimientos y reactivación del recorrido guiado paso a paso.
- Se incorpora un panel lateral **Reportar problema / Solicitar función** con captura opcional, adjunto y contexto técnico de la pantalla. El destinatario se controla mediante `support.recipient`; el envío reutiliza SMTP existente y no crea una segunda mesa de ayuda.
- Fronti cambia únicamente de punto de acceso visual en escritorio. **No** se amplió su contexto transversal ni se implementó proactividad/eventos en esta release; esas capas quedan expresamente fuera para revisión posterior módulo por módulo.
- Móvil conserva la navegación inferior y «Más». Sin migración de esquema ni cambios de datos operativos.
- Release objetivo: **v1.26.0**.


## Actualización 29/09/2026 · Central 1.25.0 · jornada operativa canónica e identidad

- La plataforma pasa a llamarse **Central de Operaciones · Hotel HW Libertad**. «Libro/Novedades» queda como un módulo interno, no como nombre del producto completo.
- La **fecha operativa canónica** la determina el ciclo real de Recepción: con turno abierto manda `Shift.date`; sin turno abierto, el último cierre DÍA conserva la fecha y el último cierre NOCHE avanza al día siguiente. La medianoche por sí sola no cambia la jornada.
- Inicio y el dashboard de Supervisión usan esa fecha operativa. El dashboard de informes muestra únicamente la jornada vigente; los informes del cierre anterior sólo se reutilizan como evidencia de apertura cuando corresponde.
- El parser de informes prioriza la fecha del nombre del PDF y encabezados reconocibles. Una fecha de huésped/reserva (por ejemplo 01/10) ya no puede convertirse silenciosamente en fecha del informe.
- El cierre de Recepción mantiene una sola ruta canónica: vuelve a validar Caja/custodia antes del cierre formal y genera la validación posterior trazada; no se creó una segunda lógica de cierre.
- Sin migración de esquema ni datos. El repositorio, proyecto Vercel y dominio actuales se conservan durante esta release; el **subdominio y la migración de URL se harán como fase separada** para evitar mezclar identidad con enrutamiento/DNS.
- Release objetivo: **v1.25.0**.

## Actualización 29/09/2026 · Libro 1.24.0 · Apertura operacional de Supervisión

- Iniciar Supervisión deja de ser un bloc de prioridades: crea una fase `PREPARACION` y el turno sólo pasa a `ACTIVO` tras completar la recepción operacional.
- La apertura muestra pendientes reales y genera desde ellos las prioridades, sin duplicar novedades, tareas, seguimientos ni señales.
- El Supervisor debe realizar su propio arqueo por cada fondo de Caja activo; las garantías en efectivo se validan físicamente dentro del mismo arqueo. Una diferencia sólo permite continuar si queda explicada.
- La apertura muestra garantías/custodias abiertas y el último inventario de llaves de pisos 4, 5 y 6; exige confirmación explícita de revisión.
- Evidencia PMS de apertura: para la fotografía operacional de hoy se prefiere **Habitaciones con actividad**; si no está disponible, el respaldo equivalente es **Entradas + In House + Salidas**. Para recibir el cierre del día anterior se esperan **Formulario de auditoría + Cobros + Cargos diarios**. Ventas por canal, Producción por habitación y Revenue quedan como gestión diaria no bloqueante.
- La falta de un informe por caída o indisponibilidad del PMS no deja al hotel sin Supervisión: exige una contingencia escrita y auditada. Caja/garantías sí permanecen como barrera obligatoria.
- La carga de apertura autodetecta la fecha de cada PDF, por lo que admite cierres de ayer junto con fotografías operativas de hoy y reutiliza evidencia válida por fecha operativa.
- El lector PDF conserva anotaciones de enlace sobre el ID FNS. En entradas/salidas, un ID enlazado aporta señal `PENDIENTE` de confianza alta; un ID no enlazado sólo se considera `PROCESADO_PROBABLE` si el mismo PDF demuestra una convención mixta. La señal nunca confirma automáticamente check-in/check-out. Color y subrayado no se usan todavía como regla hasta validarlos contra informes reales de cada formato.
- `SupervisionShift.openingState` conserva la fotografía de Caja, garantías, llaves, informes y pendientes recibidos; `openingCompletedAt` marca la confirmación final.
- Migraciones aditivas: `20260929110000_supervision_apertura_operativa` + `20260929110500_supervision_apertura_unique_index`. Release objetivo: **v1.24.0**.

Memoria breve del proyecto. Sirve para no volver a analizar toda la aplicación
en cada sesión. **Mantener corto.** La documentación larga vive en `docs/`.

## Stack

Next.js 15 (App Router, Server Components, Server Actions) · React 19 ·
TypeScript estricto · Prisma 6 · PostgreSQL en **Neon** (`sa-east-1`) ·
**Vercel** como único hosting de Production · Tailwind ·
Vitest contra PostgreSQL real.

**Infraestructura oficial y exclusiva:** GitHub (código/PR/CI) + Vercel
(preview/despliegue/Production) + Neon (PostgreSQL). **Netlify no forma parte
del proyecto.** Si una integración residual de Netlify publica un check o un
preview en GitHub, se considera ruido externo: no valida, no bloquea y no
autoriza una promoción. No agregar `netlify.toml`, `.netlify/`, SDK,
variables ni dependencias de Netlify. La compuerta CI lo impide.

No cambiar de stack. No reconstruir. No crear otro proyecto.

## Arquitectura

```
src/domain/    Lógica pura, sin base de datos ni React. Testeable sola.
src/server/    services/ (consultas y reglas) · actions/ (acciones de
               servidor) · auth/ (sesión, permisos). Todo marcado 'server-only'.
src/app/       Rutas. (app)/ exige sesión; fuera de ahí, acceso e instalación.
src/components/ ui/ (primitivas) · layout/ · operational/ · rooms/ · forms/
```

Regla: los permisos se comprueban **en el servidor**, en cada acción y cada
página. La navegación sólo esconde; nunca autoriza.

## Navegación (simplificada)

El núcleo operativo se organiza por trabajo concreto, no por entidades del PMS:

| Destino | Pregunta |
|---|---|
| `/` Inicio | ¿Qué exige atención ahora? |
| `/turno` Mi turno | ¿En qué estado está mi relevo y qué debo entregar? |
| `/libro?clase=entry` Novedades | ¿Qué ocurrió y qué queda pendiente? |
| `/central-reservas` Central de Reservas | ¿Qué debe quedar preparado o resuelto antes de la llegada? |
| `/caja` Caja | ¿Qué dinero entró, salió o debe corroborarse? |
| `/llaves` Llaves | ¿Dónde está cada llave física y qué arrojó el último inventario? |
| `/supervision` Supervisión | ¿Qué requiere control, seguimiento o validación del Supervisor? |

**Inicio es una ventana operativa, no un segundo Libro.** Muestra el estado del
turno, cuatro indicadores accionables y una única bandeja priorizada construida
por reglas determinísticas. No vuelve a listar por separado tareas, incidencias,
alertas, seguimientos, novedades y entregas.

`/reservas`, `/habitaciones` y la importación PMS conservan rutas y datos
históricos/operativos, pero no convierten al Libro en un PMS. La excepción
deliberada es `/central-reservas`: una bandeja de trabajo que proyecta
`ReservationReference` y señales ya existentes para preparar la operación;
no mantiene inventario comercial paralelo ni sustituye la fuente PMS.

**Decisión que no se revierte:** tareas, incidencias, alertas y seguimientos
**no son módulos del menú**. Son clases de un mismo flujo y se consultan desde
el Libro, Inicio, la ficha de la habitación y Supervisión. Sus páginas
especializadas siguen disponibles porque algunas conservan acciones propias.

En móvil caben cuatro accesos directos; el resto vive detrás de **Más**. El
perfil ofrece cerrar sesión y sigue siendo alcanzable desde móvil. La
autorización real permanece siempre en servidor; ocultar navegación nunca
concede ni revoca permisos.

## Entidades principales

`User`/`Role`/`Permission` · `Shift`/`ShiftHandover`/`HandoverItem` ·
`OperationalEntry` (novedad, incidencia, mantenimiento…) · `Task` ·
`FollowUp` · `Alert` · `Comment` · `Room`/`RoomStay`/`RoomKey`/`KeyMovement` ·
`GuestReference`/`ReservationReference`/`Guarantee` ·
`CashFund`/`CashDenomination`/`CashCount`/`CashTransfer` · `MailSettings` ·
`HandoverElementType`/`HandoverElement` · `Announcement`/`AnnouncementRead` ·
`Fine` · `ChecklistTemplate`/`ChecklistRun` · `AuditLog` · `SystemSetting`.

El libro proyecta cuatro de ellas (`OperationalEntry`, `Task`, `FollowUp`,
`Alert`) sobre un tipo común `BookItem`: una sola línea temporal, cada objeto
conserva su modelo y sus reglas.

## Actualización 28/09/2026 · Libro 1.23.0 · Central de Reservas, Gerencia y correo individual

- Rol `CENTRAL_RESERVAS`: gestiona referencias de reserva y continuidad asociada, sin turno/Caja/llaves.
- `/central-reservas` organiza próximas llegadas, pendientes, garantías/saldos y cambios sobre modelos ya existentes; no es un PMS.
- Gerencia puede dirigir acciones, seguimientos y comunicados desde Supervisión, con lectura transversal, pero permanece fuera de la operación rutinaria del mesón.
- `User.email` es opcional, no único y no participa del login. `emailNotificationsEnabled` controla el canal externo.
- El correo de novedades usa la outbox existente; Chat y alarmas no generan correo.
- La base funcional de Supervisión de v1.22.0 se conserva.
- Migración: `20260928213000_central_reservas_gerencia_correo_usuario`. Release: **v1.23.0**.

## Actualización 28/09/2026 · Libro 1.22.0 · Supervisión operativa y accionable

- Principio de UX: si el Centro de Supervisión muestra un asunto operativo, debe ofrecer una acción real o un acceso explícito a su superficie de gestión; los indicadores puramente informativos se distinguen como resumen.
- Auditoría diaria de informes PMS separa **evidencia importada** de **estado operativo de revisión**. El PDF original no se altera.
- Los controles incompletos pueden marcarse **Resuelto** o **No aplica** con trazabilidad; pueden reabrirse.
- Los hallazgos independientes pueden resolverse o retirarse del pendiente con motivo.
- Check-outs pendientes admite un valor operativo actualizado durante el turno, conservando a la vista el valor original del informe. Una nueva carga de SALIDAS vuelve a ser la fuente vigente y limpia el ajuste manual anterior.
- Recargar el Formulario de Auditoría reemplaza sus controles/hallazgos previos; ya no deja puntos antiguos de Gastro u otros controles como falsos pendientes persistentes.
- El cierre del turno de Supervisión usa los pendientes operativos efectivos, no los «No» históricos del PDF.
- Auditorías abiertas, medidas correctivas y señales del Libro muestran acceso explícito **Gestionar**; una medida realizada puede validarse desde el Centro.
- Migración aditiva: `20260928203000_supervision_audit_review_state`.
- Release objetivo: **v1.22.0**.

## Actualización 28/09/2026 · Libro 1.20.0 · auditorías accionables, arqueos imprimibles y servicios

- Auditorías sorpresa: el cierre ya no guarda una etiqueta inerte. «Persona» exige destinatario y crea notificación; «Supervisión» distribuye al equipo supervisor; «Operativo» publica mediante notificaciones al equipo operativo. «Reservado» no distribuye.
- El historial de auditorías muestra el resultado completo: alcance, muestra, resumen, observaciones, cada punto, estado y evidencia.
- Arqueos de Caja: cada arqueo nuevo conserva un snapshot de billetes/monedas y puede abrirse en una hoja imprimible con fondo esperado, contado, diferencia, garantías y firmas. Los arqueos históricos siguen siendo imprimibles, pero sin inventar un desglose que antes no se guardaba.
- Estacionamiento reutiliza la infraestructura de folios: fecha, habitación, huésped, patente, recepcionista, estado/anulación y exportación CSV. No crea movimientos de Caja.
- Llaves incorpora «Todos los pisos · 89 hab.» para consulta, búsqueda y operación transversal. El inventario oficial sigue guardándose por piso para conservar trazabilidad.
- Migración aditiva: `20260928183000_auditoria_caja_estacionamiento`.
- Release objetivo: **v1.20.0**.

## Actualización 27/09/2026 · Libro 1.19.3 · alarmas ocultas de bajo costo

- Mantiene el alivio de capacidad de 1.19.2 y corrige la regresión de alarmas cuando la pestaña del Libro está oculta.
- El feed general y el Chat siguen desconectándose en segundo plano; Notificaciones usa un pulso ligero cada 30 s que sólo consulta alarmas vencidas.
- Si no vence ninguna alarma, el pulso no carga el feed completo. Si vence una, la materializa y recién entonces devuelve el snapshot para mostrar/sonar la alarma.
- Sin cambios de esquema, datos, permisos, turnos ni Caja.
- Release sin migración: **v1.19.3**.

## Actualización 27/09/2026 · Libro 1.19.2 · alivio de capacidad Vercel

- Hotfix P0 por alerta de 90% de Fluid Active CPU del plan gratuito.
- Notificaciones redujo su comprobación interna de 2 s a 15 s.
- Chat redujo su comprobación interna de 1,5 s a 10 s y la escritura de presencia de 45 s a 90 s.
- Chat y feed general de Notificaciones se suspenden en pestañas ocultas y reconectan al volver a primer plano.
- Se añadieron regresiones para impedir volver a intervalos agresivos.
- Release sin migración: **v1.19.2**.

## Actualización 27/09/2026 · Libro 1.19.1 · sincronización de contexto

- Patch sin cambios funcionales: sincroniza la documentación canónica con la recepción guiada y el ciclo de emergencia publicados en 1.19.0.
- La lógica operativa, el esquema y la migración siguen siendo los de **v1.19.0**.
- Release sin migración: **v1.19.1**.

## Actualización 27/09/2026 · Libro 1.19.0 · recepción guiada y emergencia única

- La recepción de turno entrante es un flujo persistente de cinco pasos: revisar entrega → recontar Caja/garantías → recibir custodia → revisión final → confirmar y activar.
- El turno entrante queda `INICIADO` durante la recepción y sólo pasa a `ACTIVO` al completar el relevo; la puerta operativa bloquea la operación general mientras tanto.
- Recontar Caja o cambiar custodia invalida confirmaciones posteriores para impedir que el flujo se salte controles físicos.
- Un recepcionista fuera del turno ahora ve el turno operativo vigente y puede sumarse a él; no se le ofrece abrir otro turno ni una emergencia sólo porque no era participante.
- Sólo puede existir una emergencia operativa activa. PostgreSQL lo protege con un índice único parcial y el servicio lo valida también bajo concurrencia.
- Cuando cierra el turno que originó la emergencia, el turno vigente se regulariza automáticamente: deja de ser emergencia, continúa como turno normal y conserva `emergencySourceShiftId` + `emergencyResolvedAt` para auditoría.
- La entrega de emergencia queda ligada al mismo turno excepcional para su regularización posterior; no se crea un segundo turno al desaparecer la causa.
- Supervisión sigue validando el cierre después del relevo; esa validación no bloquea la continuidad del mesón.
- Nueva migración: `20260928011000_recepcion_turno_guiada`.
- Release con migración: **v1.19.0**.

## Actualización 27/09/2026 · Libro 1.18.0 · identificadores humanos globales

- Todo registro operativo citable usa un correlativo humano único `#NNNN`, independiente del módulo.
- Los IDs técnicos (CUID/UUID/PK existentes) se conservan sin cambios para relaciones, auditoría y soporte.
- PostgreSQL usa una única secuencia `human_operational_id_seq`; `nextval()` evita colisiones bajo concurrencia y no reutiliza números tras rollback.
- La migración asigna `humanId` a históricos sin eliminar ni reescribir relaciones y deja una marca de auditoría.
- Reciben ID humano: turnos y entregas de Recepción/Supervisión, novedades/incidencias, tareas, seguimientos, alertas, garantías, arqueos, movimientos/transferencias/cierres de Caja, folios de gimnasio, multas, comunicados, rondas/auditorías, hallazgos, medidas correctivas e inventarios de llaves.
- No reciben ID visible: comentarios, lecturas, notificaciones, clics, aperturas de pantalla, líneas internas de arqueo y otras microacciones; conservan sus IDs técnicos cuando corresponde.
- El buscador superior apunta a `/buscar` y prioriza ID exacto → habitación → huésped → responsable → título → descripción → categoría → estado/contenido relacionado.
- La búsqueda global respeta permisos, comunicados dirigidos, seguimientos privados/de Supervisión y alertas de aprobación/validación restringida.
- Los filtros cotidianos dejan búsqueda/estado/responsable visibles y agrupan el resto bajo **Más filtros**.
- Los correlativos locales antiguos (`OperationalEntry.seq`, `Task.seq`, `GymPass.folio`) siguen en base por compatibilidad, pero dejan de ser la referencia operativa principal.
- Nueva migración: `20260927180000_identificadores_humanos_globales`.
- Release con migración: **v1.18.0**.

## Actualización 27/09/2026 · Libro 1.17.2 · Chat anclado al borde derecho

- La pestaña cerrada de **Chat operativo** queda pegada al borde inferior derecho del viewport, también en escritorio.
- Al abrirse en tablet/escritorio, el panel nace desde el mismo borde derecho y conserva la lógica de pestaña + ventana del chat clásico.
- Se elimina la dependencia visual del ancho de la barra lateral (`lg:left-64`), por lo que el Chat no cambia de posición al variar la navegación.
- En móvil pequeño se conserva el panel a pantalla completa; la pestaña cerrada queda sobre la navegación inferior, alineada a la derecha.
- Release sin migración: **v1.17.2**.

## Actualización 27/09/2026 · Libro 1.17.1 · coherencia de Supervisión

- Centro de Supervisión: tareas, seguimientos y medidas abiertas ya no desaparecen por antigüedad.
- Los filtros de fecha se interpretan en `America/Santiago` y se presentan como filtros históricos.
- Los contadores críticos usan `count()` exacto; las listas limitadas se presentan como muestras.
- Tablero de asignación muestra el total real de asuntos sin responsable aunque renderice sólo los prioritarios.
- Rendimiento usa calendario del hotel y excluye `NO_APLICA` del denominador de cumplimiento.
- Salud operativa usa «turnos de emergencia» y trata cierres incompletos como atención.
- Informes de Supervisión separan «actividad del período» de «estado vigente ahora».
- Cancelar cierre explica también qué preparación/revisión debe repetirse.
- Release sin migración: **v1.17.1**.

## Actualización 27/09/2026 · Libro 1.17.0 · blindaje de flujos operativos

- El cierre de Recepción deja de depender de `?paso=`: pendientes y revisión final
  quedan confirmados en base de datos antes de permitir el envío.
- Si el resumen automático o la nota manual cambian, esas confirmaciones se
  invalidan y deben repetirse. Los puntos urgentes exigen reconocimiento expreso.
- Caja aplica filtros históricos en PostgreSQL y muestra totales reales aunque la
  pantalla sólo renderice una muestra. Las acciones siguen sujetas al gate de turno.
- Movimientos con fecha efectiva distinta del día operativo requieren confirmación;
  devolver una garantía en efectivo exige confirmar físicamente el monto mostrado.
- Supervisión separa `RONDA` de `AUDITORIA_SORPRESA`; una persona sólo puede
  mantener una ejecución abierta a la vez. La auditoría sorpresa formal exige
  alcance y muestra.
- Los informes diarios conservan sólo huella SHA-256, tamaño, versión del parser,
  fecha detectada y completitud. El PDF, su nombre y el texto extraído se descartan.
- Una fecha detectada que no coincide con la fecha elegida bloquea la carga.
- Controles sin respuesta nunca producen un estado verde; se cuentan como puntos a revisar.
- El cierre del turno de Supervisión exige confirmar revisión de críticos,
  auditoría diaria y continuidad antes de generar su snapshot.
- Nueva migración: `20260927160000_blindaje_flows`.

## Actualización 27/09/2026 · cierre guiado v3

- El cierre de Recepción se conduce paso a paso: Caja/custodia → pendientes →
  revisión final → envío → cierre formal.
- Hasta enviar, el saliente puede volver a pasos anteriores o cancelar. El
  envío exige confirmación explícita y es el punto de no retorno normal.
- Cancelar un cierre **no borra hechos financieros**. Las transferencias a
  Tesorería sobreviven; los arqueos de preparación se invalidan y una Caja
  formalmente cerrada se reabre al volver el turno a `ACTIVO`.
- Inventario de llaves permanece fuera del cierre; es un proceso operativo
  independiente cuyas diferencias desembocan en Supervisión.

## Actualización 27/09/2026 · timers y recordatorios

- El Libro incorpora alarmas operativas internas sin plataforma adicional.
- **Timer**: cuenta regresiva; si nace dentro de un turno de Recepción queda
  ligado a ese turno y se cancela al cerrarlo.
- **Recordatorio**: fecha/hora absoluta de Santiago y continúa entre turnos
  hasta que cada destinatario lo atienda.
- Alcances: individual, grupo y global. El alcance global queda reservado a
  Supervisión/Administrador de sistema y sólo incluye cuentas operativas activas.
- Cada destinatario confirma o pospone su propia alarma. Posponer admite
  5, 10 o 15 minutos; una alarma grupal no se cierra hasta que todos confirmen.
- El disparo reutiliza el stream SSE de notificaciones: aparece sin recargar
  la página, con aviso modal persistente y sonido mientras la sesión esté abierta.
- No se implementa push del sistema operativo en esta etapa; si el Libro está
  cerrado, la alarma se presenta al reconectar.
- Lo vigila `tests/operational-alarms.test.ts`.

## Actualización 27/09/2026 · respaldo operativo por correo

- La entrega de turno enviada genera, sin opción visible para el usuario, un
  respaldo a `eherrera@hoteleshw.com` y `recepcion@hoteleshw.com`.
- Ingresos/egresos manuales de Caja, regularizaciones, garantías,
  devoluciones/reintegros de garantía, Novedades e Incidencias generan respaldo
  a `eherrera@hoteleshw.com`.
- Las reaperturas y correcciones de Caja generan un nuevo correo; ningún mensaje
  anterior se sobrescribe ni pretende desaparecer de la historia.
- Los correos se encolan en la misma transacción que confirma el hecho. El
  intento SMTP es inmediato y transparente; un fallo de correo **no revierte ni
  bloquea la operación hotelera**.
- La outbox usa `eventKey` único, estado de envío reservado y reintentos para
  evitar duplicados por concurrencia.
- Los mensajes contienen el detalle operacional disponible y no incluyen
  credenciales ni datos de tarjetas.
- Ruta de reintento: `/api/cron/operational-mail`.
- Cobertura principal: `tests/operational-mail.test.ts`.

## Actualización 27/09/2026 · compatibilidad Vercel Hobby

- Vercel Hobby sólo admite cron una vez al día; un cron de 5 minutos bloqueaba
  el deployment de Production.
- El reintento de respaldo por correo queda en dos capas:
  1. intento inmediato al confirmar el hecho operativo;
  2. reintento oportunista de correos vencidos cuando ocurre nueva actividad;
  3. cron diario como red de seguridad final.
- Cron de correo: `/api/cron/operational-mail` a `5 10 * * *` UTC.
- Esta decisión evita contratar infraestructura adicional sólo para reintentos
  y mantiene SMTP fuera del camino crítico de Recepción.

## Actualización 27/09/2026 · dashboard de auditoría en Supervisión

- El Centro de Supervisión puede recibir los informes PDF diarios del PMS y
  transformarlos en un resumen estructurado del día auditado.
- La fecha sugerida al abrir la carga es **ayer según America/Santiago**; puede
  cambiarse antes de procesar los informes.
- La carga reconoce de forma determinística Formulario de auditoría, Cobros,
  Ventas por canal, Producción por habitación, Salidas, Revenue, In house y
  Cargos diarios.
- Los PDF se procesan **uno por uno en memoria**. No se guarda el archivo, el
  nombre original ni el texto extraído; sólo métricas, controles, hallazgos y
  advertencias normalizadas.
- Un PDF escaneado/sin texto, como un cierre de caja físico, produce una
  advertencia y **no activa OCR ni inventa datos**. Caja se valida contra el
  propio Libro.
- Los informes de un mismo día se fusionan en un único
  `SupervisionAuditImport` del turno de Supervisión activo.
- Ese resumen forma parte de la copia inalterable del cierre/entrega del turno
  de Supervisión, aun cuando los archivos fuente ya no existan. Si el Supervisor
  pulsa «Finalizar turno» sin haber usado «Entregar», el cierre crea el snapshot
  automáticamente antes de marcar el turno como cerrado.
- El inventario de llaves sigue fuera del cierre de Recepción y no se incorpora
  a esta carga documental.
- Nueva migración:
  `20260927143000_supervision_auditoria_dashboard`.
- Cobertura: `tests/supervision-audit-import.test.ts` y
  `tests/empaquetado-pdf.test.ts`.

## Decisiones que no se revierten

0. **Una cuenta es nombre, usuario y contraseña. Nada más.**
   `User.email` **ya no existe** (`20260916190000_cuenta_sin_correo`). Primero
   dejó de ser identificador —en el hotel todo el mesón comparte la casilla de
   recepción, así que no distinguía a nadie— y después se eliminó: un campo que
   no identifica, no sirve para entrar y hay que inventar al crear la cuenta es
   un campo que sobra. La casilla que recibe las credenciales es del HOTEL y
   vive en `MailSettings.credentialsMailTo`, no en cada persona.
   `GuestReference.email` **sí se conserva**: ése es el correo del huésped y es
   un dato real.
   La identidad es `username` (`@EHerrera`): se muestra con arroba y se guarda
   sin ella. La comparación al entrar **ignora mayúsculas**, porque en el mesón
   nadie recuerda si se escribió `EHerrera` o `eherrera`; por eso
   `allocateUsername` mide la colisión también sin distinguirlas, aunque el
   índice único de PostgreSQL sí las distinga: si coexistieran las dos, entrar
   sería ambiguo. `LoginAttempt.identifier` guarda lo que se escribió, exista
   la cuenta o no. Lo vigila `tests/identidad-usuario.test.ts`.
1. **El rol técnico superior se llama sólo «Administrador de sistema».** Nunca
   *master*, *maestro*, *superusuario*. Queda **fuera de la operación
   habitual**: no inicia, recibe ni entrega turno, no confirma salidas ni
   entradas, no entrega llaves. Ésas son las acciones en que aparecería como
   responsable operativo.
   El PMS es **legado técnico**, no una capacidad del flujo operativo.
   El Administrador de sistema puede conservar acceso histórico mientras el
   código legado siga existiendo, pero PMS/RoomStay/Reservation no pueden
   volver a convertirse en dependencia global ni requisito de Recepción.
   ⚠️ **La matriz se siembra al instalar.** Cambiar `ROLE_PERMISSIONS` no
   altera una base ya instalada: todo cambio necesita su migración, uniendo
   por clave y sin tocar otras filas (el administrador puede ajustar permisos
   a mano desde `/admin/roles` y eso debe conservarse). Ejemplo:
   `20260915220000_admin_importa_informes`. Lo vigila
   `tests/permissions.test.ts`, que compara la matriz de la base con la del
   código.
2. **Nada se borra de verdad.** Eliminación lógica (`deletedAt`, `deletedBy`,
   `deletionReason`); el administrador restaura.
   **Las estadías también se pueden eliminar, y sólo el Administrador de
   sistema** (`stay.delete`, `softDeleteStay`, diálogo en las tres capas de la
   ficha de habitación). Es **reparación, no operación**: desatasca un estado
   histórico incoherente —una estadía duplicada, una cargada antes de que una
   regla existiera— para que nadie tenga que tocar la base a mano, y no deja
   al administrador como responsable de ninguna llegada ni salida. La llave
   asignada **se libera en la misma transacción**: una llave apuntando a una
   estadía eliminada es justo el conflicto que la acción viene a resolver.
   El permiso necesitó su migración (`20260916070000_admin_elimina_estadia`),
   que crea la fila de `Permission` además de la de `RolePermission`, porque
   el catálogo también se siembra al instalar. Lo vigila
   `tests/eliminar-estadia.test.ts`.
   **Y la habitación entera se puede resetear** (`room.reset`, `resetRoom`,
   botón en la cabecera de la ficha), que lo tienen el administrador **y el
   Supervisor**: el atasco ocurre en el mesón y no puede esperar. Conserva una
   estadía por reserva y **fase** —la de estado más avanzado—, elimina el
   resto, libera las llaves huérfanas y vuelve a llamar a
   `reconcilePrincipalKeys`, que sigue siendo la única lógica de llaves. Una
   salida y una llegada de la misma reserva **no son duplicidad**: son el caso
   de la 610 y se conservan las dos. Sin duplicidad no toca nada y lo dice.
3. **El PMS es la fuente principal.** Este módulo no es un PMS. Los conflictos
   de importación **se recalculan, nunca se almacenan**.
   **Los tres informes se cargan desde el inicio de turno** (`/turno`, primera
   tarjeta): es el primer gesto de la jornada y de ahí sale el estado de las
   89 habitaciones, la regla de cola y el inventario de llaves. No bloquea el
   inicio del turno —si el PMS no responde, la recepción tiene que poder
   operar— pero deja visible que falta. La fecha de un lote sale **del propio
   informe**, no del reloj, así que el estado compara esa fecha con el día
   operativo: cargar los de ayer no da el día por cubierto.
   Se conserva la **pantalla de revisión**: nada sobrescribe lo que una
   persona decidió sin que alguien vea antes qué va a cambiar. El destino al
   que volver tras aplicar viaja en el formulario, así que se traduce contra
   una **lista cerrada** (`RETURN_TO` en `actions/rooms.ts`) — nunca se
   redirige al valor recibido.
4. **La regla de cola compara `reservationId`, nunca el nombre.** Una entrada
   espera sin llave hasta que la salida previa se confirme.
   **La llave principal la tiene quien está dentro**, y eso lo decide
   `principalKeyHolder` en el dominio: salida sin confirmar →
   `PENDIENTE_DEVOLUCION`; in house → `ASIGNADA`; entrada sin confirmar →
   nadie. La importación lo escribe y la pantalla de revisión lo simula con
   **la misma función**, para que no puedan divergir. Nunca se le quita la
   llave a otra estadía, ni se asigna una extraviada o fuera de servicio: ahí
   el conflicto es real y se conserva. Decisión revisada: la primera versión
   no entregaba ninguna llave al importar y dejaba treinta avisos no
   accionables por importación.
   **La llave se puede entregar a mano** (`handMainKey`, botón «Entregar la
   llave» en la ficha, permiso `key.assign`). Faltaba, y era un agujero que
   dejaba al mesón sin poder trabajar: la principal sólo se asignaba como
   efecto de confirmar un check-in, así que una estadía que entra al sistema
   ya como `IN_HOUSE` —como la trae el informe de in house— dejaba al
   recepcionista viendo al huésped dentro, la llave «disponible» y **ningún
   botón**. Encima el único gesto de llaves de la ficha exigía `key.stock`,
   que es del Supervisor. No inventa lógica: llama a `assignMainKey`, la
   misma del check-in. Cuando no hay nada que pulsar, la ficha **dice por
   qué**. Lo vigila `tests/rooms-keys.test.ts`.
   **Una sola implementación:** `services/keys.ts::reconcilePrincipalKeys(tx,
   user, {businessDate?})`. La importación la llama acotada al día de su lote;
   la **reconciliación explícita** del inventario (botón en `/llaves`, permiso
   `key.stock`, `reconcileKeysAction`) la llama sin acotar, para alcanzar
   estadías cargadas antes de que la regla existiera. Es idempotente. No hay
   ni debe haber una segunda lógica de asignación.
   **Una ocurrencia de estancia tiene una sola realidad operativa.**
   `CHECK_IN → IN_HOUSE → CHECK_OUT` son evidencias sucesivas de la misma
   ocurrencia cuando coinciden ID de reserva (prioritario), habitación y
   llegada; el localizador secundario, huésped, salida, `businessDate` y estado
   previo validan que la transición sea coherente. Importar significa
   identificar, conciliar y actualizar: el estado nunca forma parte de la
   identidad. Una salida seguida de una reentrada real conserva dos
   ocurrencias porque cambia la llegada. Un room move explícito conserva la
   reserva y abre un segmento de destino, con devolución/entrega de llaves en
   su flujo existente. El histórico de cada informe permanece en
   `PmsImportBatch`; una contradicción irresoluble se omite y aparece en la
   bandeja de conciliación. La unicidad viva queda protegida además por el
   índice parcial `RoomStay_live_occurrence_key`.
   Decisión revisada: separar `CHECK_OUT` como otra fase dejaba simultáneamente
   `IN_HOUSE` y `CHECK_OUT` para la misma estancia. También se concatenaban las
   columnas `ID` y `Localizador` al mapear ambas como `reservationId`. Lo
   vigilan `tests/pms-reconciliation.test.ts`,
   `tests/pms-actividad-importar.test.ts` y
   `tests/pms-formatos-flexibles.test.ts`.
4bis. **Archivar no es anular.** Anular dice «no se va a usar» y sólo vale
   antes de empezar; archivar dice «ya pasó y no quiero verlo» y saca el turno
   de las listas conservando su historia, sus registros y su entrega
   (`archivedAt`). El servidor **rechaza archivar un turno en curso**: eso se
   cierra, no se esconde. Un turno archivado tampoco se reutiliza al abrir uno
   nuevo. Lo vigila `tests/turnos.test.ts`.
   Decisión revertida: las ventanas de duración libre hasta 12 h se
   eliminaron. El hotel tiene dos ventanas y son fijas (ver 11); una ventana
   libre era complejidad que nadie pedía y permitía solapar dos turnos.
5. **El stock de llaves se cuenta, no se guarda.** Habitaciones 401–429,
   501–530, 601–630 (89) y 12 copias en el stock del Supervisor.
6. **Inter como única familia tipográfica.** Jerarquía por tamaño, peso y
   color. Sin mayúsculas forzadas ni `letter-spacing` en etiquetas. Identidad
   cromática azul petróleo + dorado.
7. **El semáforo nunca depende sólo del color**: siempre lleva texto y símbolo
   (`src/components/ui/tone.ts`).
8. **Secretos nunca en texto plano en la base ni en el cliente.** Las llaves de
   despliegue viven en variables de entorno. Cuando una credencial se administra
   desde la interfaz (SMTP o proveedor de Fronti), sólo se persiste cifrada con
   AES-256-GCM y la llave deriva de `AUTH_SECRET`, que permanece en el entorno.
   El ejemplo de variables vive en `docs/entorno.example`, no en un
   `.env.example` de la raíz.
9. **La garantía es una entidad, y el resumen de la reserva se conserva.**
   `Guarantee` (tipo, monto, moneda, estado) cuelga de `ReservationReference`.
   `ReservationReference.guaranteeStatus` **no se elimina**: lo leen el motor
   de alertas y la entrega de turno. Se mantiene sincronizado por **un único
   camino de escritura** (`syncReservationSummary`, privado en
   `services/guarantees.ts`), así que nada de lo que ya funcionaba cambia.
   Reglas: los estados se mueven sólo por la máquina de
   `domain/guarantees.ts` (`canTransition`); `APLICADA_PARCIALMENTE` exige
   monto y motivo, `MULTA` exige monto, y `aplicado + multa` nunca supera el
   total; `RECHAZADA` **jamás se deriva**, sólo la pone una persona; al
   eliminar la última garantía el resumen se deja como estaba, no se
   reinventa. Las alertas de garantía leen `Guarantee` directamente, así que
   son inmunes a una desincronización del resumen.
10. **El vínculo `RoomStay` → `ReservationReference` es opcional y por
    código.** `RoomStay.reservationId` y `guestNames` **se conservan**: son la
    fotografía de lo que entregó el PMS. `reservationRefId` se resuelve por
    **código** de reserva (`linkStaysToReservations`), nunca por nombre, y
    queda nulo cuando la reserva no existe en el sistema. Una estadía sin
    vínculo sigue siendo válida y operable.
11. **DOS ventanas fijas, turnos creados al abrir y relevo SECUENCIAL.**
    La lógica usa día **07:00–20:00** y noche **20:00–08:00**. Recepción sólo
    puede interactuar con la operación cuando su turno está **ACTIVO**.
    El saliente inicia el cierre y queda limitado al flujo de Caja/entrega/cierre;
    enviar la entrega NO libera su participación. Debe cerrar formalmente el turno.
    Sólo entonces el entrante puede abrir el suyo. **Única excepción: turno de
    emergencia.** Si el saliente no puede cerrar y la continuidad real del mesón
    no puede esperar, el entrante debe abrir una advertencia previa, seleccionar
    una causa cerrada válida y aceptar expresamente las condiciones. Un atraso,
    descuido u olvido no es por sí solo una causa válida. La emergencia queda
    marcada en `Shift`, conserva el turno de origen y genera una alerta crítica
    automática que se reabre mientras el saliente siga sin cierre formal.
    Si existe una entrega pendiente de un turno ya cerrado, el entrante queda
    bloqueado hasta recontar Caja, validar las garantías y confirmar la recepción.
    La entrega/recepción genera un acta imprimible con firma del recepcionista
    saliente, del entrante y espacio para validación de Supervisión/auditor designado.
    `ShiftAssignment` conserva la trazabilidad de quién estuvo en cada turno.
    Lo vigilan `tests/turnos.test.ts`, `tests/turnos-solapados.test.ts`,
    `tests/shift-cycle.test.ts` y las pruebas del gate operativo.
12. **La caja se traspasa con fondo fijo, y la exigencia la activa el fondo.**
    `CashFund` define cuánto debe quedar SIEMPRE en el cajón por divisa (en
    este hotel **CLP 100.000 y USD 150**). Lo que excede es recaudación del
    turno y sale como `CashTransfer` a tesorería.
    **Mientras no exista una fila activa en `CashFund`, la caja no existe**:
    entregar y recibir funcionan igual que antes del módulo. Eso deja intactas
    las pruebas del ciclo de turno y no bloquea un despliegue nuevo el primer
    día. `CashFund` y `HandoverElementType` **no son catálogo** —son
    configuración del hotel— así que `resetOperationalData` los borra: si no,
    el conjunto de pruebas daría resultados distintos según el orden de los
    archivos. Las **denominaciones sí** son catálogo y viven en `seedCatalog`.
    El arqueo se cuenta **por denominación**, dos veces: lo declara quien
    entrega (`DECLARADO`) y lo recuenta quien recibe (`CONFIRMADO`). La
    **diferencia entre ambos se calcula, nunca se almacena**, igual que los
    conflictos de importación. Recontar reemplaza el arqueo anterior en vez de
    acumular dos.
    Un descuadre **no impide entregar si viene explicado**: un faltante existe
    y hay que poder declararlo, no esconderlo. Lo único que se rechaza es un
    descuadre sin una palabra.
    Los montos se calculan en **unidad menor como entero** (`domain/cash.ts`):
    el peso no usa centavos y el dólar sí, y multiplicar cantidades por valores
    en coma flotante da 149,99999 donde debía haber 150.
    Los elementos físicos (llaves maestras, radio, objetos olvidados,
    encomiendas) son una lista **editable por el hotel**; los obligatorios
    bloquean la entrega y la recepción. Las **garantías por resolver se
    enlazan** desde el módulo de garantías, no se duplican.
    Lo vigilan `tests/caja.test.ts` (20, dominio puro) y
    `tests/caja-turno.test.ts` (16, ciclo completo).

13. **Un comunicado obligatorio bloquea la pantalla hasta confirmar la
    lectura.** Lo emite el Supervisor (`announcement.manage`), a todos o a una
    persona, desde `/supervision`. No es una notificación —ésas se ignoran— ni
    una alerta —ésas describen un estado del hotel—: es parar el mesón para
    decir algo.
    **La confirmación pide texto**, porque un botón solo se pulsa sin leer, y
    lo escrito se guarda: después se sabe no sólo quién confirmó, sino qué
    entendió. **Confirmar no exige permiso**, sólo sesión: si lo exigiera,
    alguien podría quedar bloqueado sin forma de desbloquearse.
    **Quien lo emite queda confirmado de entrada**, o se bloquearía a sí mismo
    y no podría ni corregirlo. **El bloqueo se calcula, no se guarda** —activos
    menos los confirmados—, igual que los conflictos de importación. Se muestra
    **uno a la vez**: cinco apilados garantizan que no se lea ninguno.
    El bloqueo es de interfaz, no de seguridad: quien sepa usar la consola
    puede saltárselo. Lo que el sistema garantiza es que **sin confirmar no
    queda registro de lectura**.
    ⚠️ Vive en el LAYOUT, así que `revalidatePath` no basta para liberarlo: el
    router del cliente seguiría mostrando el árbol que ya tenía. Por eso
    `ActionForm` ganó `refreshOnSuccess`. Fue un fallo real, encontrado en
    navegador: la confirmación se guardaba y la pantalla seguía bloqueada.
    Lo vigila `tests/comunicados.test.ts`.

14. **La ayuda es documentación, no un modelo de lenguaje.** Los
    procedimientos viven en `domain/help.ts`, **en el mismo repositorio que el
    código**, así que una regla que cambia y una ayuda que miente se ven en el
    mismo cambio. Una respuesta inventada sobre cómo cerrar una caja es peor
    que no tener ayuda, y por eso una búsqueda sin resultados **lo dice** en
    vez de mostrar algo aproximado.
    Se filtra por permisos: nadie ve el procedimiento de algo que no puede
    hacer. Y por eso existe `atascado-sin-permiso`, **sin `anyOf`**: un
    recepcionista que buscaba «no deja confirmar» recibía «¿Cómo tomo un
    turno?», porque el reseteo está filtrado por un permiso que él no tiene.
    Lo encontró una prueba en navegador.
    **Sólo ejecuta acciones reversibles** (`HELP_ACTIONS`): reconciliar llaves
    es idempotente, regenerar un borrador conserva las notas manuales.
    Confirmar una salida, un check-in o un arqueo no están ahí y no deben
    estarlo; una prueba falla si alguna acción usa un permiso operativo.
    El **tutorial del primer ingreso** reutiliza los mismos procedimientos —no
    repite sus textos— y muestra sólo los del rol. Se puede saltar desde el
    primer paso, porque alguien con el mesón lleno no puede quedar atrapado, y
    se reabre desde el perfil. `User.tutorialDoneAt` vive en el usuario y no en
    el navegador: quien entra desde otro equipo ya conoce el sistema.
    Lo vigila `tests/ayuda.test.ts`.

15. **Gerencia sólo consulta, salvo como responsable.** Rol `GERENCIA`
    (`operational: true`, porque tiene que poder figurar como responsable) con
    **cinco permisos, todos de lectura**. Una prueba falla si se le cuela uno
    de escritura al agregar un permiso nuevo al catálogo.
    La excepción no se concede con un permiso —sería un permiso sobre todos
    los registros— sino comprobando la propiedad del registro concreto:
    `requirePermissionOrOwner(permiso, cargarDueños)`, que mira el permiso
    PRIMERO para que quien lo tiene no pague una consulta extra. La aplican
    `changeTaskStatusAction`, `toggleChecklistAction` y
    `changeEntryStatusAction`.
    Hicieron falta dos permisos de LECTURA nuevos: ver un huésped exigía
    `guest.manage`, que además permite editarlo, y ver Supervisión exigía
    gestionar incidencias. Ahora existen `guest.view` y `supervision.view`, y
    `requirePageAnyPermission` deja entrar con cualquiera de los dos.
    No puede tomar turnos aunque su rol sea operativo: le faltan
    `shift.start`, `shift.receive` y `shift.handover`.
    Lo vigila `tests/rol-gerencia.test.ts`.
16. **La multa es el formulario de papel, con sus campos.** `Fine` guarda lo
    que ya se usaba: número de reserva, habitación, huésped, tipo de blanco,
    **tipo de mancha**, por qué procede el cobro y **la negativa del huésped**.
    Ese último es un campo propio y no una nota suelta: cuando el cobro se
    discute, lo que decide es haber registrado su versión en el momento.
    El contexto **se autocompleta desde la estadía** de la habitación —pedirle
    al mesón que transcriba el número de reserva con el huésped delante es
    pedirle que se equivoque— y sigue editable.
    `fineProblems` devuelve **todos** los campos que faltan, no el primero.
    Cobrar contra la garantía de **otra reserva** se rechaza en el servidor: es
    el error más caro que puede cometer un mesón. Una multa cobrada o anulada
    no vuelve atrás; si hubo un error se anula y se registra otra.
    Permiso `incident.manage`: cobrarle a un huésped es decisión de
    supervisión. Lo vigila `tests/multas.test.ts`.
17. **El tablero del Supervisor muestra la CARGA, que el listado no muestra.**
    `/supervision/tablero`: lo que no tiene dueño primero, y después cuántas
    tareas, vencidas, registros y urgentes tiene cada persona. Asignar reutiliza
    `assignTaskAction` y `updateEntryAction` en lugar de una acción propia: si
    hubiera una tercera, las reglas vivirían en dos sitios.
18. **Los checklists son DOS modelos, y por eso se pueden editar.** La
    plantilla es lo que se define; la **ejecución copia el texto** de cada
    punto y el nombre de la plantilla. Si apuntara a la plantilla viva, editar
    un punto cambiaría lo que alguien ya firmó, y un control reescribible hacia
    atrás no controla nada.
    Los puntos se escriben **uno por línea**, y un `*` al inicio marca el punto
    como crítico: el Supervisor arma la lista de una sentada, y un constructor
    de filas convierte cinco segundos en veinte clics. Una **falla exige
    observación**, sólo quien recorre la ronda la marca, y no se cierra con
    puntos sin revisar —ni como «no aplica»—.
    `ChecklistTemplate` **no es catálogo**: la arma cada Supervisor, así que
    `resetOperationalData` la limpia. Lo vigila
    `tests/supervision-tablero.test.ts`.

20. **Las notificaciones suenan.** Un recordatorio que sólo cambia un número
    en una esquina no avisa de nada: en el mesón nadie mira la campana.
    `components/layout/notification-chime.tsx` consulta cada 20 s
    (`getUnreadCounts`, dos `count` en paralelo, sin `revalidatePath`) y suena
    **cuando el número SUBE**, no cuando es distinto de cero: si sonara con
    cualquier valor, sonaría en cada consulta mientras quedara algo sin leer,
    que es la forma más rápida de que alguien apague el sonido para siempre.
    El contador de la cabecera se renderiza en el servidor y sólo cambia al
    navegar; de ahí que haga falta la consulta.
    **El tono se sintetiza con Web Audio, no es un archivo**: nada que
    descargar, ningún `.mp3` en el repositorio, y el primer aviso no llega
    tarde porque el audio se estuviera bajando. Dos notas ascendentes con
    envolvente suave —un oscilador que arranca y se corta en seco chasquea y
    suena a falla—. Una **alerta** suena distinto de una notificación (tres
    notas más agudas): si sonaran igual, dejaría de distinguirse lo que hay que
    atender ya. Incluye alertas además de notificaciones porque los
    recordatorios y seguimientos llegan como alerta.
    Los navegadores no permiten audio antes de un gesto, así que el contexto se
    prepara con el primer clic y, si el navegador se niega, no pasa nada: el
    contador rojo sigue estando. El silencio se guarda en `localStorage` y se
    contempla que el almacenamiento falle.

21. **«Dejar el sistema en cero» es lo ÚNICO que borra de verdad.**
    `/admin/puesta-en-cero`, sólo el Administrador de sistema
    (`isSystemAdmin`, no sólo el permiso) y hay que **escribir la frase**
    «DEJAR EN CERO»: lo que protege de un borrado accidental no es un diálogo
    que se cierra con Enter, es tener que escribir algo.
    No contradice la regla 2 (nada se borra): eso vale para la OPERACIÓN, y
    esto es un gesto de INSTALACIÓN, una vez, antes de que existan datos
    reales. La pantalla muestra la cuenta real de filas antes de tocar nada.
    **Conserva el catálogo** —roles, permisos, áreas, habitaciones, llaves con
    su numeración, denominaciones, fondo fijo, parámetros— porque si se fuera,
    «dejar en cero» sería «desinstalar». **Y conserva la cuenta que lo
    ejecuta**: si se borrara, el hotel se quedaría sin forma de entrar a su
    propio sistema, sin arreglo posible desde dentro.
    Las llaves no se borran —están numeradas y cuestan dinero— pero se desligan
    de su estadía y vuelven a «disponible».
    Borra la auditoría de las pruebas, pero la entrada que registra la propia
    puesta en cero se escribe DESPUÉS de la transacción y **sobrevive**.
    Todo en una sola transacción: una puesta en cero a medias dejaría el libro
    incoherente. El orden es el mismo que `resetOperationalData` en las
    pruebas, y se mantienen juntos a propósito. Reemplaza al comando de consola
    `npm run demo:purge`, que exigía abrir una terminal contra producción.
    Lo vigila `tests/puesta-en-cero.test.ts`.

## Arquitectura operativa canónica v1.5.0

**El Libro Operativo de Recepción no es un PMS.**

El PMS externo constituye, cuando corresponda, una fuente opcional de contexto.
El núcleo funcional es:

```text
Turnos
├─ Novedades
├─ Caja
├─ Llaves
└─ Supervisión
```

Infraestructura: Usuarios · Roles · Permisos · Auditoría · Configuración.

Referencias opcionales: Habitación · Huésped · Reserva · identificadores externos.

- **Novedades** funciona sin PMS, reserva ni estadía.
- **Caja** funciona sin PMS; habitación, huésped y referencia son contexto opcional.
- **Supervisión** administra su propio turno, tareas, seguimientos, notas,
  auditorías e indicadores sin interpretar PMS.
- **Turnos** coordinan relevo y entrega operativa; PMS no es una precondición.
- **Llaves** es inventario físico autónomo. Cada movimiento nuevo puede existir
  con `stayId = null`; el inventario por pisos 4, 5 y 6 persiste conteos,
  faltantes, sobrantes y fuera de servicio.
- `Room` se conserva como referencia física (número/piso), no como motor de
  ocupación.
- `RoomStay`, `ReservationReference`, `GuestReference`,
  `PmsImportBatch` y conciliación PMS son **LEGADO AISLABLE**. Se conservan
  mientras tengan consumidores históricos; no deben intervenir indirectamente
  en navegación, permisos operativos, apertura/cierre de turno, Novedades,
  Caja, Supervisión ni inventario físico de Llaves.
- Los vínculos históricos PMS de entidades activas permanecen opcionales para
  no destruir trazabilidad. Un FK histórico no autoriza a reintroducirlo como
  requisito funcional.
- La limpieza física de tablas o datos PMS es una fase destructiva separada y
  requiere justificación y autorización explícita.

## Caja — semántica canónica v1.3.1

- **Fondo fijo no es saldo esperado.** Caja física = fondo fijo + garantías
  reembolsables bajo custodia + saldo operacional.
- **Arqueo = contado vs esperado físico.** Nunca se deriva recaudación con
  `contado - fondo`; un sobrante físico es una diferencia no explicada.
- **Tesorería es transferencia interna, no gasto.** Sólo puede mover saldo
  operacional positivo. El servidor protege fondo fijo y garantías incluso si
  físicamente están en el mismo cajón.
- **Garantía parcial:** sólo el remanente reembolsable sigue siendo custodia.
  Lo aplicado/multado pasa a saldo operacional sin crear un movimiento físico;
  una multa parcial devuelve automáticamente el resto.
- Cada `CashCount` guarda `expectedSnapshot`; si Caja cambia después de un
  arqueo, éste queda obsoleto y debe repetirse antes de transferir custodia.
- Transferencias a Tesorería se serializan por divisa con advisory lock para
  impedir que dos operaciones concurrentes gasten el mismo disponible.
- El código histórico `TESORERIA` se conserva por compatibilidad de datos,
  pero su significado funcional es **TRANSFERENCIA INTERNA**.

## Rendimiento: lo aprendido en producción

La base está en `sa-east-1`. Production se sirve desde **Vercel** y la única
rama Neon activa es `production`. **Vercel despliega automáticamente sólo `main`**:
`vercel.json` mantiene desactivados los previews de otras ramas. `main` + Vercel Production + Neon `production` son la única fuente de verdad alojada. CI usa PostgreSQL efímero; no existe staging persistente ni debe crearse otra rama Neon sin instrucción humana explícita.
La lección de rendimiento permanece: la latencia entre función y base puede convertir
consultas encadenadas en un problema
operativo. De ahí vienen varias reglas de rendimiento que no deben revertirse:

1. **Nunca una consulta por fila.** La siembra hacía 230 `upsert` y agotaba la
   transacción de instalación (P2028). Va por lotes. Lo vigila
   `tests/seed-performance.test.ts`, que cuenta consultas.
2. **Nunca encadenar esperas independientes.** El libro consultaba sus cuatro
   fuentes en serie; el panel encadenaba seis contadores. Todo va en
   `Promise.all`. Lo vigila `tests/query-parallelism.test.ts`.
4. **Nada pesado dentro del render.** El motor de alertas son 18 consultas y
   corría dentro de Inicio: 18 esperas delante de la primera pantalla del
   turno. Ahora corre con `after()`, ya enviada la respuesta, y el panel bajó
   de 32 a 17 consultas. `after()` lanza fuera de una petición, así que va
   envuelto: el motor es frescura, no corrección, y no puede tumbar la
   pantalla. Presupuesto vigilado (≤20 consultas).
3. **Ninguna pantalla que consulte la base antes de redirigir puede
   pre-generarse.** `/login` quedó congelada durante la compilación con la base
   vacía y provocó `ERR_TOO_MANY_REDIRECTS`. Lo vigila
   `tests/page-rendering.test.ts`.
5. **Lo que se carga en tiempo de ejecución hay que declararlo para que
   viaje.** El worker de pdf.js no se importa de forma estática, así que el
   trazador de Next no lo copiaba a la función: en local funcionaba y en
   producción los tres informes fallaban con «Setting up fake worker failed».
   Va en `outputFileTracingIncludes` para `/turno` y `/habitaciones/importar`,
   y `read-pdf.ts` fija `GlobalWorkerOptions.workerSrc` en vez de dejar que
   pdf.js deduzca la ruta. Lo vigila `tests/empaquetado-pdf.test.ts`, que lee
   el manifiesto `*.nft.json` —la lista real de archivos desplegados— de modo
   que comprueba el empaquetado sin desplegar.

Transacciones largas (instalación, importación) llevan
`{ timeout: 30_000, maxWait: 10_000 }` y su página `maxDuration = 60`.

Índices: se agregan **sólo** con un patrón de consulta real detrás. Los del
libro (`createdAt` en `Task`, `FollowUp`, `Alert`) y `RoomStay.reservationId`
están justificados en `prisma/migrations/20260915210000_indices_libro_y_reserva`.

## Interfaz

- **Barra lateral fija:** `sticky top-0 h-screen` en el `<aside>`. Sin altura
  acotada su `overflow-y-auto` interno no puede activarse y el menú se va con
  el scroll. Ningún ancestro puede llevar `overflow`. Lo vigila
  `tests/navigation.test.ts`.
- **Toda acción responde en el mismo clic:** `SubmitButton` usa
  `useFormStatus`; los enlaces llevan estado `active:`.
- **La navegación tiene pantalla de espera:** `(app)/loading.tsx` y
  `habitaciones/loading.tsx`. Next las muestra al pulsar el enlace, sin
  esperar al servidor. `useLinkStatus` existe en Next 15.5 pero **no está
  exportado públicamente**: no se importa desde la ruta interna.
- **Actualización optimista sólo donde es reversible y sin consecuencia
  operativa:** pasos de una tarea y notificaciones leídas. El patrón es
  `useFormStatus` dentro del formulario, mostrando el estado destino mientras
  `pending`; si el servidor rechaza, la revalidación devuelve el estado real y
  no queda nada inventado. **No** se aplica a confirmar salidas, entregar
  llaves ni recibir turnos.
- **`ActionForm` guarda lo escrito y lo devuelve si la validación falla.**
  React 19 vacía el formulario en cuanto la acción termina; sin esto, quien
  registra una novedad larga pierde el texto por olvidar un campo.
- **Las credenciales viajan como dato (`ActionState.credentials`), nunca
  dentro del texto del mensaje.** Su presencia impide que `ActionForm` cierre
  o vacíe el formulario: se muestran en un panel con copia al portapapeles y
  una salida deliberada. Error real: la clave generada iba en el mensaje y el
  diálogo se cerraba al tener éxito, así que desaparecía antes de poder
  leerla —no se guarda en claro y no se recupera— y el usuario quedaba creado
  sin forma de entrar. Lo vigila `tests/credenciales.test.ts`.

19. **El correo se configura desde la consola, y la clave se guarda cifrada.**
    `/admin/correo` (`system.configure`). **La base manda cuando está
    configurada; el entorno es el respaldo.** Al revés sería peor: una variable
    olvidada ganaría, el administrador vería «guardado» y los correos seguirían
    saliendo por el servidor viejo sin que nada lo explicara. Sin nada
    configurado, el comportamiento es idéntico al de antes de la pantalla.
    Esto **no rompe** la regla de que los secretos viven en el entorno: lo que
    se guarda es el texto CIFRADO (AES-256-GCM, `lib/secret-box.ts`) y la llave
    se deriva de `AUTH_SECRET`, que sigue en el entorno. La base no contiene
    por sí sola lo necesario para leer la clave —importa, porque se ramificó
    dos veces con datos reales para ensayar migraciones—. ⚠️ Rotar `AUTH_SECRET`
    vuelve ilegible lo guardado: `openSecret` devuelve `null` y la pantalla
    pide reescribir la clave en lugar de caerse.
    La clave **nunca vuelve al navegador**, ni cifrada: se informa si hay una y
    se ofrece reemplazarla. Vacío conserva la actual; quitarla es un gesto
    aparte. No va en `SystemSetting` porque ahí el valor es `Json` y se lista
    genéricamente en `/admin/parametros`.
    **El envío de prueba es la razón de ser de la pantalla**: configurar correo
    a ciegas es cómo se llega a un sistema que calla. El error del servidor se
    muestra tal cual. El dominio avisa —sin bloquear— cuando el puerto no
    corresponde al protocolo: «IMAP + 995» no funciona, y es el par que venía
    en las credenciales del hotel (995 es POP3S; IMAP sobre SSL es 993).
    La entrada **se guarda pero todavía no se lee**: el sistema sólo envía, y
    la pantalla lo dice en vez de aparentar lo contrario.
    Lo vigila `tests/correo.test.ts`.

22. **El importador entiende hechos, no una plantilla.** PDF, Excel `.xlsx`,
    CSV y TSV se reducen al mismo modelo. El diccionario reconoce por semántica
    ID, tipo/estado, llegada, salida, habitación, cliente/nombres/apellidos y
    datos auxiliares, aunque cambien orden, idioma o distribución en dos
    líneas. Los IDs pueden ser alfanuméricos. La revisión muestra lo reconocido
    y lo descartado; una fila ambigua no se aplica y ninguna reserva se vincula
    por nombre. Varios archivos del mismo tipo son válidos: sólo se colapsan
    filas idénticas, mientras las divergencias llegan al detector de conflictos.

## Pendientes conocidos

- **SMTP se administra desde la aplicación.** Debe ejecutarse un envío de
  prueba después de cualquier rotación de `AUTH_SECRET` o cambio del proveedor
  de correo; el estado concreto de Production no se documenta en el repositorio
  público.
- El correo **entrante** no lo usa el sistema: sólo envía. Sus datos se pueden
  guardar ya, pero no hay lector.
- **PMS e inventario tienen cobertura funcional e invariantes auditables.** El
  estado y los conteos concretos de Production pertenecen al control operativo
  privado y no se documentan en el repositorio público.
- **Chat v1.9:** `Attachment` ya tiene implementación para mensajería. Los
  binarios viven en **Cloudflare R2 privado** y el navegador sube directamente
  mediante URL temporal firmada; Neon conserva sólo metadatos. La descarga
  vuelve a pasar por una ruta autenticada del Libro que comprueba pertenencia
  a la conversación. Sin las variables R2 configuradas, la mensajería de texto
  sigue operativa y la subida binaria se mantiene deshabilitada.
- El chat incluye directos/grupos, presencia y estado de turno, respuestas,
  reacciones, guardados, búsqueda, escritura en curso, recibos de lectura,
  @menciones (incluidos `@todos` y `@turno`), GIF con Tenor opcional y
  Wikimedia como respaldo, stickers de imágenes, capturas pegadas/arrastradas,
  archivos y notas de voz.
- Sin dominio propio del hotel.
- No existe una prueba de navegador autenticada en CI. La compuerta cubre
  servicios, dominio, base real efímera, tipos y build; Production comprueba
  `/api/health/version` y `/login`, pero todavía no reproduce un turno completo
  mediante navegador.
- La política de respaldo y restauración de Neon debe administrarse mediante
  una lista privada de infraestructura; no publicar nombres de ramas, copias ni
  ventanas de recuperación en este repositorio.

## Compuerta de calidad

`npx tsc --noEmit` · `npx next lint` · `npm test` · `npm run build`.
Las cuatro en verde antes de dar algo por terminado. Ningún error conocido
queda sin documentar acá.


## FRONTI v2 — rollout controlado
- Política de inferencia: **costo monetario obligatorio USD 0**. Cadena actual: Groq Free 120B → Cloudflare Workers AI Free GLM-4.7-Flash → Groq Free 20B. OpenAI no participa en la ruta operativa.
- FRONTI v2 se implementará por etapas: alpha → beta → RC → 2.0.0.
- El plan detallado vive en `docs/FRONTI_V2_ROADMAP.md`.
- El acceso se controla por usuario desde Administración.
- Administrador de sistema: siempre habilitado.
- `@eherrera`: habilitado desde la primera etapa.
- Resto de usuarios: deshabilitado por defecto hasta aprobación explícita.
- El bloqueo se aplica tanto en UI como en `/api/fronti`; no es sólo ocultamiento visual.
- Durante alpha se conserva FRONTI v1 como fallback técnico mientras se construye el nuevo núcleo multi-paso, Context Builder y Tool Registry.
