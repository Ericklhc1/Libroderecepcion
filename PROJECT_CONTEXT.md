# Libro Operativo de Recepción — contexto técnico

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
| `/caja` Caja | ¿Qué dinero entró, salió o debe corroborarse? |
| `/llaves` Llaves | ¿Dónde está cada llave física y qué arrojó el último inventario? |
| `/supervision` Supervisión | ¿Qué requiere control, seguimiento o validación del Supervisor? |

**Inicio es una ventana operativa, no un segundo Libro.** Muestra el estado del
turno, cuatro indicadores accionables y una única bandeja priorizada construida
por reglas determinísticas. No vuelve a listar por separado tareas, incidencias,
alertas, seguimientos, novedades y entregas.

`/reservas`, `/habitaciones` y la importación PMS son legado aislable:
pueden conservar datos y rutas históricas mientras existan consumidores, pero
no forman parte de la navegación operativa ni conceden capacidades PMS a
Recepción, Auditor nocturno o Supervisor. Habitación y huésped pueden seguir
apareciendo como referencias opcionales.

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
    Sólo entonces el entrante puede abrir el suyo. Si existe una entrega pendiente,
    el entrante queda **INICIADO** y bloqueado hasta recontar Caja, validar las
    garantías y confirmar la recepción; recién ahí pasa a **ACTIVO**.
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
