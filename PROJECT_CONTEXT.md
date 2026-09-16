# Libro Operativo de Recepción — contexto técnico

Memoria breve del proyecto. Sirve para no volver a analizar toda la aplicación
en cada sesión. **Mantener corto.** La documentación larga vive en `docs/`.

## Stack

Next.js 15 (App Router, Server Components, Server Actions) · React 19 ·
TypeScript estricto · Prisma 6 · PostgreSQL en **Neon** (`sa-east-1`) ·
desplegado en **Vercel** (`gru1`) · Tailwind · Vitest contra PostgreSQL real.

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

Cinco destinos principales, uno por pregunta operativa:

| Destino | Pregunta |
|---|---|
| `/` Inicio | ¿Qué ocurre ahora? |
| `/libro` Libro operativo | ¿Qué tengo pendiente? |
| `/habitaciones` | ¿Qué ocurre en cada habitación? |
| `/turno` | ¿Qué debo entregar al siguiente turno? |
| `/supervision` | ¿Qué debo revisar como Supervisor? |

**Supervisión no es una pantalla del mesón.** Su `anyOf` es
`['supervision.view', 'shift.manage']`. Llevaba `incident.manage`, y ése lo
tiene la recepción —de noche hay que poder mover una incidencia—, así que la
pestaña le aparecía al Auditor nocturno, que es un perfil de recepción. Se
corrigieron las dos causas: el permiso del auditor
(`20260916180000_supervision_no_es_del_meson`) y el `anyOf` del menú. Lo vigila
`tests/navigation.test.ts`.

Más un grupo *Consulta* (`/llaves`, `/huespedes`, `/historial`,
`/indicadores`) y *Sistema* (`/admin`).

En **móvil** la barra inferior muestra los cuatro primeros y **«Más»** abre el
resto. Ese botón no es un adorno: el menú lateral está oculto por debajo de
`lg`, así que sin él Llaves, Huéspedes, Historial, Indicadores y
Administración eran **inalcanzables desde el teléfono**. «Más» lleva aviso
rojo cuando algo detrás tiene pendientes, de modo que las alertas de
Supervisión siguen viéndose. Lo vigila `tests/navigation.test.ts`, que
comprueba rol por rol que ningún destino visible quede sin puerta.

