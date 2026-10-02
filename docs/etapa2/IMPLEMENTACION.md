# Etapa 2 · propuesta en desarrollo, no habilitada en producción

Base: PR #241 abierto, rama `feat/etapa-1-operacion-conectada`, commit `50fb561eed36586219139f61a6aaa905023ab5a2`. La rama de Etapa 2 es dependiente. Primero se revisa y autoriza humanamente Etapa 1; después se reconcilia/rebasa Etapa 2, se vuelve a ejecutar Compuerta y se autoriza su publicación separadamente. Ningún merge ni despliegue forma parte de esta implementación.

## Uso disponible en la propuesta

- Fronti privado: `Crea una tarea: Revisar filtro de ventilación` registra una instrucción simple completa sin proveedor de IA. `/procedimientos` muestra los adaptadores. Las instrucciones naturales complejas usan el circuito de herramientas existente para preparar el efecto concreto y solicitar autorización.
- Comando técnico exacto: `/ejecutar [{"action":"createTaskAction","fields":{"title":"Revisión sintética","description":"Verificar filtro","priority":"MEDIA","targetType":"PROPIO"}}]`. No usar ejemplos sobre datos reales durante revisión.
- `/estado ID` consulta pasos y resultado propio; `/cancelar ID` cancela sólo los pendientes. Historial privado en `/fronti/procedimientos`. La autorización puntual vence a los 15 minutos. No implica una delegación permanente.
- Reglas y procedimientos: `/coordinacion/automatizaciones`, permiso real `system.configure`. Seleccionar área, responsable, calendario Santiago, plazo, evidencia y lista; guardar en pausa, simular y revisar. No hay presencia inferida del horario.
- Las políticas tienen propietario, versión, caducidad, área, acciones/límites configurados, pausa y revocación. Una tarea generada conserva su copia y clave de ocurrencia. La inspección de procedimientos es independiente del ejecutor. Housekeeping sigue usando sus rutinas, jerarquías y delegaciones nativas.
- Activación futura requiere autorización humana de publicación y `AROH_AUTOMATION_EXECUTION_ENABLED=true` además de habilitar explícitamente cada política. **No establecer esa variable en producción en esta fase**. La ejecución se conecta al cron operativo existente, nunca a GitHub Actions.
- Recuperación: máximo 20 políticas por barrido, 5 ocurrencias por política, 7 días retrospectivos, 25 propuestas por regla desde un recorrido acotado del tablero autorizado. Fallo pausa y conserva intervención; corregir/habilitar genera versión nueva. No repite ocurrencias confirmadas ni crea avalancha histórica.

## Evidencia y límites

`MATRIZ_ACCIONES.md` enumera todos los exports nativos detectados y señala lo pendiente. El catálogo de 59 adaptadores NO equivale a cobertura funcional completa. Las pruebas concretas y resultados CI se registran en el PR. Pasaron 86 pruebas locales en 13 archivos de contrato/calendario/contexto y regresión de Fronti, además de tipos y lint. La compilación normal quedó bloqueada por la descarga de Google Fonts; la compilación de código con Inter existente local como fixture de prueba sí pasó. No se cambió la tipografía de la aplicación. PostgreSQL no está disponible en este contenedor; integración/migraciones se validan en la Compuerta con PostgreSQL 16 desechable, nunca en Neon production.

Pendientes de aceptación: cobertura natural directa más allá de comandos simples; delegaciones generales con condiciones y límites personalizados; formularios binarios/credenciales y procedimientos no conectados; sustituciones basadas en horarios publicados; resúmenes por turno y métricas históricas completas; prueba individual de Caja/llaves/turnos/admin en Fronti; atomicidad revisión/efecto para todos los servicios; recuperación supervisada de resultados inciertos. No publicar mientras estos criterios de alcance no se hayan resuelto o acotado expresamente.

La referencia de Etapa 1 midió algunas actualizaciones visibles en ~30 s. No se considera aceptable: objetivo de CI sintética <=2 s para respuesta completa de comandos sin IA y <=3 s de actualización visible; no hay cifra acreditada todavía para este cambio. Se instrumenta recepción de cabeceras y fin de stream por separado. Safari/iPhone físico continúa pendiente; Chromium con viewport móvil no lo sustituye.

CRON_SECRET no puede acreditarse mediante la conexión de Vercel disponible. No se ha modificado ni leído su valor. Las notificaciones internas y tareas persisten sin push; los comandos exactos y reglas no dependen de IA.

## GitHub y Copilot

Repositorio público por decisión del propietario. Pro y Copilot Pro acreditados por el propietario el 2 de octubre de 2026; no se solicitó nueva prueba. El saldo de 1.500 créditos/0 consumidos es referencia histórica aportada, no saldo leído ahora. Acceso a facturación/saldo no disponible en esta conexión. No se habilita consumo adicional.

