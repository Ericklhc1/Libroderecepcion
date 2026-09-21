# Arquitectura

Documento breve de las decisiones que no son evidentes al leer el código.

## Stack

| Pieza | Elección | Por qué |
| --- | --- | --- |
| Framework | Next.js 15 (App Router) | Server Components y Server Actions permiten validar y autorizar en el servidor sin construir una API paralela. Menos código, menos superficie de error. |
| Lenguaje | TypeScript estricto | `strict`, `noUncheckedIndexedAccess` y `noUnusedLocals` activos. |
| Base de datos | PostgreSQL + Prisma | Restricciones reales (claves únicas y foráneas) que sostienen los invariantes del dominio, no sólo validación en código. |
| Validación | Zod | Un esquema por operación, siempre ejecutado en el servidor. |
| Autenticación | Propia: bcrypt + JWT (`jose`) en cookie httpOnly + tabla `Session` | Sin dependencia de un proveedor externo. La sesión persistida permite revocarla y auditarla; un NextAuth completo habría agregado complejidad sin aportar nada que aquí se necesite. |
| Interfaz | Tailwind CSS + componentes propios | Sin librería de componentes: el sistema es pequeño, específico y se beneficia de un lenguaje visual propio. |
| Pruebas | Vitest contra PostgreSQL real | Los invariantes importantes viven en la base de datos y en transacciones; probarlos con mocks no demostraría nada. |

## Estructura

```
src/
  app/            Rutas. (app)/ agrupa todo lo que exige sesión.
  components/     ui/ (primitivas), operational/ (piezas del dominio),
                  forms/, layout/
  domain/         Lógica pura y sin dependencias: máquina de estados del
                  turno, etiquetas, semáforo visual, normalización.
  lib/            Entorno validado, cliente Prisma, formato, utilidades.
  server/
    auth/         Contraseñas, sesiones, usuario actual, guards de permisos
    services/     Reglas de negocio. Único lugar que escribe en la base.
    actions/      Server Actions: validan, autorizan y delegan al servicio.
```

La regla que sostiene todo: **una acción de servidor nunca contiene reglas de
negocio**. Valida con Zod, exige el permiso y llama a un servicio. Eso permite
probar las reglas sin simular una petición HTTP.

## Modelo de datos

Un solo modelo para el libro operativo: `OperationalEntry` con un campo `type`
(novedad, incidencia, mantenimiento, caja, seguridad, housekeeping, A&B,
sistemas, huésped, reserva, otro). Las incidencias son ese mismo registro con
campos adicionales (`severity`, `impact`, `immediateAction`, `rootCause`,
`resolution`), no un módulo aparte.

`Task`, `FollowUp` y `Alert` sí son entidades propias, porque tienen ciclo de
vida y reglas distintas (asignación y vencimiento; acción/resultado/próxima
acción; deduplicación y postergación). Se relacionan entre sí y con el registro
de origen mediante claves foráneas, y la vista del libro las presenta como un
único flujo cronológico (`getBookItems`). Es la alternativa a tener tres
sistemas desconectados: un modelo por concepto, una sola vista.

### Invariantes sostenidos por el esquema

- `ShiftHandover.fromShiftId` es **único**: un turno no puede emitir dos
  entregas. La base lo rechaza, no sólo el código.
- `Shift(date, type)` es único: un turno por fecha y tipo.
- `Alert.dedupeKey` es único: el motor de alertas es idempotente por
  construcción.
- `OperationalEntry.seq` y `Task.seq` usan secuencias de PostgreSQL: la
  numeración visible no tiene condiciones de carrera.
- `ShiftHandover` exige emisor y turno de origen no nulos: no existen entregas
  huérfanas.

## Máquina de estados del turno

`src/domain/shift.ts` declara el mapa de transiciones permitidas. Cualquier
combinación ausente del mapa es un estado contradictorio y se rechaza con un
mensaje en lenguaje operativo. Se valida siempre en el servidor.

```
PROGRAMADO → INICIADO → ACTIVO → PREPARANDO_ENTREGA → ENTREGA_ENVIADA
           → RECIBIDO → CERRADO
```

