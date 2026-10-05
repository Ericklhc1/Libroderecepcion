# Auditoría operativa: entrega correctiva y activación posterior

Estado: candidato en preparación; no constituye publicación ni certificación multirol en el hotel.
Base publicada revisada: 1.58.1, árbol `456a61465ddf8f917c74e61ce59306dd65f5b926`.

## Bloques de corrección

- F01/F03/F08–F10: resultados y períodos canónicos, contadores completos separados de muestras, evidencia gerencial accesible sin ampliar permisos, cifras firmadas y explicación determinista sin una llamada IA automática al abrir Gerencia. `resolvedAt` es aditivo; el historial sin fecha conserva un fallback explícito, no una fecha inventada.
- F02/F04–F07/F17: guardas del asunto coordinadas con trabajo nativo, visibilidad tras HK terminal, solicitud sin responsable, asignación compatible con la ruta del destinatario, devolución del resultado y avisos a participantes autorizados. Una acción sobre el objeto fuente sigue siendo distinta de una lectura o aviso.
- F11–F14: elegibilidad única, cobertura y cambios administrativos seguros, área/malla/selector/URL consistentes, CSV utilizable y pertenencias diferenciadas del estado global. No se cambiaron cuentas ni roles reales.
- F15: cantidades y notas no guardadas se conservan sólo en la pestaña por usuario/entrega/rol, con vencimiento de recuperación de 12 horas; nunca se restauran confirmaciones físicas no enviadas. Se reconstruyen datos guardados y se advierte si cambió la revisión. Logout/cambio de usuario/cierre de entrega limpian sólo estos borradores. Una falta de sessionStorage se informa.
- F16: Caja del relevo usa el mismo formateador America/Santiago que Caja e historial; los cambios JSON anidados son legibles.
- F18: navegación compacta y paleta acuarela/azul oscuro conservan destinos, consultas, anclas y permisos. Los recorridos de teclado, cuatro tamaños y ambos temas deben aprobar sobre el árbol integrado.

## Propuestas y condiciones de activación

1. Distribución de un asunto a áreas: preparación del modelo y lectores plurales, con escritura de distribución apagada por defecto. Conocimiento, publicación, asignación, aclaración y resultado permanecen separados. No habilitar hasta disponer de un artefacto de recuperación compatible verificado.
2. Importancia y urgencia: se preparan por separado. La persona de guardia debe ser seleccionada entre personas realmente habilitadas, sin suponer presencia por una malla. Las guardas de custodia continúan y ofrecen una salida concreta. No inventar nuevos plazos. La revisión/escalamiento pendientes deben explicitarse antes de activar.
3. Documentos: revisión manual local bajo capacidades acreditadas. Original visible y evidencia estructurada, sin llamadas IA ni subida a R2 habilitadas por defecto. Un borrador/exportación local no equivale a aprobación persistida por Supervisión. La activación de almacenamiento o IA requiere acreditar capacidad y costo cero.
4. Cambios desde el último turno: consulta determinista del último fin real de participación o cierre de Supervisión de la cuenta; responsables, resultados, pendientes, fuentes y totales paginados. No convierte el horario programado en asistencia ni amplía lectura de fuentes reservadas.

## Recuperación y protección de datos

La primera entrega mantiene físicamente el índice único global `HousekeepingRequest_sourceEntryId_key`. El lector plural puede prepararse sin retirar esa barrera. El código y el índice impiden multiplicidad mientras conviven escritores anteriores. Eliminar el índice exige otra migración revisada, posterior a un fallback compatible publicado/verificado.

La suite de recuperación debe comprobar: escritor previo con esquema ampliado, fechas históricas nulas, negativa a nuevas distribuciones en modo apagado, y lectura autorizada de todas las intervenciones sobre una fixture que simula la futura multiplicidad. Esa fixture puede retirar temporalmente el índice sólo en PostgreSQL desechable y debe restaurarlo después. Nunca borrar tablas, cerrar obligaciones ni reescribir historia para hacer compatible una reversión.

Se conserva el mantenimiento existente. La conciliación de pruebas operativas y la reapertura del hotel son decisiones aparte; el candidato no las realiza.

## Cero gasto adicional

Sin proveedor, cuenta, bucket, dominio, clave, plan ni conexión de correo nuevos. Los avisos añadidos son explícitamente internos y no se encolan como correo, aunque una política previa de notificaciones tenga correo obligatorio. Se conserva el comportamiento externo de eventos anteriores no afectados.

La rama no despliega previews. CI usa el repositorio público y la configuración existente, con caché/artefactos adicionales desactivados para esta rama. Antes de una publicación única se debe verificar el límite máximo y precio de la máquina existente frente al crédito vigente; no modificar el plan, la máquina o controles globales de gasto.

## Verificación

Las pruebas focales por bloque no se suman como una suite completa, pues pueden solaparse. Antes de considerar la entrega lista: lint, tipos, suite PostgreSQL, build, navegador integrado y recuperación del mismo SHA. Los fallos de fixtures o de integración se corrigen y se repiten; no se omiten para obtener una compuerta verde.

Recorridos añadidos:
- `scripts/ui/audit-cash-drafts-e2e.mjs`: borrador, retorno, guardado, confirmaciones físicas, cambio de revisión, nota y logout, 1280/390.
- `scripts/ui/schedule-audit-e2e.mjs`: URL, área, malla, historial de navegación, fechas y CSV, 1280/390.
- `scripts/ui/compact-navigation-isolated.mjs`: componentes reales, teclado, tema claro/oscuro y tamaños 1280/1024/390/320; complementa el recorrido integrado.

## Trabajo posterior conservado

Las devoluciones/aplicaciones parciales sucesivas de garantías requieren saldo acumulado, movimientos y lectores coherentes. No quedan resueltas por esta entrega ni deben confundirse con la devolución rápida de todo el saldo. No se introducen políticas de multas o bajas de inventario ni se mueve dinero real.
