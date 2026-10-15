# Cierre ordenado del sistema

Candidato 1.64.2 sobre `main` 9ecb8c82718382c6a3c3496c8ebbada2d125fabd (1.64.1). Preparado para revisión; este trabajo no fusiona, despliega, activa despedida, recibe entregas reales ni restringe usuarios reales.

## Reconciliación previa

El 15 de octubre de 2026, GitHub y los metadatos autenticados de Vercel coincidían en ese SHA. `hwl.operacionesaroh.app` apunta al deployment `dpl_8oQWCtbLDPgSnvDqDuTCaFyHU4ML`, READY/production, del repositorio oficial `Ericklhc1/Libroderecepcion`. PR #282 sigue abierto y solapa Libro, reportes y turnos; no se incorporó ningún commit de ese PR ni de los otros PR abiertos.

Se conservan las protecciones de `main`: PR obligatorio, comprobación estricta «Regresiones, tipos y build», sin bypass. El candidato conserva `git.deploymentEnabled` y retira los cuatro cron de `vercel.json` para evitar volver a registrarlos. La interfaz Vercel disponible no expuso el estado remoto de los cron; su desactivación previa procede de la instrucción recibida. No se consultó Neon Production ni se comprobó el estado actual de 1733. Los controles operativos consultan los turnos vigentes cuando sysadmin use la consola.

## Un control y los flujos existentes

Se amplía `SystemSetting system.maintenance` y la consola existente `/admin/mantenimiento`. No hay otra ruta de producto, tabla, migración ni cambio de roles/permisos. La ausencia de `closure` mantiene el comportamiento anterior.

* **Sin activar:** operación normal o mantenimiento temporal existente.
* **CLOSING:** despedida; se impiden nuevas jornadas y turnos, también al sysadmin. El personal sólo puede terminar Caja, custodia, entrega, recepción y sus jornadas ya existentes. Se reutilizan acciones, permisos, propiedad y comprobaciones nativas. Cerrar un turno no restringe globalmente el acceso.
* **LOCKED:** sólo el rol canónico Administrador de sistema conserva operación y recuperación. El resto ve `/mantenimiento` con «Sistema fuera de servicio». Las guardas de páginas, Server Actions y API se aplican a las sesiones existentes; las cuentas no se borran, desactivan ni cambian de rol.

Los procesos automáticos compatibles se omiten mientras existe un cierre ordenado; se conservan sus colas. No hay cierre, bloqueo ni reapertura por temporizador. El pulso de disponibilidad sólo actualiza pantallas abiertas; el servidor aplica la restricción.

## Activación futura, después de aprobar y publicar

Este procedimiento describe acciones futuras. La confirmación del bloqueo final es independiente de aprobar el código o desplegarlo.