Reglas adicionales, verificadas con pruebas:

- No se puede cerrar un turno sin enviar la entrega si existe turno siguiente.
- No se puede cerrar mientras la entrega enviada no sea confirmada.
- Una entrega no puede recibirse dos veces (guarda de concurrencia por
  `updateMany` sobre el estado esperado, dentro de la transacción).
- No se puede recibir una entrega inexistente ni una que no corresponda al
  turno.
- Un usuario no puede tener dos turnos abiertos a la vez.
- Sólo el personal del turno prepara o envía su entrega.

### Decisión: cierre automático al recibir

Cuando el turno siguiente confirma la recepción, el turno saliente pasa a
`CERRADO` en la misma transacción. En una recepción real el turno saliente ya
se fue a casa; obligarlo a volver a cerrar dejaría turnos colgados. El estado `RECIBIDO` se conserva únicamente por compatibilidad con datos históricos.
En el flujo operativo actual, confirmar la recepción cierra el turno saliente en la
misma transacción y registra su hora real de término. No existe un cierre manual
posterior para Recepción; cualquier estado histórico incoherente se corrige mediante
un mecanismo administrativo auditado.

## Motor de alertas

`runAlertEngine()` evalúa reglas acotadas y hace *upsert* por `dedupeKey`.
Ejecutarlo N veces no duplica alertas; cuando la condición de origen
desaparece, la alerta se resuelve sola con nota explicativa, y si la condición
vuelve, se reabre. Las alertas manuales nunca son tocadas por el motor.

Se ejecuta al abrir el panel principal con un límite de una vez por minuto por
instancia (`refreshAlertsThrottled`), y a demanda desde Administración. En la
primera versión no hace falta un proceso programado externo; cuando el volumen
lo justifique, basta invocar `runAlertEngine()` desde un cron sin cambiar nada
más.

## Centro de Supervisión

El turno administrativo `SupervisionShift` es una raíz de agregado distinta de
`Shift`. Ambos pueden estar abiertos a la vez y ninguna transición del primero
escribe caja, habitaciones, llaves, huéspedes o estados del segundo. Un índice
parcial garantiza un solo turno de Supervisión abierto por persona.

El Centro amplía entidades existentes en lugar de duplicarlas: `Task` mantiene
la asignación y añade participantes/validación; `FollowUp` añade visibilidad;
los checklists existentes documentan auditorías sorpresa. Las notas privadas,
hallazgos, medidas correctivas y observaciones de rendimiento sí son entidades
propias porque tienen privacidad, trazabilidad y ciclos de vida diferentes.

La entrega de Supervisión conserva un snapshot JSON inalterable y una recepción
explícita. Los indicadores se calculan desde las fuentes originales y nunca
guardan una calificación global. Diseño, permisos e invariantes completos:
`docs/CENTRO_SUPERVISION.md`.

## Entrega de turno

`buildHandoverSnapshot()` reúne el estado operativo y lo clasifica en Urgente /
Importante / Informativo. Dos decisiones importantes:

1. **Cada asunto se menciona una sola vez.** Las alertas automáticas que sólo
   reflejan un objeto ya listado (una tarea vencida, una incidencia crítica,
   una garantía) se omiten de la sección de alertas. Una entrega ruidosa no se
   lee.
2. **La entrega enviada guarda una fotografía inmutable** (`snapshot` JSON)
   además de sus ítems. Si un registro cambia después, lo entregado sigue
   siendo auditable tal como se entregó.

## Seguridad

- Contraseñas con bcrypt (coste 12) y política de longitud y composición.
- Sesión firmada (HS256) en cookie `httpOnly`, `sameSite=lax`, `secure` en
  producción, con registro en base de datos para revocarla.
- Bloqueo temporal de la cuenta tras cinco intentos fallidos; cada intento
  queda auditado. El mensaje de error nunca revela si el correo existe.
- Cambiar la contraseña, desactivar un usuario o cambiarle el rol revoca sus
  sesiones activas.
- CSRF: las Server Actions de Next.js comparan `Origin` con `Host` y rechazan
  peticiones de otro origen; la cookie `sameSite=lax` refuerza la protección.
