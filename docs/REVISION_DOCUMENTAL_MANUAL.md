# Preparación documental manual de Supervisión

## Alcance de este primer bloque

`/supervision/documentos` permite preparar una revisión local de PDF, XLSX sin macros, CSV y TSV. El enlace aparece en Supervisión para cuentas con `supervision.audit.create`; la página exige además `supervision.center.view`. No se agregan roles ni permisos.

El documento no sale del navegador. El original se mantiene como `File` en memoria, se puede descargar sin transformarlo y se identifica con SHA-256. El PDF se dibuja en un canvas de PDF.js, sin enlaces, acciones ni formularios. XLSX/CSV/TSV se muestran como celdas con su dirección real; esa vista no pretende reproducir diseño, gráficos o formato visual de Excel. Para estos detalles hay que conservar y abrir el original con una aplicación adecuada.

La identidad del borrador incluye usuario, área de su cuenta, versión de lector y SHA-256. Abrir otra vez los mismos bytes en la misma sesión selecciona el borrador existente y conserva sus correcciones e historial, aunque cambie el nombre del archivo. Un fallo al abrir otro archivo no modifica lo ya preparado.

### No es un expediente central ni una aprobación operativa

Las decisiones se llaman **borrador local**, **aprobación propuesta (local)** y **devolución propuesta (local)**. No se registran en base de datos, no se comparten con otro usuario y no modifican auditoría diaria, registros, dinero, horarios ni turnos. No hay correos ni otras comunicaciones automáticas. El importador existente de auditoría diaria conserva su flujo y persistencia anteriores.

Toda la sesión se pierde al salir, recargar o cerrar. La pantalla lo advierte y añade el aviso de descarga del navegador al abandonar el documento. La navegación interna de Next puede desmontar la pantalla sin ese aviso nativo: **el aviso visible y la exportación previa son obligatorios para conservar el trabajo**. No se usa localStorage, sessionStorage, IndexedDB ni almacenamiento remoto para esconder esta limitación.

Se puede descargar un JSON con evidencia, huella, alcance e historial de versiones y, por separado, el original. El JSON es una entrega local no autenticada: no es autorización, firma ni auditoría inalterable. No se importa automáticamente al sistema. La descarga solicitada tampoco prueba que el usuario haya conservado el archivo.

## Lectura y revisión

- Se reutiliza el parser CSV/TSV canónico, extraído a `domain/delimited-report.ts`. Su comportamiento por defecto permanece; el flujo local activa límites, comillas estrictas y conservación de filas vacías/coordenadas.
- PDF usa la dependencia PDF.js existente para texto y coordenadas; XLSX usa ExcelJS existente en un worker. No se incorpora otro proveedor o dependencia.
- Texto de origen y transcripciones humanas están identificados. Los escaneos se pueden mirar y transcribir manualmente con número de página; no se activa OCR ni visión remota.
- El revisor selecciona cada dato y su tipo. No se transforma texto en una operación confirmada. Las interpretaciones tienen un campo separado y las correcciones requieren motivo para proponer aprobación.
- Importes requieren moneda y notación explícitas. Signos y paréntesis se conservan, se rechazan monedas incoherentes y se suma por moneda en unidades menores enteras (`BigInt`). La suma de valores seleccionados no demuestra conciliación y puede contener total y detalle si el humano los selecciona.
- Fechas requieren formato explícito y validación de día/mes/año reales; son fechas calendario, no horas.
- Una propuesta de aprobación exige datos válidos, evidencia, cotejo declarado del original y ausencia de dudas consignadas. Una devolución propuesta exige motivo. Cada cambio añade una versión local sin reescribir las anteriores; los clics idénticos consecutivos se coalescan.

## Límites y contenido no confiable

Máximo 4 MB por archivo, 5 archivos/16 MB por sesión, 40 páginas, 2.000 filas/100 columnas por hoja, 40.000 celdas o fragmentos, 400.000 caracteres y 100 datos por revisión. El historial admite 100 versiones por documento. El lector dispone de tiempo máximo y los workers se terminan al cancelar/salir.

XLSX exige cabeceras central/local ZIP coherentes, entradas únicas/rutas acotadas, ausencia de cifrado, ZIP64, macros, ActiveX, objetos embebidos y vínculos a libros externos; máximo 500 entradas, 16 MB expandidos y relación 100:1. Antes de ExcelJS se verifica el tamaño realmente descomprimido por streaming y se rechazan entidades/DOCTYPE XML o tipos activos. Si el navegador no admite validación `deflate-raw`, se rechaza el XLSX y se ofrece CSV/TSV. Las fórmulas se muestran como texto y no se acredita su resultado cacheado; los enlaces no se abren.