1. Publicar únicamente el candidato revisado por el flujo protegido habitual. Comprobar SHA/versión y que todos los accesos, instancias y clientes soportados usan código compatible. Revisar y drenar solicitudes anteriores; una petición ya iniciada puede terminar. No activar sobre una mezcla de versiones antiguas que desconocen CLOSING.
2. Sysadmin entra a `/admin/mantenimiento`, marca la confirmación de despedida y pulsa **Activar despedida y cierre operativo**. La transición persiste quién la autorizó, cuándo y qué turnos estaban pendientes. Ningún usuario pierde todo el acceso por terminar primero.
3. Cada responsable usa **Cerrar y enviar turno** en Mi turno y completa el recorrido vigente: Caja, custodia, revisión de pendientes, envío y cierre formal. Un error mantiene la operación pendiente y permite corregir/reintentar; no se declara éxito anticipado. Una persona sin turno o con turno terminado no abre otro.
4. El receptor real inicia la recepción final desde la misma entrega. Revisa la entrega, recuenta Caja/garantías, recibe custodia y confirma la revisión final. La recepción final no crea ni activa otra jornada. Hasta la confirmación se muestra «Recepción en curso», no una recepción consumada. Las jornadas de Supervisión/área y relevos HK también se finalizan/reciben mediante sus acciones existentes. En HK, quien recibe debe además aceptar expresamente la revisión de pendientes y custodias; recibir sin aceptar mantiene el bloqueo.
5. Sysadmin revisa **Comprobación de pendientes**. Impiden avanzar los turnos iniciados sin finalizar, participaciones activas, entregas sin recepción real, custodia sin recibir o excepción autorizada, Caja reabierta o sin comprobaciones vigentes en los turnos del cierre actual, y jornadas/relevos de otras áreas pendientes. Se comprueba la conservación de los cierres 1725, 1715, 1700, 1693, 1680 y 1673. No se presupone que 1733 siga activo ni que sea el último. Los históricos anteriores sin cierre formal de Caja se advierten y conservan; no se reconstruye evidencia ficticia.
6. Sólo con los controles completos, pulsar **Descargar respaldo actualizado**, guardar el JSON y abrirlo. La generación/transferencia no marca el respaldo como verificado. Comprobar los cierres anteriores y todos los turnos finales reales, textos, comentarios, identidades, fechas y trazabilidad.
7. Seleccionar el archivo guardado y confirmar su revisión. El navegador lee sus bytes exactos y calcula SHA256 y una prueba con un desafío aleatorio. El servidor compara ambos con el respaldo generado, vuelve a comprobar pendientes y la huella completa de las fuentes. No basta reenviar la huella pública; no se sube el archivo grande al servidor. Esta prueba acredita acceso a los bytes del JSON de registros y referencias, **no a los binarios externos**; la conservación en el destino elegido sigue siendo responsabilidad de quien guarda y revisa el respaldo.
8. Comprobar también los impedimentos de respaldo binario. Este candidato inventaría todos los `Attachment`, `SupportRequestAttachment` y `ChatSticker`, incluidos chat, huérfanos, pruebas e históricos eliminados lógicamente. **Si existe cualquiera, el bloqueo final queda impedido en servidor**, aunque el JSON esté verificado. No hay casilla, frase ni atestado manual que lo salte. Se necesita implementar y probar un respaldo verificable del almacenamiento antes de habilitar el bloqueo en ese caso; una descarga individual, URL o referencia no satisface la precondición. No borrar registros para eliminar el impedimento.
9. Sólo cuando los controles operativos y de respaldo permitan el bloqueo, **solicitar y obtener la confirmación específica de Erick para el bloqueo final antes de ejecutarlo.** Luego sysadmin escribe `DEJAR ACCESO SOLO A SYSADMIN`, marca la autorización específica y pulsa **Dejar acceso exclusivo a sysadmin**. Se muestra la advertencia de pérdida de acceso del personal. El servidor vuelve a validar revisión, respaldo y pendientes de forma atómica. Cualquier cambio operativo posterior a la exportación obliga a generar y verificar otro archivo.
10. Comprobar con una sesión previa del personal y con sysadmin que las páginas/API tienen el comportamiento esperado. Mantener el archivo verificado fuera del sistema.

## Contenido y consistencia del respaldo

Se reutiliza `/api/libro/reporte?respaldo=cierre`, exclusivo de sysadmin durante CLOSING. El JSON incluye manifiesto de formato, fecha, inicio del cierre, huella y tablas operativas ordenadas: turnos, participantes, entregas y sus snapshots, cierres/arqueos/movimientos de Caja, custodia y garantías, originales del Libro, tareas, seguimientos, comentarios, auditoría operativa y relaciones de procedencia. Incluye los originales archivados y con eliminación lógica. No hay tope de 2.000 ni recortes de texto. No exporta contraseñas, tokens, configuración de correo ni memoria de asistentes; los campos sensibles se excluyen de snapshots de auditoría. Las referencias de adjuntos se conservan, pero **no incluye sus archivos binarios** ni constituye un volcado restaurable de toda la base.

El manifiesto declara expresamente que el respaldo de binarios no está incluido ni verificado y muestra el inventario de referencias en base de datos por fuente. El contenido de chat, soporte y stickers no forma parte del respaldo de cierres/Libro; sus referencias binarias se inventarían igualmente para impedir una falsa autorización de cierre global. Un inventario vacío no acredita que el bucket esté vacío: no se inspeccionan R2 ni objetos huérfanos sin fila en la base. `ready` sólo indica que se puede exportar la operación; `lockReady` exige además ausencia de impedimentos de respaldo binario registrado. Se vuelven a leer ambos dentro de los locks al solicitar el bloqueo. La verificación del JSON permanece disponible con adjuntos para conservar los registros, sin autorizar el bloqueo ni afirmar un respaldo íntegro del sistema.

El informe PDF habitual conserva filtros y autorizaciones y ahora incluye texto/comentarios sin el tope anterior. Su motor textual mantiene la representación tipográfica Latin-1 existente; el JSON UTF-8 es el respaldo fiel de caracteres y saltos de línea originales. La impresión individual de entrega incluye comentarios e historial completo. Ninguna de esas vistas sustituye la verificación del JSON final.

Generación, verificación y bloqueo toman el mismo bloqueo asesor del control y bloqueos SHARE sobre las fuentes antes de leerlas. Se mantiene READ COMMITTED deliberadamente: una instantánea RepeatableRead iniciada antes del drenaje podría omitir escrituras que terminan mientras se espera. Después de obtener los locks, las fuentes permanecen estables hasta el commit. El registro del control y su auditoría son atómicos; sus propios eventos quedan fuera de la huella operativa para no invalidarla al verificarla. La respuesta JSON se transmite por bloques y la prueba de archivo usa mensajes pequeños; no se altera el límite global de subida.