- Autorización en el servidor en cada acción (`requirePermission`). La interfaz
  oculta lo que no corresponde, pero nunca es la única barrera.
- Acceso horizontal: las consultas de datos propios (notificaciones, sesiones)
  filtran siempre por `userId`.
- Consultas parametrizadas por Prisma; no se construye SQL por concatenación.
- Secretos sólo por variables de entorno, validadas al arrancar (`src/lib/env.ts`).
- La auditoría redacta campos sensibles (`passwordHash`, tokens) antes de
  guardar el diff.

## Eliminación lógica

Ningún registro operativo se borra desde la interfaz. `deletedAt`,
`deletedById` y `deletionReason` (obligatorio) marcan la eliminación; el
Administrador de sistema restaura desde *Administración → Registros
eliminados*. Todas las consultas operativas filtran `deletedAt: null`.

## El Administrador de sistema fuera de la operación

El rol tiene `operational: false`. Eso se traduce en:

- No aparece en `listOperationalUsers()`, que alimenta todos los selectores de
  responsable, asignado y programación de turnos.
- `assertAssignable()` rechaza asignarle registros, tareas o seguimientos.
- No tiene los permisos `shift.start`, `shift.receive` ni `shift.handover`, y
  `startShift()` lo rechaza explícitamente con un mensaje claro.

La interfaz usa exclusivamente el nombre «Administrador de sistema»; no
aparecen los términos *master*, *maestro*, *superuser* ni *superusuario*.

## Accesibilidad y diseño

Azul petróleo como color principal, dorado como acento, blancos y grises. El
semáforo visual (`src/components/ui/tone.ts`) acompaña **siempre** el color con
texto y un símbolo, de modo que la información no depende del color. Foco
visible, etiquetas asociadas a cada campo, `aria-current` en la navegación y
mensajes de error con `role="alert"`.

Responsive con barra inferior en móvil para las acciones de mesón. La entrega
de turno tiene hoja de impresión.

### Decisión: el formulario no pierde lo escrito

React vacía un formulario en cuanto la acción de servidor termina. Para un
registro guardado eso es lo correcto, pero cuando la validación falla deja a la
persona escribiendo de nuevo una novedad larga por haber olvidado un campo, que
es justo el momento en que menos tiempo hay en el mesón.

`ActionForm` (`src/components/ui/form.tsx`) guarda el contenido de los campos
al enviar y lo devuelve a la pantalla si la respuesta trae error, incluidas las
casillas y los selectores. La corrección vive en el componente común, así que
vale para todos los formularios del sistema sin repetir nada. La validación
sigue ocurriendo únicamente en el servidor.

## Pruebas

196 pruebas en 15 archivos, sobre PostgreSQL real:

| Archivo | Cubre |
| --- | --- |
| `shift-state.test.ts` | Máquina de estados y reglas de cierre (puras) |
| `auth.test.ts` | Login, bloqueo por intentos, sesiones, cambio de contraseña |
| `permissions.test.ts` | Matriz de roles y exclusión del administrador |
| `shift-cycle.test.ts` | Ciclo completo e invariantes del turno |
| `entries.test.ts` | Novedades, incidencias, cierre, borrado/restauración, historial |
| `tasks.test.ts` | Creación, origen, asignación, estados, checklist |
| `alerts.test.ts` | Motor idempotente, autorresolución, gestión |
| `handover-snapshot.test.ts` | Contenido, clasificación y no duplicación |
| `book-search.test.ts` | Búsqueda, filtros combinados, paginación, indicadores |
| `install.test.ts` | Instalación inicial, catálogo sembrado, segunda instalación rechazada |
| `pms-reports.test.ts` | Detección de columnas y normalización de los tres informes |
| `rooms-keys.test.ts` | Regla de cola (408, 414, 515, 610), llaves, stock, conflictos, importación idempotente |
| `env-resolution.test.ts` | Nombres de las variables de conexión de cada proveedor |
| `seed-performance.test.ts` | Coste de la siembra en consultas, idempotencia, llave por habitación |
| `page-rendering.test.ts` | Las pantallas de acceso no se pre-generan |

