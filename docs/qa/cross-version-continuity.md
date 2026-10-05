# Ensayo sintético entre versiones 1.57.0 → 1.58.0

Estado: preparado, **sin ejecutar**. Sólo se comprobaron sintaxis y contratos de
fuente. No habilita merge, despliegue ni operación sobre Production. Los archivos
nuevos y su publicación requieren autorización antes de subirlos al repositorio.

## Identidad y método

- Base: `928f57b5fc6823229d160623e6253d4a7ce02fb3` (1.57.0).
- Candidata: argumento obligatorio de `run.sh`, un SHA exacto de 40 caracteres,
  sin valor por defecto. El ensayo puede usar un candidato conjunto provisional
  UI + asignación futura, identificado por SHA y etiquetado explícitamente como
  diagnóstico sin aprobación de release. Si las correcciones producen otro SHA,
  revisar el delta y repetir lo afectado sobre ese nuevo SHA. El workflow
  propuesto fija el candidato provisional `9ad0138dbba3069847a392d2ff30bccd6eea8570`,
  árbol `ee053c0500227e14327fe7cba90a57fd4d5e945e`, con motor y UI diagnóstica.
  Incluye la reparación SPA bajo validación y no aprueba un release. La base
  local del arnés sigue siendo `c1428ea`.
- El SHA de ambas fuentes queda en `results.json` y en los logs, junto con los
  BUILD_ID. No se acepta evidencia del candidato anterior para el nuevo head.
- Dos archivos de fuentes extraídos por `git archive`, dos instalaciones limpias,
  dos builds secuenciales. No se reutiliza `.next` ni se modifica la configuración.
- Un PostgreSQL 16 desechable en `127.0.0.1:5432/libro_test`; autenticación normal
  por cookie firmada y sesión persistida, con una misma clave **sintética** de
  autenticación. No se configura `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` ni un
  `deploymentId`. La clave de autenticación no es la clave de Server Actions.
- Ambos servidores escuchan sólo en loopback. Un proxy en `localhost:3000`
  cambia de base a candidata manteniendo origen, cookie, Host y Origin. No hace
  afinidad a despliegues, fallback, reproducción manual de POST ni mezcla assets.
- El arranque programático soportado de Next declara su origen público
  `localhost:3000` y escucha por detrás en 3101/3102. No modifica next.config ni
  los builds; evita que el puerto interno contamine `request.url` y produzca un
  falso 403 de same-origin. Una sonda sin actor ni procedimiento operativo exige
  404 para procedimiento inexistente con origen correcto y 403 para origen ajeno
  en ambos builds; no se relaja la comprobación de seguridad.
- El navegador conserva el documento y la aplicación React vieja. Un marcador
  de memoria del documento detecta recarga; se comparan los valores exactos antes
  del cambio. El envío usa el botón real y espera su POST de Server Action y la
  respuesta de `ActionForm`. La verdad final se comprueba en PostgreSQL.
- El inventario, fondos, garantía, movimiento y turno activo son fixtures. La
  preparación, conteo, custodia, revisión, envío, cierre y recepción se realizan
  mediante las acciones nativas de la UI, sin escribir esos resultados por SQL.

## Matriz de aceptación exacta

Cada escenario se repite a 1280 y 390 px, con base sintética nueva por escenario.
Las pruebas no corren concurrentemente porque comparten la base.