**Decisión que no se revierte:** tareas, incidencias, alertas y seguimientos
**no son módulos del menú**. Son clases de un mismo flujo y se consultan desde
el libro (pestañas `?clase=`), Inicio, la ficha de la habitación y Supervisión.
Sus páginas siguen existiendo como vista secundaria porque cada una aporta
acciones propias (reconocer una alerta, cerrar un seguimiento con resultado).
`tests/navigation.test.ts` falla si vuelven al menú.

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
   **Sí importa los informes del PMS.** Cargar los tres informes no es
   operar: es alimentar el sistema con su fuente de datos y no asigna a nadie
   como responsable. Excluirlo dejaba un callejón sin salida —en un hotel
   recién instalado la única cuenta es la suya y no podía cargar el primer
   día de datos—. Vive en `ROLE_PERMISSIONS`.
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
   **Una reserva es UNA estadía por habitación y por FASE.** `CHECK_IN` e
   `IN_HOUSE` son el mismo hecho en dos etapas —el informe de entradas la
   lista como llegada y el de in house como alojada— así que se conservan en
   una sola estadía y gana el estado más avanzado (`mostAdvancedStayStatus`).
   `CHECK_OUT` es un hecho APARTE: una reserva que sale y vuelve a entrar el
   mismo día son dos filas, y eso es lo que hace existir
   `sameReservationTurnaround`. La fase la decide `stayPhase` en el dominio.
   La clave de deduplicación de `applyImport` y el emparejamiento de la
   pantalla de revisión usan **la misma fase**: si divergieran, la revisión
   anunciaría estadías que al aplicar no se crean.
   Decisión revisada: la clave incluía el estado completo, y por eso la misma
   reserva en dos informes creaba dos estadías. En producción la 629 mostraba
   a la misma reserva como «Actual · In house» y «Entrante · Check-in» a la
   vez, con un conflicto de llave que no existía. Lo vigilan dos pruebas en
   `tests/rooms-keys.test.ts`.
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
8. **Secretos sólo en variables de entorno.** El ejemplo vive en
   `docs/entorno.example`, **no** en un `.env.example` de la raíz: las
   plataformas de despliegue leen ese archivo como lista de variables
   obligatorias y bloquean el despliegue.
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
11. **DOS ventanas fijas, turnos creados a voluntad, UNO en curso a la vez.**
    Día **07:00–19:59** y noche **20:00–07:59** (`SHIFT_SCHEDULE`). No hay un
    tercer turno ni ventanas a medida.
    Los turnos **no se programan de antemano**: `openShift` es un solo gesto
    que crea el turno si no hay ninguno en curso, o **suma** a quien llega al
    que ya está abierto. Si hay un turno abierto se trabaja sobre ése.
    La invariante «un solo turno en curso» la garantiza un **índice único
    parcial** que Prisma no sabe expresar (`Shift_un_solo_turno_en_curso`, en
    `20260916170000_turnos_dia_noche`); el servicio la comprueba además para
    dar un mensaje legible, no para garantizarla. `ENTREGA_ENVIADA` queda
    FUERA del predicado: quien entregó espera en la bandeja y el relevo
    necesita abrir el suyo para recibirlo.
    El titular es quien abrió el turno; quien se suma es apoyo. Pueden sumar
    gente quien está en el turno y quien lo supervisa (`addShiftMember`).
    ⚠️ **ESTO CORRIGIÓ UN FALLO QUE BLOQUEABA LA OPERACIÓN.** Antes había tres
    franjas de ocho horas y una unicidad `(date, type)`, y de ahí salía la
    necesidad de programar. Para recibir una entrega el sistema buscaba «el
    turno de la franja anterior» por `(date, type)`: si esa fila no existía
    —porque nadie la programó— no encontraba nada que recibir, y cerrar exigía
    que existiera «el turno siguiente», que tampoco existía. En producción
    había un turno ACTIVO del 14 de septiembre con la cadena cortada. La
    **adyacencia se eliminó**: `nextShiftSlot`, `previousShiftSlot`,
    `shiftOrder`, `slotKey`, `parseSlotKey`, `getStartableShifts`,
    `currentShiftType`, `ensureShift` y `customWindow` **ya no existen**.
    Ahora la entrega pendiente es **única y no se deduce**: la que está
    ENVIADA y sin recibir (`getPendingHandover`). `toShiftId` queda **nulo**
    al entregar y lo escribe quien recibe: cuando alguien entrega, el turno
    que recibirá todavía no existe.
    `ShiftAssignment` es el registro de quién estuvo, no un requisito.
    Lo vigilan `tests/turnos.test.ts` y `tests/shift-state.test.ts`. Las
    pruebas `turno-sin-asignacion` y `turno-duracion` se eliminaron: probaban
    las franjas tomables y las duraciones libres, que ya no existen.
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

## Rendimiento: lo aprendido en producción

La base está en `sa-east-1` y las funciones en `gru1` (`vercel.json`). **Antes
estaban en `iad1` y cada consulta costaba ~120 ms.** De ahí vienen los tres
errores que sólo aparecieron desplegados, y sus reglas:

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

## Pendientes conocidos

- **SMTP sin configurar en producción.** Ya no hace falta desplegar para
  arreglarlo: se configura en `/admin/correo`. Mientras falte, al crear un
  usuario la clave se muestra en pantalla en vez de enviarse, y se informa en
  lugar de fallar en silencio.
- El correo **entrante** no lo usa el sistema: sólo envía. Sus datos se pueden
  guardar ya, pero no hay lector.
- Los tres informes del PMS no se han importado todavía en producción, así que
  el inventario de llaves sigue sin reconciliar (101 disponibles, 0
  movimientos). Se resuelve importando o con el botón «Reconciliar con las
  estadías» de `/llaves`; el código ya está desplegado y probado.
- `Attachment` existe en el esquema sin ninguna implementación, y no hay
  almacenamiento de archivos definido (FASE G).
- Sin dominio propio del hotel.

## Compuerta de calidad

`npx tsc --noEmit` · `npx next lint` · `npm test` · `npm run build`.
Las cuatro en verde antes de dar algo por terminado. Ningún error conocido
queda sin documentar acá.