`tests/global-setup.ts` aplica migraciones con `migrate deploy` sobre
`TEST_DATABASE_URL` y siembra el catálogo; cada archivo limpia los datos
operativos. Se exige que `TEST_DATABASE_URL` sea distinta de `DATABASE_URL`.

`server-only` y `next/headers` se sustituyen por stubs (`tests/stubs/`), ya que
sólo existen dentro del runtime de Next.js.

Los fixtures de `tests/fixtures/` son los informes reales del hotel: conservan
coordenadas, encabezados, identificadores de reserva y números de habitación,
con los nombres de los huéspedes sustituidos palabra por palabra. Así las
pruebas ejercitan la estructura verdadera —incluidos los glifos invisibles y el
pie que cae bajo la última columna— sin versionar datos de huéspedes.

## Instalación de un despliegue nuevo

Un servidor recién creado no tiene usuarios. En lugar de exigir una consola,
`/instalacion` crea el hotel y la primera cuenta de Administrador de sistema
desde el navegador (`src/server/services/install.ts`).

`needsInstall()` es la única condición: cero usuarios. Mientras se cumple,
`/login` y el área privada redirigen a la instalación; en cuanto existe una
cuenta, la pantalla de instalación redirige al inicio de sesión y queda inerte.

La comprobación se repite **dentro** de la transacción que crea la cuenta, de
modo que dos personas abriendo la instalación al mismo tiempo no puedan crear
dos administradores. El catálogo base (permisos, roles con su matriz, áreas y
nombre del hotel) lo siembra `seedCatalog()` en `src/domain/catalog.ts`, el
mismo código que usa la semilla de desarrollo: hay una sola definición del
catálogo y es idempotente.

No se cargan datos de demostración: el sistema arranca vacío.

## Habitaciones, llaves e informes del PMS

Módulo experimental que convierte los informes del PMS en estado operativo. El
PMS sigue siendo la fuente: aquí no se administran reservas, se leen y se les
da seguimiento en el mesón.

### Lectura de los informes

Tres capas, cada una probable por separado:

1. `src/server/pms/read-report-file.ts` acepta PDF, Excel `.xlsx`, CSV y TSV y
   los convierte al mismo flujo de fragmentos. `read-pdf.ts` conserva la
   geometría del PDF; las hojas y archivos delimitados generan una geometría
   tabular equivalente.
2. `src/domain/pms/layout.ts` reconstruye la tabla: agrupa fragmentos en
   líneas, localiza una o dos líneas de encabezados, deduce los límites de columna como
   el punto medio entre encabezados consecutivos y reparte las celdas. **No hay
   posiciones fijas en ninguna parte**: si el PMS mueve una columna, sigue
   funcionando.
3. `src/domain/pms/normalize.ts` reduce los tres informes a una sola estructura.

`src/domain/pms/columns.ts` es el diccionario: traduce el encabezado impreso al
campo canónico. Para soportar otra plantilla se agrega el sinónimo ahí y no
cambia nada más.

Tres particularidades del PMS del hotel que obligaron a decisiones concretas:

- **La habitación se imprime 1,5 puntos más abajo que el resto de la fila.** La
  tolerancia vertical al agrupar líneas es de 5 puntos: suficiente para unir la
  habitación con su fila y no tanto como para absorber la línea de continuación
  de huéspedes, que está a 9 puntos o más.
- **La plantilla intercala glifos de una fuente de iconos** (área de uso
  privado, U+E000–U+F8FF). Si no se descartan, uno se pega al encabezado
  siguiente y la columna queda sin reconocer.
- **El pie del informe cae bajo la última columna.** "In-house 51" se
  reconocería como un huésped más de la última habitación, así que el pie se
  evalúa antes que cualquier otra cosa.

El in house imprime la llegada sin año (`28/08`). Se resuelve contra la fecha
del informe, y si la fecha resultante quedara muy en el futuro se toma el año
anterior: pasa con huéspedes que cruzan el fin de año.

### Estado operativo y regla de cola

