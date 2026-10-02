# Etapa 2 · implementación dependiente en desarrollo

PR draft [#244](https://github.com/Ericklhc1/Libroderecepcion/pull/244), base `feat/etapa-1-operacion-conectada` del PR #241, todavía abierto. Versión propuesta 1.47.0. **No publicada ni completa**. No hubo merge, despliegue, migración o modificación operativa en producción ni automatizaciones reales activadas.

## Resultado y evidencia

Fronti incorpora planes privados con 62 adaptadores a acciones originales; políticas y plantillas se guardan en pausa. No se sustituye la aplicación ni se añade un motor paralelo de Housekeeping. La matriz inventaría 212 exports y 60 métodos HTTP, con evidencia y pendientes por acción. Estar conectado no equivale a estar acreditado.

Coordinación ya superó el bloqueo visible en dos recorridos CI consecutivos. En 37017313077, asignar/recibir/resolver a 1280/390 px tardaron 233–942 ms hasta el estado visible; presupuesto 3000 ms. Se reutilizan las mismas acciones nativas por un transporte JSON limitado y navegación de documento después del éxito. Las alternativas anteriores que fallaron se conservan en EVIDENCIA.json. No se atribuye una causa interna exacta de React ni se presentan estos tiempos sintéticos como tiempos de producción.

Última CI terminada al preparar este documento: [37019633610](https://github.com/Ericklhc1/Libroderecepcion/actions/runs/37019633610), migraciones PostgreSQL 16, tipos/lint, 1396 pruebas + una omisión preexistente y build aprobados. Las regresiones nuevas verifican los cambios de concurrencia/recuperación y políticas de Fronti. Coordinación pasó en ambos anchos; Fronti API escritorio 125 ms y resultado visible del chat 142 ms. Guardar plantilla en pausa y simular sin efectos pasó, pero falló abrir su editor mediante navegación cliente. Se reemplaza sólo ese enlace por navegación de documento con URL explícita para recuperar estado/opciones vigentes. Resultado del recorrido completo posterior en el PR; no anticipar su aprobación. Local: 134 pruebas en 15 archivos, tipos/lint aprobados (dos advertencias previas).

Los presupuestos son 2000 ms para respuesta completa de comando exacto sin IA y 3000 ms hasta resultado visible. No se amplían esperas para aprobar. Chromium con ancho móvil no acredita Safari/iPhone físico. No hay medición válida todavía de pasos manuales evitados o ahorro frente a Etapa 1.

## Guía de uso de Fronti

1. En conversación privada, `Crea una tarea: Revisar filtro de ventilación` ejecuta la instrucción simple completa sin proveedor IA. `/procedimientos` enumera acciones conectadas.
2. Las instrucciones naturales complejas siguen el circuito de herramientas existente: preparan efecto concreto y tarjeta de autorización. La ejecución directa general en lenguaje natural sigue pendiente.
3. Comando técnico exacto para una orden completa: `/ejecutar [{"action":"createTaskAction","fields":{"title":"Revisión sintética","description":"Verificar filtro","priority":"MEDIA","targetType":"PROPIO"}}]`. El JSON no acepta identidad ejecutora, rol ni SQL. No probarlo sobre datos reales durante esta revisión.
4. `/estado ID` consulta resultado propio; `/cancelar ID` cancela únicamente pasos pendientes. `/fronti/procedimientos` conserva resultados, fechas, duración real y enlace de origen cuando está disponible. Un paso iniciado puede terminar; cancelar no promete deshacerlo.
5. `/resumen` consulta pendientes dentro del acceso del usuario con responsables, fuentes, fechas, denominador y aviso de lectura parcial. No sustituye aún la comparación completa entre turnos.

Sesión y permisos se resuelven de nuevo en servidor en cada paso. Se conservan servicios, controles y aprobaciones nativos. Una autorización puntual vence a los 15 minutos y no es permanente. Datos de terceros no autorizan acciones; el chat compartido no recibe herramientas ni contexto privado. Fronti registra hechos declarados por la persona y no fabrica conteos, entregas físicas, firmas o una segunda identidad.

Plan/posición y clave de solicitud persistidos evitan repetir éxitos ante reintentos; mensajes equivalentes recientes comparten ejecución. Los pasos de servicios distintos no son una transacción global. Un resultado incierto detiene el resto y requiere revisar el origen; no se reintenta a ciegas. Revisiones de tarea/novedad/configuración se vinculan a la actualización; llaves/garantías se comparan bajo bloqueo de fila. HK/Coordinación/Equipo conservan sus versiones nativas. La acreditación de todas las variantes continúa pendiente.

Administración: editar usuario exige formulario completo y booleanos explícitos. Sustituir permisos exige matriz previa, matriz nueva, aprobaciones y `replacementAcknowledged=REEMPLAZAR_MATRIZ_COMPLETA`; se compara de nuevo dentro de la escritura nativa. Credenciales y entradas binarias aún requieren sus formularios protegidos; el pendiente se identifica por procedimiento, no por exclusión general del módulo.

## Políticas, simulación, pausa y revocación

En `/coordinacion/automatizaciones`, con `system.configure`, definir área, responsable/destinatario, prioridad, calendario Santiago, plazo, evidencia y checklist o condición de escalamiento. Cada regla explica condición y efecto. Distingue sin responsable de asignado sin recibir. Guardar crea una versión pausada y exige versión vigente para editar. Una persona/área actual no disponible permanece seleccionada; no se sustituye silenciosamente por la primera opción.

Simular muestra propuestas sin generar tareas o avisos. Pausar detiene efectos nuevos; revocar conserva historial y trabajo iniciado. Las mismas acciones están conectadas a Fronti: `saveAutomationAction`, `simulateAutomationAction`, `setAutomationStateAction`. La última exige `id`, `version` y `state=pause|enable|revoke`, además de propiedad y permiso reales. El catálogo exige configuración completa para guardar una política.

Las políticas incluyen propietario trazable, área, acciones/límites, caducidad, versión e interrupción por error o pérdida de autoridad. Son delegaciones limitadas a estas reglas; **las delegaciones generales con objetivos, importes, cantidades y condiciones personalizados aún no están implementadas**. Housekeeping conserva sus delegaciones y jerarquías existentes. Un horario publicado es planificación y nunca prueba presencia física.

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

Consumo observado: dos revisiones recibidas; saldo/coste en créditos no consultables. 1500 créditos/0 consumidos es la referencia histórica del propietario del 2 de octubre, no un saldo leído ahora ni un número de mensajes. Sin sobrecostes habilitados. La suscripción Copilot no es una API de producción de Fronti.

Límites documentados consultados: Pro permite 40 jobs estándar concurrentes (5 macOS), 6 horas por job, 1 GB de artefactos y 10 GB de caché/repositorio; esta Compuerta usa un job Linux y timeout 30 minutos. Minutos de runners estándar de repositorio público gratuitos. Consumo/espacio vigente de cuenta no consultable. Fuentes oficiales: https://docs.github.com/en/actions/reference/limits ; https://docs.github.com/en/billing/concepts/product-billing/github-actions ; https://docs.github.com/en/billing/concepts/product-billing/github-copilot-billing .

## Desarrollo reproducible y reversión

`docker compose -f compose.test.yml up -d --wait` inicia PostgreSQL 16 desechable en localhost sin volumen persistente. Usar los valores ficticios de compose y `docs/entorno.example`, jamás credenciales de Neon/Vercel. Configurar TEST_DATABASE_URL y generar AUTH_SECRET sintético; ejecutar `npm ci`, `npm run db:generate`, `npm run verify`. `docker compose -f compose.test.yml down` descarta la base. Docker/PostgreSQL no están instalados localmente aquí: integración y migraciones se ejecutan en Actions. Build CI normal pasó; build local anterior usó Inter existente como fixture porque la red bloquea Google Fonts, sin cambiar tipografía de producto.

Reversión futura autorizada: apagar ejecución y pausar/revocar políticas; cancelar pendientes Fronti, revisar RUNNING/INTERVENTION en el origen; revertir código mediante PR. Conservar tablas/columnas aditivas, planes, auditoría, ocurrencias y tareas. No borrar datos ni ejecutar migración inversa destructiva. Pagos, entregas y efectos completados requieren corrección nativa, no mera cancelación.

## Pendientes que impiden declarar la Etapa 2 completa

Cobertura de todas las acciones/variantes y entrada natural directa; delegaciones generales; suplencias configurables con horarios; editor unificado de recurrencias HK; comparación entre turnos; indicadores completos de recepción/atención/resolución/reincidencia/cumplimiento; medición real de pasos evitados; recuperación supervisada de resultados inciertos; acreditación de controles de todos los procedimientos de Caja/llaves/turnos/admin; CRON_SECRET y Safari/iPhone físico. No publicar ni declarar cobertura general basándose en pantallas, adaptadores o pruebas aisladas.