Esto no es un antivirus ni una cuarentena persistente. El límite del PDF cubre bytes, páginas, texto, imágenes/renderizado y tiempo, pero no constituye una garantía absoluta de memoria del decodificador ante un PDF hostil. Los workers aíslan el trabajo de lectura y permiten interrumpirlo; no son un nuevo servidor ni una certificación de seguridad del archivo. No se ejecutan instrucciones contenidas en los documentos.

## Capacidades deliberadamente cerradas

`MANUAL_DOCUMENT_CAPABILITIES` mantiene en falso almacenamiento remoto del original, persistencia compartida, inferencia documental Fronti y visión de escaneos. No hay endpoint de subida ni llamadas IA. El adaptador de texto de Fronti falla antes de producir un envío; prepara separación entre evidencia no confiable e instrucciones del sistema, sin herramientas de acción. No altera la cadena actual de modelos de Fronti.

Abrir un archivo manualmente no prueba que una subida o IA futura sea gratis. La capacidad/cuota real de R2, Neon y proveedores de IA no está acreditada para ese uso nuevo. Este bloque no contrata servicios, no abre acceso persistente y no modifica variables o credenciales. La operación ordinaria de cargar la página sigue usando la infraestructura existente; no se certifica un coste total de la aplicación igual a cero.

## Contrato para una futura persistencia autorizada

Antes de activar expediente compartido o Fronti documental se necesita una implementación revisada, no sólo una variable de entorno:

1. Acreditar capacidad/cuotas reales y límites duros sin gasto adicional, y obtener cualquier autorización de almacenamiento/datos que corresponda.
2. Revalidar identidad, sesión, permisos de Supervisión y alcance en servidor. Nunca confiar en el actor, hash, decision o scope del JSON descargado.
3. Recibir y recalcular SHA-256 del original bajo un flujo autorizado; conservarlo privado y versionado. Fallar cerrado si no puede conservarse el original o si falla la cuota.
4. Crear identidad idempotente por usuario/ámbito/hash/versión, versiones inmutables, evidencia con archivo/página/celda y control optimista/concurrente. Escribir decisión e historial de forma atómica; un fallo de metadatos no puede borrar versiones anteriores.
5. Mantener texto extraído, interpretación asistida y decisión humana como objetos distintos. El humano corrige/aprueba/devuelve; ninguna aprobación documental debe publicar registros, dinero o turnos por efecto lateral.
6. El guard de presupuesto debe preceder cada lectura/inferencia remota, evitar reintentos con proveedores pagados y dejar revisión manual disponible cuando no haya capacidad. Visión permanece separada de texto.
7. Probar migraciones aditivas y compatibilidad del importador vigente en PostgreSQL efímero, más permisos, concurrencia, idempotencia, pérdida de cuota y recuperación de errores. No aplicar migraciones a producción desde este trabajo.

## Verificación local

- Lint y comprobación TypeScript focal de los módulos nuevos: aprobados.
- ` /tmp/aroh-audit-test.sh documents npx vitest run tests/manual-documents.test.ts tests/pms-formatos-flexibles.test.ts tests/schedule-import-domain.test.ts tests/supervision-audit-import.test.ts `: 62 pruebas aprobadas en PostgreSQL efímero de loopback, con datos sintéticos.
- `scripts/ui/manual-documents-browser.mjs` reutiliza el Next ya compilado y la fixture sintética de CI de `scripts/etapa1`, con Chromium autorizado y bloqueo de salidas/mutaciones HTTP. Se ejecuta como `PLAYWRIGHT_MODULE="$PWD/node_modules/playwright-core/index.mjs" node scripts/ui/manual-documents-browser.mjs`, con el servidor y las variables de loopback/CI del recorrido existente. No levanta otro bundler ni crea DB/sesiones. Su resultado de navegador sigue pendiente. Los intentos aislados previos finalizaron durante compilación webpack; Turbopack diagnosticó un symlink de dependencias fuera de la raíz del arnés. No representan aprobación de navegador.
- Build, tipos globales, regresión integral y QA autenticado del conjunto corresponden a la integración/Compuerta. No se han publicado ni desplegado estos cambios.