`src/domain/rooms.ts` deduce el estado de la habitación a partir de sus tres
capas —saliente, actual, entrante— y de sus llaves. **No se guarda**: se
calcula, así que el tablero no puede quedar desfasado respecto de los datos.

La comparación es **por identificador de reserva, nunca por nombre**. En los
informes reales del hotel el mismo huésped sale con una reserva y entra con
otra en la misma habitación (el caso de la 515): son dos hechos distintos y la
entrada queda en cola.

Cuando la salida y la entrada son la misma reserva (la 610: entra y sale el
mismo día) no hay cola, porque nada bloquea su entrada; el estado pasa a
"Check-in listo", que es la acción que corresponde.

Dos decisiones que los datos reales dejaron a la vista:

1. **Confirmar una salida cierra también la estadía in house de esa misma
   reserva en esa habitación.** Sin eso, la habitación seguiría mostrando a
   alguien dentro después de haberse ido y la entrada no podría pasar nunca. Las
   demás habitaciones de una reserva de grupo no se tocan.
2. **La llave principal nace ligada a su habitación.** Es la llave de esa
   puerta; el stock del Supervisor son las copias.

### Llaves

Las llaves son objetos, no un contador: cada una existe, tiene código y estado,
y cada movimiento queda en `KeyMovement`. El stock disponible **se cuenta**, no
se guarda, así que no puede descuadrarse respecto de las llaves del mesón.

Reglas por estado, verificadas con pruebas: `CHECK_IN` no tiene llave;
`IN_HOUSE` tiene al menos la principal; una salida pendiente conserva su llave
hasta que se confirme; una salida confirmada la devuelve al inventario. Nunca se
reasigna automáticamente la llave del huésped saliente al entrante: hace falta
confirmar el check-in.

### Conflictos

`src/domain/pms/conflicts.ts` trabaja sobre una fotografía del estado, así que
sirve tanto para revisar una importación antes de aplicarla como para vigilar el
estado vigente. **No se guardan**: se recalculan, de modo que no quedan
advertencias viejas colgando.

Decisión relacionada: "más de una llave principal" se detecta en lugar de
prohibirse con una restricción del esquema. Una restricción haría el aviso
imposible y, con él, inútil el control; el servicio de creación ya lo rechaza en
la operación normal.

### Importación en dos pasos

`prepareImport` lee y deja un borrador; `applyImport` lo aplica cuando alguien
lo revisó. La clave de una estadía es fecha de operación + reserva + habitación
+ estado, de modo que **volver a importar el mismo informe no duplica nada**.

Lo que ya decidió una persona no se deshace: una estadía confirmada o editada a
mano sólo recibe datos descriptivos, nunca un retroceso de etapa, y la pantalla
de revisión lo dice antes de aplicar.

### Incidencias con contexto

Toda incidencia (y todo registro de mantenimiento) exige habitación **o** área.
Se valida en el servidor con `superRefine`, de modo que vale para el formulario
y para cualquier otra vía de creación. La ficha de la habitación muestra sus
incidencias con el huésped, la reserva, el estado y las llaves del momento.

## Usuarios, nombres de usuario y credenciales

Cada persona tiene un nombre de usuario corto, del estilo `@EHerrera`: inicial
del nombre más el primer apellido, con un número al final si ya existe.

La clave de un usuario nuevo **la genera el sistema**, no la escribe nadie: 14
caracteres con mayúscula, minúscula, número y símbolo, sin caracteres que se
confundan al dictar por teléfono. Viaja una sola vez al correo de recepción
(`CREDENTIALS_MAIL_TO`, por omisión `recepcion@hoteleshw.com`) y se exige
cambiarla en el primer ingreso. La clave en claro no se guarda en la base ni en
la auditoría, que redacta ese campo.

Si el servidor no tiene correo configurado, el sistema **lo dice** y muestra la
clave en pantalla una sola vez para entregarla en persona, en lugar de fallar en
silencio.

### Decisión: la siembra y la importación trabajan por lotes