## Recuperación y límites

Sysadmin conserva `/admin/mantenimiento` incluso con LOCKED, sin depender del menú ni de un turno nuevo. En **Recuperación del sistema**, confirma y pulsa **Recuperar acceso del sistema**. La operación es auditada, restablece el acceso con los permisos actuales y descarta la autorización del respaldo para un cierre futuro. Los cron permanecen apagados. El botón de mantenimiento temporal no puede saltarse esta recuperación mientras exista un cierre ordenado válido.

La recuperación no borra las declaraciones físicas ni reasigna sus autores. El mismo receptor puede continuar una recepción iniciada desde otra sesión. Sysadmin sólo puede recuperar un reclamo ajeno, con motivo auditado, antes de que exista evidencia física de Caja/custodia. Si esa evidencia ya existe, debe continuar su receptor real. Los estados históricos incoherentes quedan bloqueados para revisión mediante mecanismos administrativos existentes; no se fabrican firmas ni recepciones.

No volver a una versión que ignore el control mientras la despedida/bloqueo siga activo. Para una recuperación de código, usar una versión compatible y conservar `system.maintenance`, las cuentas y la evidencia. Esta implementación no cambia infraestructura, protecciones, cron remotos ni datos de producción.

## Verificación local

Las pruebas usan PostgreSQL 16 efímero en loopback, con bases distintas para Vitest y navegador. `scripts/closure/guard.mjs` exige opt-in sintético y bloquea cualquier otra conexión. `scripts/closure/fixture.mts` y `browser.mjs` sólo preparan y operan datos ficticios. Los resultados finales de lint, tipos, suite, build y recorrido real se registran en `docs/AGENT_HANDOFF.md` y en el PR candidato. No atribuir esta validación a producción.

El shell de despedida conserva la misma frontera `Fragment key="aroh-route-content"` del layout canónico para evitar el replay de un nodo HTML ya reclamado durante la hidratación de React incluido en Next 15. El repro aislado `scripts/ui/hydration-replay-repro.mjs` extrae el `<main>` real del shell y del layout, sin cargar servicios ni base de datos; sustituye únicamente el componente de efectos `FormDraftSession`, cuyo HTML real es nulo. Con el runtime compilado instalado, el control sin frontera reproduce React #418 y reemplazo del DOM en 5/5 intentos; el shell corregido conserva HTML idéntico, pasa 5/5 sin errores ni reemplazo y conserva la identidad del `<main>` y un borrador hermano. Mantiene también los controles previos del layout y template. Esto es una regresión del renderer en jsdom, no una sustitución del recorrido real en navegador.

```bash
# jsdom sólo en el prefijo temporal descrito en la cabecera del repro, sin añadir dependencias al producto:
JSDOM_MODULE=/tmp/aroh-hydration-dom/node_modules/jsdom node scripts/ui/hydration-replay-repro.mjs bundled
```

Reproducción del navegador desde la raíz del repositorio, con Chromium instalado en `/usr/bin/chromium` (o `CHROMIUM_EXECUTABLE_PATH`):

```bash
docker run --rm -d --name aroh-cierre-qa --tmpfs /var/lib/postgresql/data -p 127.0.0.1:55432:5432 -e POSTGRES_USER=libro -e POSTGRES_PASSWORD=libro_test -e POSTGRES_DB=libro_dev postgres:16-alpine
# Cuando pg_isready confirme disponibilidad:
docker exec aroh-cierre-qa createdb -U libro libro_test
export DATABASE_URL='postgresql://libro:libro_test@127.0.0.1:55432/libro_dev?schema=public'
export DIRECT_DATABASE_URL="$DATABASE_URL"
export TEST_DATABASE_URL='postgresql://libro:libro_test@127.0.0.1:55432/libro_test?schema=public'
export AUTH_SECRET='cierre-local-synthetic-no-produccion-0001'
export CLOSURE_QA=synthetic
npx prisma migrate deploy
npx tsx scripts/closure/fixture.mts
```

En una terminal con ese entorno, iniciar `NODE_ENV=development NODE_OPTIONS="--require=$PWD/scripts/etapa1/no-external.cjs" npm run dev -- --hostname localhost`. En otra con las mismas variables, ejecutar `node scripts/closure/browser.mjs`. El navegador rechaza destinos externos y escribe resultados, capturas y respaldo sintético sólo en `/tmp/aroh-closure-qa`; la fixture con sesiones sintéticas queda en `/tmp/aroh-closure-fixture.json` y no debe publicarse. Al terminar, detener Next y ejecutar `docker stop aroh-cierre-qa`. Para Vitest, `npm run test` utiliza la base separada `libro_test` con las migraciones/catálogo locales de `global-setup`.