| Caso | Estado antes del cambio | Criterio obligatorio | Evidencia |
|---|---|---|---|
| Infraestructura | SHAs exactos y mismo esquema | Versiones 1.57.0/1.58.0, BUILD_ID diferentes, ninguna diferencia Prisma | SHAs, build IDs, cantidad de IDs comunes; nunca claves |
| Arqueo viejo | Turno NOCHE activo → preparación nativa en base; CLP 20.000 + USD 20 y garantía CLP 10.000 marcados, sin guardar | Documento y todos los campos sobreviven al cambio; POST de acción antigua llega a candidata y es aceptado | Backend del POST, pertenencia del ID a cada manifiesto, HTTP y evento ActionForm |
| Persistencia de arqueo | Mismo formulario anterior | Exactamente un DECLARADO, cantidades 1/1, nota exacta, usuario/timestamp, garantía en snapshot separado | CashCount/Line/expectedSnapshot |
| Custodia vieja | Segunda pestaña de base con selección sin guardar de llaves/teléfono | Selección y documento intactos; POST auténtico aceptado; declared=true | Campo e_ID, manifiesto, backend y HandoverElement |
| Nota vieja | En base se guardan arqueo/custodia y se cierra Caja; paso 2 deja observación/siguiente acción sin guardar | POST desde documento viejo aceptado, sin recarga; una sola nota con textos exactos | HandoverItem manual y marcador de documento |
| Recarga forzada | Otra pestaña con nota sin guardar | Se observa si la recarga conserva el borrador; **no se usa como recuperación** | hardReloadDraftRetained; false acredita el límite, no compatibilidad |
| Control candidato | Todo el mismo escenario cargado desde candidata | Mismos contratos pasan sin cambio de backend | Resultado separado por ancho; no puede enverdecer un caso cruzado fallido |
| Cierre nativo | Conteo/custodia y nota comprobados | Cierre formal Caja, pendientes/final, envío y cierre del saliente | ShiftCashClosure; Shift CERRADO, actualEnd/closedById; participación terminada |
| Recepción nativa | Saliente cerrado, actor entrante distinto | Revisión, recuento, validación garantía, custodia, final y activación | DECLARADO/CONFIRMADO únicos; entrante ACTIVO; entrega RECIBIDA |
| Firmas canónicas | Mismas sesiones desde antes del cambio | issuedBy/receivedBy y issuerSessionId/receiverSessionId exactos, timestamps, auditoría custodia de ambos actores | Sesiones y AuditLog; no firma manuscrita simulada |
| Continuidad | Novedad y tarea abiertas; inventario existente | Pendientes siguen abiertos y referenciados en snapshot; snapshot emitido inmutable tras recepción; inventario completo idéntico | IDs canónicos y digest del inventario RoomKey |
| Aislamiento | Entorno sin credenciales de proveedores ni mailSettings | Ningún HTTP/socket externo permitido, ningún correo ENVIADO | Guard de red, bloqueo navegador, consulta de outbox |
| API custom: faltante | Entrega ENVIADA, saliente CERRADO y receptor INICIADO sintéticos; documento y motivo de la base sin enviar | Botón real publica JSON de la base a `handover-missing` candidata, con campos exactos y sin añadir pin | Origen, campos, HTTP, respuesta JSON, backend y revisión persistida |
| API custom: autorización | Supervisor distinto abre aprobación en la base, sobre declaración vigente | Botón real llama `handover-missing-approve` candidata; auditoría y sesión independientes; `confirmed` continúa false | Contrato JSON exacto, identidad y timestamp; navegación documental nativa registrada |
| API custom: revisión obsoleta | Segunda pestaña conserva revisión anterior de declaración/aprobación | API candidata devuelve 400; borrador sigue visible y no hay cambio de elemento ni auditoría | Comparación DB antes/después, documento y valores conservados |
| API custom: corrección | Diferencia autorizada que el receptor corrige desde la base | Borra la aprobación y exige nueva revisión independiente; no activa turno ni inventa posesión | Nueva declaración/aprobación auditadas; Caja, garantía, llaves y snapshot emitido intactos |
| Control API custom | Mismos escenarios cargados desde candidata | Separado del control de Server Actions y del cruce viejo→nuevo | Resultado independiente por ancho |

Para cada envío cruzado, pertenecer sólo al manifiesto antiguo y ser rechazado
por el servidor candidato es evidencia de incompatibilidad de Server Actions.
Cuando además pasa el control candidato del mismo ancho, se etiqueta
`CONFIRMED_STALE_ACTION_NO_GO`. Un fallo anterior de fixture, selector, permisos,
conexión o control es inconcluso y exige diagnóstico; no se atribuye a Skew.