Un error real del primer despliegue dejó esta lección escrita en el código. La
siembra del catálogo hacía un `upsert` por fila —más de doscientas consultas— y
la importación una consulta por estadía. Contra una base local eso toma
milisegundos y las pruebas pasaban. En producción, con la función en Washington
y la base en São Paulo, cada consulta cuesta unos 120 ms: la transacción de la
instalación se agotaba a los 5 segundos (`P2028`) y el sistema no se podía
instalar.

Ahora ambas rutinas leen el estado de una vez, deciden en memoria y escriben
agrupado: una decena de consultas en lugar de doscientas, sin que ese número
crezca con las filas. `tests/seed-performance.test.ts` cuenta las consultas
para que el patrón no vuelva.

Las transacciones de instalación e importación llevan además un plazo explícito
de 30 segundos, y sus páginas declaran `maxDuration = 60`: el plazo por omisión
de la plataforma son 10 segundos, que no alcanzan para sembrar el catálogo
completo a través de un océano.

La lección general: **el número de viajes a la base importa más que el número
de filas**, y sólo se nota cuando la base está lejos.

### Decisión: las pantallas de acceso nunca se pre-generan

Segundo error real del despliegue, y el más engañoso. La pantalla de inicio de
sesión decide según el estado de la base: si no hay ninguna cuenta, redirige a
la instalación. Al compilar, la base estaba vacía y esa decisión quedó
congelada en el archivo generado. En cuanto se creó la primera cuenta,
`/instalacion` mandaba a `/login` y `/login` —ya congelada— mandaba de vuelta:
`ERR_TOO_MANY_REDIRECTS`.

Leer la cookie de sesión fuerza el renderizado dinámico, pero aquí la consulta
a la base ocurría **antes** de tocar la cookie, así que la página se pre-generó
igual. Ahora `/login` declara `dynamic = 'force-dynamic'` de forma explícita, y
`tests/page-rendering.test.ts` verifica que las tres pantallas de acceso fuera
de `(app)` no se puedan pre-generar.

La lección general: **una página que consulta la base antes de redirigir no
puede pre-generarse**, y el compilador no lo advierte porque en ese momento la
respuesta es válida.

## Limitaciones conocidas

1. **Adjuntos**: el modelo `Attachment` existe y está relacionado, pero no hay
   subida de archivos en la interfaz. Falta decidir el almacenamiento (disco
   local frente a S3) antes de implementarlo.
2. **Canales externos de notificación**: `dispatchExternal()` en
   `src/server/notifications.ts` es el punto de extensión y está vacío a
   propósito. Correo y WhatsApp quedan para una versión posterior.
3. **Integración con PMS**: `GuestReference` y `ReservationReference` son
   referencias ligeras con campo `externalId` reservado para la
   sincronización. No hay integración todavía.
4. **Paginación del libro**: `getBookItems` consulta las cuatro fuentes y las
   mezcla en memoria tomando `página × tamaño` de cada una. Es correcto y
   suficiente para volúmenes de recepción; con cientos de miles de registros
   convendría una vista materializada o una tabla de índice.
5. **Zona horaria**: las fechas se manejan en la hora del servidor. Para una
   operación multi-hotel en distintos husos habría que persistir la zona por
   propiedad y convertir en los límites.
6. **Motor de alertas sin cron**: se apoya en las visitas al panel. Un hotel
   sin actividad nocturna en el sistema vería las alertas recalculadas al
   siguiente ingreso.
7. **Los informes del PMS se cargan a mano**: no hay integración automática. El
   módulo interpreta el PDF que exporta el PMS; si más adelante el PMS ofrece
   una API, el lector se reemplaza sin tocar el resto del módulo.
8. **La importación es semántica, no una plantilla de FNS.** Reconoce variantes
   habituales en español e inglés, columnas reordenadas, encabezados partidos e
   IDs alfanuméricos. La pantalla de revisión muestra campos reconocidos y no
   usados. Una variante verdaderamente nueva puede exigir un sinónimo adicional
   en `src/domain/pms/columns.ts`, sin tocar la lógica operativa.
9. **El envío de correo necesita SMTP**: sin `SMTP_HOST`, `SMTP_PORT` y
   `MAIL_FROM` el sistema no puede enviar las credenciales y las muestra en
   pantalla. Es una configuración del servidor, no del código.