Compuerta existente reutilizada: runner estándar ubuntu, PostgreSQL sintético, caché npm, cancelación obsoleta, lint/tipos/migraciones/pruebas/build y navegador. Se añade la base dependiente y retención 7 días. Son capacidades disponibles para repositorios públicos, no beneficios exclusivos de Pro. Protección main conserva PR y check requerido `Regresiones, tipos y build`, 0 aprobadores obligatorios para mantenedor único. No autofusión.

Existen PR de Dependabot; no se mezclan actualizaciones masivas. No se acreditó vía conexión la configuración de CodeQL, secret scanning o push protection; no duplicar configuración sin verificar. Codespaces no es necesario para este bloque. Copilot: instrucciones preparadas, pero no se solicitó ni realizó revisión: la herramienta rechazó la creación del árbol GitHub con «user rejected MCP tool call». No hay rama remota ni PR de esta etapa. No se atribuye trabajo de implementación a Copilot. No se usa Copilot como API de Fronti.

Antes de subir: `vercel.json` conserva `git.deploymentEnabled={"**":false,"main":true}`; los workflows examinados no despliegan ramas. Los despliegues listados eran main/Production. No cambios de visibilidad, hosting o datos reales.

## Reversión

Deshabilitar el interruptor de ejecución y pausar/revocar políticas; cancelar pendientes de Fronti y revisar los RUNNING/INTERVENTION en su origen. Revertir código mediante PR humano, conservar tablas/columnas aditivas, auditoría, planes y tareas generadas. No borrar ocurrencias ni ejecutar migración inversa destructiva. Una tarea ya creada, pago o entrega física requiere corrección por su servicio original; cancelar nunca promete deshacerlo. El código anterior puede coexistir con las columnas nuevas por sus valores predeterminados.

## Bloqueo de entrega remota (2 de octubre de 2026)

La creación de árbol mediante GitHub fue rechazada por la herramienta: `user rejected MCP tool call`. No se eludió el rechazo por otra vía ni se volvió a intentar. Se conserva la rama local, el borrador de PR y la evidencia. Requiere autorización para reintentar esa subida; luego abrir PR dependiente **draft**, ejecutar Compuerta y pedir revisión técnica de Copilot. No se ha consumido una ejecución de Actions o una revisión Copilot mediante este trabajo; saldo global actual no consultable.

Faltan integración PostgreSQL, navegador escritorio/móvil, medición de latencia y cobertura individual. El bloqueo de subida impide usar la Compuerta existente en este punto. No hay servicios o binarios PostgreSQL locales disponibles. El trabajo funcional restante está enumerado arriba y en la matriz; **la Etapa 2 no está terminada**.

## Desarrollo reproducible (sólo sintético)

`docker compose -f compose.test.yml up -d --wait` inicia PostgreSQL 16 sin volumen persistente, ligado únicamente a localhost. Copiar `docs/entorno.example` a `.env` local y usar la base `libro_test`, usuario `libro` y contraseña ficticia `libro_test` del compose. `TEST_DATABASE_URL` apunta a esa base; `DATABASE_URL`/`DIRECT_DATABASE_URL` pueden añadir `application_name=desarrollo` para distinguirlas del valor de prueba. Generar AUTH_SECRET local de prueba, nunca copiar el de producción. Ejecutar `npm ci`, `npm run db:generate` y `npm run verify`. `docker compose -f compose.test.yml down` descarta el entorno sintético. No se ejecutó Docker en este contenedor porque no está instalado.

## Continuación autorizada y PR #244

El propietario autorizó el reintento con «Permitir siempre». Se abrió https://github.com/Ericklhc1/Libroderecepcion/pull/244 como borrador dependiente de #241 y se solicitó revisión Copilot mediante la API (aceptada; sin respuesta todavía). La consulta de Vercel posterior a la subida devolvió cero despliegues nuevos.

Primera Compuerta `37007985785`: migraciones/lint/tipos/audit de dependencias aprobados; 1.367 pruebas aprobadas, 1 omisión previa y 1 fallo nuevo en vinculación de claves de reintento concurrentes. Corregido conservando cada clave de transporte como referencia a su ejecución. Nueva validación pendiente. Se añaden recorridos nativos de Caja, llave, inicio de turno y administración, más navegador de Fronti con presupuesto de 2 s sin proveedor.

`/resumen` ofrece estado dentro del acceso del usuario, fuentes y fechas, con denominador de consulta y aviso de paginación; no sustituye el futuro resumen comparativo por turno. Las políticas pueden editarse desde «Preparar nueva versión»: el guardado compara la versión y queda en pausa sin alterar tareas iniciadas.
