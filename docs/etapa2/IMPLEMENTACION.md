# Etapa 2 · implementación dependiente en desarrollo

PR draft [#244](https://github.com/Ericklhc1/Libroderecepcion/pull/244), base `feat/etapa-1-operacion-conectada` del PR #241, todavía abierto. Versión propuesta 1.47.0. **No publicada ni completa**. No hubo merge, despliegue, migración o modificación operativa en producción ni automatizaciones reales activadas.

## Resultado y evidencia

Fronti incorpora planes privados con 62 adaptadores a acciones originales; políticas y plantillas se guardan en pausa. No se sustituye la aplicación ni se añade un motor paralelo de Housekeeping. La matriz inventaría 212 exports y 60 métodos HTTP, con evidencia y pendientes por acción. Estar conectado no equivale a estar acreditado.

Coordinación ya superó el bloqueo visible en dos recorridos CI consecutivos. En 37017313077, asignar/recibir/resolver a 1280/390 px tardaron 233–942 ms hasta el estado visible; presupuesto 3000 ms. Se reutilizan las mismas acciones nativas por un transporte JSON limitado y navegación de documento después del éxito. Las alternativas anteriores que fallaron se conservan en EVIDENCIA.json. No se atribuye una causa interna exacta de React ni se presentan estos tiempos sintéticos como tiempos de producción.

La CI [37020877716](https://github.com/Ericklhc1/Libroderecepcion/actions/runs/37020877716) aprobó PostgreSQL/migraciones, tipos/lint, 1396 pruebas + una omisión previa, build y recorridos completos a 1280/390 px. Coordinación visible 234–608 ms; Fronti API 140–148 ms y resultado visible del chat 152–182 ms. Plantillas completaron guardado en pausa, simulación sin tareas/avisos, selección de persona/área no disponible preservada, pausa/revocación e historial. Las regresiones verifican revisiones obsoletas dentro de las mutaciones nativas y recuperación del detector anterior ante fallo global. Artefacto 11233256546, vence el 9 de octubre. CI 37021985729 también aprobó abrir el resultado propio desde el enlace de Fronti en ambos anchos: chat visible 141–190 ms, API 138–640 ms y guardado de plantilla 200–210 ms. La compuerta final incorpora además las dos pruebas TSX de renderizado que el patrón anterior omitía, aunque pasaban localmente; resultado actual en el PR. Local 136 pruebas/16 archivos, tipos/lint aprobados (dos advertencias previas).

Los presupuestos son 2000 ms para respuesta completa de comando exacto sin IA y 3000 ms hasta resultado visible. No se amplían esperas para aprobar. Chromium con ancho móvil no acredita Safari/iPhone físico. No hay medición válida todavía de pasos manuales evitados o ahorro frente a Etapa 1.

Última Compuerta completa anterior a delegaciones: [37022894691](https://github.com/Ericklhc1/Libroderecepcion/actions/runs/37022894691), 1398 pruebas aprobadas y una omisión previa. Las delegaciones finitas de este bloque requieren su propia Compuerta; no se atribuye a esa corrida anterior su validación.

## Guía de uso de Fronti

1. En conversación privada, `Crea una tarea: Revisar filtro de ventilación` ejecuta la instrucción simple completa sin proveedor IA. `/procedimientos` enumera acciones conectadas.
2. Las instrucciones naturales complejas siguen el circuito de herramientas existente: preparan efecto concreto y tarjeta de autorización. La ejecución directa general en lenguaje natural sigue pendiente.
3. Comando técnico exacto para una orden completa: `/ejecutar [{"action":"createTaskAction","fields":{"title":"Revisión sintética","description":"Verificar filtro","priority":"MEDIA","targetType":"PROPIO"}}]`. El JSON no acepta identidad ejecutora, rol ni SQL. No probarlo sobre datos reales durante esta revisión.
4. `/estado ID` consulta resultado propio; `/cancelar ID` cancela únicamente pasos pendientes. `/fronti/procedimientos` conserva resultados, fechas, duración real y enlace de origen cuando está disponible. Un paso iniciado puede terminar; cancelar no promete deshacerlo.
5. `/resumen` consulta pendientes dentro del acceso del usuario con responsables, fuentes, fechas, denominador y aviso de lectura parcial. No sustituye aún la comparación completa entre turnos.

Sesión y permisos se resuelven de nuevo en servidor en cada paso. Se conservan servicios, controles y aprobaciones nativos. Una autorización puntual vence a los 15 minutos y no es permanente. Datos de terceros no autorizan acciones; el chat compartido no recibe herramientas ni contexto privado. Fronti registra hechos declarados por la persona y no fabrica conteos, entregas físicas, firmas o una segunda identidad.

Plan/posición y clave de solicitud persistidos evitan repetir éxitos ante reintentos; mensajes equivalentes recientes comparten ejecución. Los pasos de servicios distintos no son una transacción global. Un resultado incierto detiene el resto y requiere revisar el origen; no se reintenta a ciegas. Revisiones de tarea/novedad/configuración se vinculan a la actualización; llaves/garantías se comparan bajo bloqueo de fila. HK/Coordinación/Equipo conservan sus versiones nativas. La acreditación de todas las variantes continúa pendiente.

Administración: editar usuario exige formulario completo y booleanos explícitos. Sustituir permisos exige matriz previa, matriz nueva, aprobaciones y `replacementAcknowledged=REEMPLAZAR_MATRIZ_COMPLETA`; se compara de nuevo dentro de la escritura nativa. Credenciales y entradas binarias aún requieren sus formularios protegidos; el pendiente se identifica por procedimiento, no por exclusión general del módulo.

## Delegación finita de un procedimiento

`/delegar {"objective":"Registrar revisión comunicada","availableAt":"2026-10-02T12:00:00-03:00","expiresAt":"2026-10-03T12:00:00-03:00","steps":[{"action":"createTaskAction","fields":{"title":"Revisar filtro sintético","description":"Revisión solicitada por el usuario","priority":"MEDIA","targetType":"PROPIO"}}]}`

Ejemplo exclusivamente sintético: adaptar las fechas al período autorizado antes de usarlo. El mensaje literal del usuario autoriza **ese objetivo y esas acciones con esos parámetros**, no instrucciones de documentos ni propuestas del modelo. Crear no ejecuta ni programa un cron. `/usar-delegacion ID` completa los pasos pendientes en la sesión autenticada del propietario, sin pedir otra autorización rutinaria. `/revocar-delegacion ID` revoca pendientes, admite reintento y conserva historial. `/estado ID` y `/delegaciones` muestran resultados propios; la página permite revisar parámetros y vigencia en horario de Santiago.

Límites: 1–12 pasos, una ejecución por paso, duración máxima 31 días e inicio dentro de los próximos 31 días. Registros/destinatarios/importes/monedas/cantidades son exactamente los campos autorizados; no hay variables, comodines, incrementos ni nuevas ocurrencias inferidas. Para un importe distinto se requiere otra autorización. Las confirmaciones físicas sólo registran hechos ya declarados, nunca hechos futuros inventados. La delegación no transfiere permisos a otra persona ni permite completar una segunda aprobación con la misma identidad.

Se detiene por revocación/caducidad, sesión/permisos insuficientes, cambio del registro autorizado, incumplimiento del control nativo o resultado incierto/error. Los pasos completados no se repiten, y un paso ya iniciado puede terminar al revocar. No existe compensación genérica. Cambiar un plan existente no está permitido: revocar pendientes y autorizar otro procedimiento. Se usan FrontiExecution/Step/Request y el mismo ejecutor; la migración sólo añade tipo de autorización, inicio de vigencia y objetivo cifrado, sin tablas/motores paralelos.

Este bloque acredita delegaciones **finitas con parámetros exactos**. Permanecen pendientes las delegaciones dinámicas con selección de futuros registros, límites acumulados reutilizables y condiciones personalizadas, así como su activación automática sin sesión. Las recurrencias y reglas operativas siguen en su motor nativo y pausadas durante esta fase.

## Políticas, simulación, pausa y revocación

En `/coordinacion/automatizaciones`, con `system.configure`, definir área, responsable/destinatario, prioridad, calendario Santiago, plazo, evidencia y checklist o condición de escalamiento. Cada regla explica condición y efecto. Distingue sin responsable de asignado sin recibir. Guardar crea una versión pausada y exige versión vigente para editar. Una persona/área actual no disponible permanece seleccionada; no se sustituye silenciosamente por la primera opción.

Simular muestra propuestas sin generar tareas o avisos. Pausar detiene efectos nuevos; revocar conserva historial y trabajo iniciado. Las mismas acciones están conectadas a Fronti: `saveAutomationAction`, `simulateAutomationAction`, `setAutomationStateAction`. La última exige `id`, `version` y `state=pause|enable|revoke`, además de propiedad y permiso reales. El catálogo exige configuración completa para guardar una política.

Las políticas incluyen propietario trazable, área, acciones/límites, caducidad, versión e interrupción por error o pérdida de autoridad. Son autorizaciones limitadas a estas reglas. Las delegaciones finitas de Fronti se describen arriba; las dinámicas con presupuestos acumulados y condiciones personalizadas siguen pendientes. Housekeeping conserva sus delegaciones y jerarquías existentes. Un horario publicado es planificación y nunca prueba presencia física.

Recurrencias: fecha/hora local America/Santiago, rechazo de horas inexistentes en cambio de verano, clave de ocurrencia única, snapshot del trabajo iniciado y recuperación de ocurrencias recientes. Máximos: 20 políticas/25 efectos por barrido, 30 segundos con reserva de 15 para transacciones, 7 días retrospectivos y 5 ocurrencias por política (la pantalla configura una). El cursor avanza por páginas; la simulación advierte alcance parcial. Un fallo pausa la política y registra intervención; corregir/habilitar crea versión nueva sin repetir ocurrencias confirmadas.

Las reglas activas sustituyen sólo su condición/área/tipo/prioridad y rechazan solapamientos. Reutilizan el registro original y sus marcas de escalamiento; no crean incidencias duplicadas. Pausa, caducidad, revocación o pérdida de permiso devuelven ese alcance a los detectores anteriores. Si falla globalmente el nuevo barrido, el cron llama a los detectores sin exclusiones de políticas para no silenciar pendientes. Push e IA no son dependencias de persistencia o reglas.

## Activación futura y secuencia de integración

1. Revisión e integración humana de #241; no la realiza este agente.
2. Reconciliar esta rama sobre la Etapa 1 integrada y repetir Compuerta.
3. Completar pendientes de aceptación y revisar SQL aditivo, configuración cron y dispositivos físicos.
4. Sólo con nueva autorización humana: publicación/migración por el flujo existente, comprobar versión y SHA.
5. Simular cada política y revisar destinatarios, alcance y efectos. Habilitar requiere además `AROH_AUTOMATION_EXECUTION_ENABLED=true`. **No establecer esa variable ni habilitar reglas reales en esta implementación.** El calendario operativo permanece en el cron de la aplicación; GitHub Actions sólo prueba código.

CRON_SECRET no pudo acreditarse con la conexión Vercel disponible. No se afirma que exista o falte, ni se ha leído su valor. Ramas sin despliegue automático: `vercel.json` conserva `git.deploymentEnabled={"**":false,"main":true}`; los workflows no despliegan esta rama. Vercel listó cero despliegues nuevos desde las subidas.

## GitHub y Copilot utilizados realmente

Repositorio público, titularidad, infraestructura y protecciones conservados. Pro/Copilot Pro están acreditados por el propietario; no se pidió prueba adicional. Compuerta reutiliza runner estándar Linux, caché npm, cancelación de runs obsoletos, PostgreSQL desechable, migraciones, dominio/integración, lint/tipos/build, auditoría crítica de dependencias y navegador con artefactos sintéticos de 7 días. Esas capacidades están disponibles para repositorios públicos; no se presentan como exclusivas de Pro. Main exige PR y check `Regresiones, tipos y build`, sin exigir aprobadores inexistentes ni autofusión.

Hay PR de Dependabot; no se mezclaron actualizaciones masivas. CodeQL/secret scanning/push protection no se pudieron acreditar por API: no se infiere ausencia ni se duplica configuración. No se requirieron Codespaces, servicios nuevos o runners de pago.

Dos revisiones reales de Copilot: 5391944473 y 5392864566. La segunda reconoce seis correcciones previas y señala cuatro riesgos nuevos (revisión/escritura, versión omitida, selección no disponible y fallback), atendidos con código y pruebas. Mantiene pendiente cobertura individual. Detalles y evidencia en COPILOT.md. Las correcciones las implementó el agente responsable, no Copilot. No hay capacidad expuesta de agente de programación; no se afirma delegación realizada.

Consumo observado: dos revisiones recibidas; antes de concluir la corrida 37020877716 se observaron 13 corridas Compuerta terminadas (una cancelada), con 72,3 minutos transcurridos acumulados entre inicio y actualización final. Incluye sobrecarga de workflow y no son minutos facturados; no incluye corridas posteriores. saldo/coste en créditos no consultables. 1500 créditos/0 consumidos es la referencia histórica del propietario del 2 de octubre, no un saldo leído ahora ni un número de mensajes. Sin sobrecostes habilitados. La suscripción Copilot no es una API de producción de Fronti.

Límites documentados consultados: Pro permite 40 jobs estándar concurrentes (5 macOS), 6 horas por job, 1 GB de artefactos y 10 GB de caché/repositorio; esta Compuerta usa un job Linux y timeout 30 minutos. Minutos de runners estándar de repositorio público gratuitos. Consumo/espacio vigente de cuenta no consultable. Fuentes oficiales: https://docs.github.com/en/actions/reference/limits ; https://docs.github.com/en/billing/concepts/product-billing/github-actions ; https://docs.github.com/en/billing/concepts/product-billing/github-copilot-billing .

## Desarrollo reproducible y reversión

`docker compose -f compose.test.yml up -d --wait` inicia PostgreSQL 16 desechable en localhost sin volumen persistente. Usar los valores ficticios de compose y `docs/entorno.example`, jamás credenciales de Neon/Vercel. Configurar TEST_DATABASE_URL y generar AUTH_SECRET sintético; ejecutar `npm ci`, `npm run db:generate`, `npm run verify`. `docker compose -f compose.test.yml down` descarta la base. Docker/PostgreSQL no están instalados localmente aquí: integración y migraciones se ejecutan en Actions. Build CI normal pasó; build local anterior usó Inter existente como fixture porque la red bloquea Google Fonts, sin cambiar tipografía de producto.

Reversión futura autorizada: apagar ejecución y pausar/revocar políticas; cancelar pendientes Fronti, revisar RUNNING/INTERVENTION en el origen; revertir selectivamente código mediante PR conservando los controles de validación independiente, privacidad, revisión y caducidad aplicables a registros ya creados. Una versión previa que ignore autorizaciones DELEGATION no es una reversión compatible. Probar esa compatibilidad con datos sintéticos antes de publicar. Conservar tablas/columnas aditivas, planes, auditoría, ocurrencias y tareas. No borrar datos ni ejecutar migración inversa destructiva. Pagos, entregas y efectos completados requieren corrección nativa, no mera cancelación.

## Pendientes que impiden declarar la Etapa 2 completa

Cobertura de todas las acciones/variantes y entrada natural directa; delegaciones dinámicas con límites acumulados y condiciones personalizadas; suplencias configurables con horarios; editor unificado de recurrencias HK; comparación entre turnos; indicadores completos de recepción/atención/resolución/reincidencia/cumplimiento; medición real de pasos evitados; recuperación supervisada de resultados inciertos; acreditación de controles de todos los procedimientos de Caja/llaves/turnos/admin; CRON_SECRET y Safari/iPhone físico. No publicar ni declarar cobertura general basándose en pantallas, adaptadores o pruebas aisladas.