Un rechazo esperado sirve para **detectar NO-GO**, nunca para considerar aprobada
la compatibilidad. El proceso sale con código 1 si falla cualquier escenario o
guard. Un error general del arnés sale con 2. No se propone `continue-on-error`.
Incluso código 0 mantiene `productionDecision=UNVERIFIED_PLATFORM_AND_RELOAD_LIMITS`.

## Límites que permanecen

- No acredita **Vercel Skew Protection**. El máximo de siete días fue verificado
  en la configuración de plataforma el 5 de octubre; sigue faltando una prueba
  end-to-end del enrutamiento real. Este reemplazo local intencionalmente no emula
  esa protección ni añade pin a los fetch custom del cliente viejo.
- Los IDs de Server Action pueden cambiar entre builds aunque el módulo no
  cambie: Next instalado usa `serverReferenceHashSalt: encryptionKey`. Compartir
  una clave para obtener verde ocultaría el riesgo y no forma parte del ensayo.
- `ActionForm` conserva campos para errores en un `useRef` del documento. No es
  un borrador duradero. Recargar, cerrar pestaña o perder el proceso puede perder
  texto sin guardar. La prueba de recarga deja visible ese resultado.
- No reproduce una sesión real de 12 horas ni espera hasta las 08:00. Crea un
  turno NOCHE con fin **08:00 America/Santiago** por la función canónica y prueba
  las transiciones inmediatamente. No afirma cobertura de expiración de sesión,
  cambio DST, suspensión de iPhone, offline o navegador Safari físico.
- Custodia de llaves significa la declaración/recepción canónica del elemento
  físico. El inventario de llaves completo se conserva, pero no se ensayan 89
  conteos físicos, préstamos o cambios de habitación nuevos.
- Las excepciones de elemento faltante usan una precondición sintética preparada
  por la fixture, sin fondo activo como la regresión de recepción existente;
  declaración, correcciones, rechazos y aprobaciones se ejecutan
  con botones reales. Este bloque específico no simula su cierre/recepción final
  ni confirma validación posterior de Supervisión del cierre. El ciclo normal
  completo permanece como escenario separado.
- Los fetch custom observados pueden hacer navegación documental completa al
  terminar. El ensayo la registra y no la oculta; no promete conservar otros
  formularios sin guardar cuando esa navegación sucede. Sus respuestas JSON se
  observan inmediatamente, sin reproducción manual ni respuesta simulada.
- No migra esquemas diferentes, no ensaya una caída del servidor durante un POST,
  concurrencia de dos recepcionistas ni reintentos de doble clic en este bloque.
- Los controles de red son instrumentación Node y rutas Playwright, no un
  firewall del sistema. Prisma sólo recibe la URL loopback; no se configuran
  transportes/proveedores externos. La preparación descarga dependencias oficiales.

## Ejecución y costo

Aplicar el diff de workflow propuesto sólo después de autorizar los archivos
nuevos y la ejecución conjunta. La opción recomendada es una rama efímera nueva
`codex/aroh-continuity-once-20261005`, creada desde la base Production exacta
`928f57b5fc6823229d160623e6253d4a7ce02fb3`, añadiendo sólo los siete archivos QA
del manifiesto. Publicar el workflow inicia el ensayo: ese efecto debe estar
incluido expresamente en la autorización. La compatibilidad puede adelantarse
contra un SHA conjunto provisional; eso no aprueba sus otros fallos UI ni lo
convierte en versión publicable. Se exige Compuerta final para el release.
El único trigger push exige esa rama exacta y un cambio del archivo de workflow;
no responde a push de otra rama, PR ni cambios aislados del arnés. El job comprueba
otra vez la rama y ambos SHAs. Antes de publicar, sustituir el marcador inválido
por el SHA concreto autorizado; no resolver una rama mutable ni usar `latest`.
Invoca `bash scripts/cross-version/run.sh "$CANDIDATE_SHA"`. Usa el runner
estándar `ubuntu-latest`, PostgreSQL efímero, ningún entorno/deploy/secret de GitHub,
ningún proveedor IA y ningún artefacto subido. El informe sin tokens aparece en
los logs del job. La fixture privada y logs de servidor quedan sólo en el runner
efímero y **no** se incluyen en el informe ni en `upload-artifact`.

