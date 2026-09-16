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

Más un grupo *Consulta* (`/llaves`, `/huespedes`, `/historial`,
`/indicadores`) y *Sistema* (`/admin`).

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
`GuestReference`/`ReservationReference`/`Guarantee` · `AuditLog` ·
`SystemSetting`.

El libro proyecta cuatro de ellas (`OperationalEntry`, `Task`, `FollowUp`,
`Alert`) sobre un tipo común `BookItem`: una sola línea temporal, cada objeto
conserva su modelo y sus reglas.

## Decisiones que no se revierten

0. **La identidad de una cuenta es su usuario, no su correo.** En el hotel
   varias cuentas comparten la casilla de recepción, así que el correo **no
   identifica a nadie y puede repetirse**: `User.email` no es único. El que sí
   lo es —y con el que se inicia sesión— es `username` (`@EHerrera`): se
   muestra con arroba y se guarda sin ella. La comparación al entrar **ignora
   mayúsculas**, porque en el mesón nadie recuerda si se escribió `EHerrera` o
   `eherrera`; por eso `allocateUsername` mide la colisión también sin
   distinguirlas, aunque el índice único de PostgreSQL sí las distinga: si
   coexistieran las dos, entrar sería ambiguo. `LoginAttempt.identifier`
   guarda lo que se escribió, exista la cuenta o no. Lo vigila
   `tests/identidad-usuario.test.ts`.
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
   **Una sola implementación:** `services/keys.ts::reconcilePrincipalKeys(tx,
   user, {businessDate?})`. La importación la llama acotada al día de su lote;
   la **reconciliación explícita** del inventario (botón en `/llaves`, permiso
   `key.stock`, `reconcileKeysAction`) la llama sin acotar, para alcanzar
   estadías cargadas antes de que la regla existiera. Es idempotente. No hay
   ni debe haber una segunda lógica de asignación.
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
11. **Los turnos no se asignan de antemano.** Nadie reparte los turnos: quien
    llega al mesón toma el que corresponde. Lo que habilita a tomar una franja
    es que esté libre, y lo que la pone primera en la lista es que el turno
    anterior haya dejado **un cierre esperando confirmación**. `/turno` ofrece
    la franja del reloj, las que siguen a una entrega enviada y sin recibir, y
    los turnos que alguien haya programado a mano, que siguen valiendo.
    La franja viaja como `AAAA-MM-DD:TIPO` (`slotKey`), no como id de fila,
    porque puede no existir todavía: la crea el propio inicio, dentro de la
    transacción, con `ensureShift`, que es idempotente. `parseSlotKey` valida
    la fecha **componente a componente**: `new Date(2026, 12, 1)` no falla,
    desborda en silencio a enero de 2027, y un mes 13 crearía un turno en una
    fecha que nadie pidió.
    `ShiftAssignment` **no desaparece**: deja de ser requisito y pasa a ser el
    registro de quién tomó el turno, que es lo que consulta `getMyOpenShift`.
    Decisión revisada: la prueba «no permite iniciar un turno al que no estás
    asignado» se eliminó a propósito y se reemplazó por la invariante que sí
    sobrevive —un turno ya tomado no se le quita a quien lo tomó—. Lo vigila
    `tests/turno-sin-asignacion.test.ts`.

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

## Pendientes conocidos

- **SMTP sin configurar en el despliegue**: el código está listo —el puerto
  465 activa TLS directo en `src/server/mail.ts`— pero las variables
  (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`) sólo
  existen en la plataforma de despliegue, cifradas, **nunca en el repositorio**.
  Mientras falten, al crear un usuario la clave se muestra en pantalla en vez
  de enviarse a `recepcion@hoteleshw.com`, y `mail.ts` lo informa en lugar de
  fallar en silencio.
- El correo **entrante** no lo usa el sistema: sólo envía. Conviene saber que
  el 995 es POP3 sobre SSL, no IMAP (IMAP sobre SSL es 993).
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
