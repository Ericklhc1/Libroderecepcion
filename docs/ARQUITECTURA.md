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
se fue a casa; obligarlo a volver a cerrar dejaría turnos colgados. El estado
`RECIBIDO` sigue existiendo y se usa cuando el parámetro
`shift.autoCloseOnReceive` está desactivado, y el cierre manual permanece
disponible para el último turno del ciclo (sin turno siguiente).

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

136 pruebas en 10 archivos, sobre PostgreSQL real:

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

`tests/global-setup.ts` aplica migraciones con `migrate deploy` sobre
`TEST_DATABASE_URL` y siembra el catálogo; cada archivo limpia los datos
operativos. Se exige que `TEST_DATABASE_URL` sea distinta de `DATABASE_URL`.

`server-only` y `next/headers` se sustituyen por stubs (`tests/stubs/`), ya que
sólo existen dentro del runtime de Next.js.

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
