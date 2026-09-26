# Relevo de agentes — Libro Operativo de Recepción

> Canal persistente de continuidad entre ChatGPT, GitHub Copilot, Cursor/Codex y otros agentes.
> No guardar secretos, connection strings, passwords, tokens, cookies ni PII.

## Estado actual

- Fecha de referencia: **2026-09-21**.
- Versión en Production al iniciar el Centro de Supervisión: **v1.1.6**.
- Siguiente versión propuesta: **v1.2.0**.
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
