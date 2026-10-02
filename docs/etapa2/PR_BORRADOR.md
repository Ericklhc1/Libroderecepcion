# Etapa 2 · procedimientos privados de Fronti y automatización en pausa (1.47.0)

**Destino:** `feat/etapa-1-operacion-conectada` · **Origen:** `feat/etapa-2-fronti-automatizacion` · **Estado previsto:** draft. Dependiente de #241, sin fusionarla. Actualmente sólo local: la herramienta rechazó la subida GitHub.

El seguimiento manual necesita instrucciones trazables, recepción explícita y continuidad que no dependan del proveedor de IA o push. Este bloque incorpora planes privados de Fronti que llaman las Server Actions originales, renuevan permisos por paso y registran reclamaciones/resultados para no repetir efectos confirmados. Las reglas y plantillas se guardan en pausa y generan tareas mediante el servicio existente, con ocurrencias únicas, límites de recuperación, Santiago y validación independiente.

- 59 adaptadores conectados; matriz inventaría 210 acciones y **no acredita cobertura general**. Propuestas IA siguen requiriendo autorización; comandos exactos y órdenes simples se ejecutan directamente. Pendientes: cobertura natural completa, procedimientos restantes, delegaciones generales, suplencias, resúmenes e indicadores completos.
- Privacidad: herramientas operativas y confirmaciones quedan en Fronti privado; no se aporta contexto privado del invocador al modelo de un chat compartido.
- Migración aditiva `20261002120000_fronti_operational_execution`, pendiente de probar en PostgreSQL desechable. Ninguna aplicación en Neon production.
- Compuerta existente ampliada a la base dependiente, sin trabajos duplicados, retención 7 días. Protección de main y desactivación de previews conservadas. No consumo adicional ni servicios nuevos.

Validación local: 86 pruebas/13 archivos sin PostgreSQL, tipos y lint aprobados. Build de código con fuente Inter local de prueba aprobado; descarga normal de Google Fonts bloqueada por la red. PostgreSQL, navegador y latencia pendientes. La demora ~30 s no se da por resuelta; se separa medición de cabeceras, fin de stream y actualización visible.

Copilot aún no revisó: solicitar una revisión centrada en revocación, privacidad, concurrencia, validaciones independientes, efectos parciales y recurrencias cuando se autorice la subida. Nunca acceso a producción. No habilitar consumo de pago.

Antes de publicar: integrar Etapa 1 mediante autorización humana; reconciliar ramas concurrentes; completar alcance y pruebas; acreditar CRON_SECRET; validar Safari/iPhone físico; migración y publicación requieren autorización separada. La política de ejecución automática permanece apagada.

Reversión: pausar/revocar políticas y cancelar pendientes; revertir código mediante PR conservando migración aditiva, tareas, ocurrencias y auditoría. No prometer deshacer pagos o entregas ya realizadas.
