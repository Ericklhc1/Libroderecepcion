# Equipo y horarios: auditoría F11–F14

Preparación local sobre 1.58.1 y la botonera compacta, sin publicación ni incremento de versión. No migración, dependencia, proveedor, gasto ni cambios sobre personas/mallas reales. Los permisos vigentes se mantienen.

## Resultado

### F11: elegibilidad y resolución explícita

`eligibleScheduleAccountWhere` y `eligibleScheduleCollaboratorWhere(area)` son la única consulta de elegibilidad: cuenta activa, no eliminada, visible y con rol operativo; perfil activo; pertenencia activa en un área activa. Se reutilizan en selección, creación, importación, movimiento/reasignación, validación antes de publicación y cobertura.

Las asignaciones conservan identidad e historial. Las personas que ya no cumplen la regla siguen apareciendo con sus filas guardadas, advertencia y sin nuevas celdas/destinos. Su programación no cuenta para la cobertura. Se puede cancelar o reasignar cada fila futura inválida sin exigir resolver todas simultáneamente; la persona de destino vuelve a validarse dentro de la transacción. Se rechaza también un movimiento fuera del periodo de la malla, tanto en interfaz como en servicio. Los extras y horas históricas conservan su evidencia.

Las bajas/ocultamientos/cambios a rol no operativo y la desactivación del área bloquean si quedan asignaciones vigentes/futuras, incluidos borradores y noches en curso. El operador debe resolver las futuras o esperar el término de las iniciadas. Ver el detalle de transacciones y concurrencia en `AUDITORIA_ADMIN_EQUIPO_2026-10-05.md`.

### F12: contexto y acciones posibles

La página resuelve el área y malla autorizadas antes de renderizar y redirige a una URL canónica cuando faltan. Los tabs y los menús desktop/móvil conservan ambos valores. Cambiar área descarta la malla de la anterior y resuelve la de destino, incluso si no tiene ninguna. El selector refleja el valor renderizado por el servidor; no mantiene una selección distinta tras Back/Forward. Sin JavaScript conserva un formulario GET alternativo.

El calendario abre la semana vigente de Santiago si pertenece a la malla; una malla histórica/futura queda explicada. Cambiar vista conserva el cursor y existe «Ir a hoy». Las fechas pasadas están deshabilitadas antes de abrir un formulario; formularios y arrastre comprueban rango, persona, hora de inicio y horario inexistente por DST. El servicio sigue siendo la autoridad final. No se ha verificado interacción real en navegador local.

### F13: CSV utilizable

La descarga está acotada a área y malla autorizadas; incluye una fila por persona elegible, identificador visible `@usuario`, nombre y campos de asignación en blanco. La ayuda explica completar fecha/código, retirar filas sin uso, horas opcionales, estados sin turno y revisión antes de aplicar. La interfaz también muestra el código de importación heredado.

El importador acepta `@usuario` inequívoco además del código anterior. El nombre completo sólo identifica si es único; homónimos exigen identificador. CSV escapa delimitadores, comillas y literales que podrían evaluarse como fórmulas; la lectura conserva las identidades. Se mantienen las omisiones de filas pasadas y la prohibición de sobrescribir casillas.

### F14: principal, pertenencias y estado global

Administración diferencia área principal, pertenencias y estado global. Equipo muestra el estado real de cuenta/perfil/área y la identificación de homónimos. «Editar referencia global» explica su alcance. No reactiva una pertenencia retirada al editar otro dato.

«Retirar pertenencia» usa el permiso actual `schedule.catalog.manage` y alcance del área. Comprueba versión y programación, registra motivo/auditoría y marca sólo esa relación inactiva. No desactiva la cuenta ni el perfil; no cambia el área principal ni otras pertenencias. La explicación avisa que el área principal u otros permisos pueden conservar acceso operativo. No se añadió una acción nueva de Fronti ni permisos nuevos.

## Verificación y límites

- Conjunto ampliado: 240 pruebas aprobadas en catorce archivos (PostgreSQL sintético y SSR/dominio), incluida identidad CSV, seis estados de inelegibilidad, rollback, retiro parcial, revisión/alcance, concurrencia administrativa y navegación; añade regresiones de Fronti y navegación compartida.
- Lint focal, análisis sintáctico TS y `git diff --check` verificados sobre los archivos modificados. El análisis sintáctico no equivale a una aprobación de tipos.
- `scripts/ui/schedule-audit-e2e.mjs` preparado para la Compuerta existente y fixture `/tmp/etapa1-fixture.json`: 1280/390, URL/selector/datos, tabs/lateral, Back/Forward, cambio de malla, área vacía, semana vigente, controles retroactivos y CSV. Sólo escribe fixtures sintéticas bajo la guarda local de CI; el recorrido de navegador no envía mutaciones. Análisis sintáctico aprobado, ejecución pendiente.
- Integración sugerida: después de preparar la fixture de Etapa 1 y con Next iniciado, ejecutar `PLAYWRIGHT_MODULE="$PWD/node_modules/playwright-core/index.mjs" node scripts/ui/schedule-audit-e2e.mjs`. No se modificó el workflow compartido.
- No se ejecutaron tipos/build globales por el límite de memoria del ejecutor. Requiere Compuerta y navegador sobre el SHA integrado antes de publicar; no acreditar esta preparación como despliegue.

## Conciliación con notificaciones de tareas

La integración de avisos por tareas sin responsable volvió obsoletos siete conteos absolutos de `substitution-future-handoff.test.ts`: ya existía un aviso previo para el coordinador. La rama Equipo conservaba 37/37 pruebas antes de corregir la fixture. Ahora se fotografían los avisos iniciales, se exige que sus IDs y contenido permanezcan iguales y se valida un incremento exacto de cero o uno por la suplencia. Un caso adicional parte de un aviso explícito anterior y comprueba espera, aplicación y reintento. No se modificó el motor de suplencias, su habilitación ni permisos.