**Alternativa manual, no activada:** un workflow sólo con `workflow_dispatch`
e input `candidate_sha` obligatorio evita iniciar el ensayo en un push. GitHub requiere que ese workflow
esté en la rama predeterminada para recibir ese evento, según su
[documentación oficial](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
Publicarlo sólo en una rama QA no basta para afirmar que se podrá ejecutar
manualmente. No se registra en main ni se modifica el despliegue. Por ello se
recomienda el push acotado de la rama efímera, expresamente autorizado como
publicación más ejecución, en lugar de tocar main para registrar la alternativa.

**Aislamiento de pipelines comprobado:** en la base Production revisada,
Compuerta escucha push a main y PR a sus bases, el diagnóstico antiguo sólo su
rama específica y Release sólo Compuerta finalizada en main. La rama propuesta
no coincide con ninguno de esos triggers y no se abrirá PR. `vercel.json` mantiene
`git.deploymentEnabled` en false para `**` y true sólo para main. No se cambia
esa configuración. La búsqueda GitHub de la rama propuesta no devolvió ramas a
las 23:46 UTC. Antes de publicar, volver a comprobar nombre libre, triggers y
configuración; si difieren, detenerse y explicar el cambio. Esto no afirma conocer
integraciones externas que el repositorio o conector no expongan.

En un repositorio público, el runner estándar de GitHub Actions no requiere
minutos de pago, según la [documentación oficial de facturación](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
consultada el 4 de octubre de 2026. La [página del repositorio](https://github.com/Ericklhc1/Libroderecepcion)
se muestra pública en la consulta. Debe comprobarse el contexto antes de lanzar si
esto cambia a privado; no se habilita consumo adicional. La ejecución operacional
es local y sin llamadas externas. El job entero **no es inbound-only**: checkout,
npm y la instalación de Chromium requieren descargas salientes a servicios de
infraestructura. No afirmar «sin red» ni «costo cero verificado» sin comprobar la
visibilidad/facturación del repositorio.

Lectura de GitHub el 4 de octubre de 2026, 23:39 UTC: repositorio público.
Documentación oficial de facturación reconfirmada: runners estándar en repositorios
públicos son gratuitos; logs no consumen almacenamiento de artefactos. Este job
no configura caché, no sube artefactos, no solicita revisión Copilot, no cambia
presupuestos y no usa runners grandes. La preparación descarga dependencias y
Chromium; la ejecución operacional posterior sólo permite loopback.

Vercel `get_project`/`get_deployment` consultados en sólo lectura a las 23:41–23:42
UTC: Production READY continúa en `928f57b5fc6823229d160623e6253d4a7ce02fb3`.
Ninguna respuesta expuso Skew Protection, su duración ni retención. Eso no prueba
que esté desactivada ni que alcance las 08:00/08:09. Actualización del 5 de octubre:
la inspección de Advanced encontró Skew activado con doce horas; se amplió y
verificó guardado a siete días. Esa configuración no equivale a validación E2E,
no fija automáticamente fetch custom y no protege todo borrador ante una recarga.

## Adecuación al candidato y compuertas pendientes

Comparación GitHub de `3dbba1ed` a `fee67ba`: sólo clases del layout y geometría
del diálogo, sin cambio de esquema, servicio ni contrato operativo. Comparación
`928f57b5` a `fee67ba`: ninguna modificación en `prisma/` ni `src/server/`.
El arnés sigue siendo adecuado para detectar incompatibilidad de formularios al
reemplazar directamente esos builds, después de fijar el SHA exacto. No sustituye
los siete fallos UI independientes que se están corrigiendo ni su Compuerta completa.
Si un selector o control candidato falla, el resultado sigue siendo inconcluso;
no debe atribuirse a Skew ni pintarse verde. Los arreglos UI posteriores requieren
revisar de nuevo los cambios y ensayar el nuevo SHA.

Para el conjunto provisional UI + asignación futura se debe comparar otra vez
el SHA publicado exacto. El informe guarda hashes de las fuentes del transporte,
UI de custodia, ruta API, acciones, servicio y validación same-origin; un hash
distinto exige lectura del delta, no demuestra por sí solo incompatibilidad.
Los casos `cross-custom-custody` y `candidate-custom-custody-control` comprueban
por separado los contratos y barreras de las dos API sin afirmar cobertura Skew.

El PostgreSQL 17 anterior está instalado fuera del PATH en el entorno local y sus
logs muestran migraciones/fixture previas; no son evidencia del ensayo cruzado.
Este arnés exige GitHub Actions desechable y PostgreSQL 16. No se falsean esas
guardas para ejecutarlo localmente ni se repiten builds pesados en un entorno que
ya agotó memoria.

## Manifiesto para publicación autorizada

Archivos nuevos preparados:

1. `scripts/cross-version/run.sh`
2. `scripts/cross-version/browser.mjs`
3. `scripts/cross-version/fixture.mts`
4. `scripts/cross-version/no-external.cjs`
5. `docs/qa/cross-version-continuity.md`
6. `docs/qa/cross-version-workflow.patch`

Al autorizar la activación se crearía además
`.github/workflows/cross-version-continuity.yml` aplicando el parche; aún no existe.
Son siete archivos QA nuevos en total al aplicar el parche. El cambio existente
en `docs/AGENT_HANDOFF.md` no forma parte de la publicación solicitada y debe
quedar fuera del commit. La rama efímera debe partir de `928f57b5`, sin copiar
commits UI ni el árbol completo de este worktree. Publicar sólo este alcance QA. No
mezclar cambios UI/operativos, crear PR, integrar main, activar otra configuración,
desplegar, tocar Neon Production ni efectuar escrituras operativas reales.

La solicitud de autorización debe incluir subir estos archivos al repositorio
público y ejecutar el job mediante ese push concreto, contra el SHA exacto
autorizado (provisional o final identificado), con seguimiento y
correcciones acotadas al arnés si aparecen fallos de prueba. Ningún resultado del
job autoriza por sí mismo un despliegue.

## Archivos

- `scripts/cross-version/run.sh`: fuentes exactas, guardas, dependencias/builds.
- `scripts/cross-version/fixture.mts`: datos y sesiones sintéticos, sólo loopback CI.
- `scripts/cross-version/no-external.cjs`: bloqueo HTTP/fetch/TCP/TLS de runtime.
- `scripts/cross-version/browser.mjs`: proxy, navegador conservado, validación DB.
- `docs/qa/cross-version-workflow.patch`: propuesta aislada, aún no activa.

Verificación realizada aquí: `node --check` en ambos archivos JavaScript,
`bash -n`, transpile sintáctico de `fixture.mts` (0 diagnósticos), `git diff --check`.
Pendiente: ejecución del job completo, lint/tipos/pruebas/build canónicos y lectura
del resultado exacto antes de decidir cualquier publicación.

## Primera ejecución provisional, 5 octubre 2026

Run `37255639233`, candidata `02467f43`: ambos builds aprobaron con BUILD_ID
distintos, cero Server Action IDs compartidos, claves independientes y red de
runtime limpia. Las sondas de origen aceptaron el público y rechazaron el ajeno
en ambos builds. Ningún guardado cruzado llegó a ejecutarse: el arnés omitía abrir
«Entregar turno» y la fixture de excepción pretendía cerrar un turno con fondo
activo sin cierre de Caja, correctamente impedido por la base. Son fallos del
arnés, no evidencia de incompatibilidad de la aplicación. Se corrigen esas
precondiciones; el ciclo normal conserva fondos activos y cierre nativo completo.
Los fallos futuros incluyen diagnóstico de texto visible exclusivamente sintético.
