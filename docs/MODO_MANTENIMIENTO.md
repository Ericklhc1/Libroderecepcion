# Mantenimiento temporal de AROH

## Alcance

Control de disponibilidad de la aplicación. No cambia usuarios, roles, permisos, credenciales, sesiones, turnos ni registros hoteleros. Reutiliza `SystemSetting` con la clave formal `system.maintenance`, administrada exclusivamente por la pantalla `/admin/mantenimiento`. No se agrega al editor genérico de parámetros ni al catálogo de Fronti. La activación/desactivación y su auditoría se confirman en la misma transacción, con revisión optimista y lock por clave.

Mensaje: **Trabajos de mantenimiento programados por actualizaciones importantes.**

Sólo una sesión vigente cuyo rol actual es `SYSTEM_ADMIN` conserva acceso y puede administrar este control. No se identifica al administrador por texto de usuario, parámetros del cliente, headers o cookies sin verificar. Login/logout siguen disponibles. La sesión conserva sus comprobaciones habituales de expiración/revocación y primer acceso.

La consola conserva `/admin/mantenimiento`, pero vive fuera del layout operativo. Un comunicado obligatorio pendiente o un tutorial no puede tapar la recuperación ni obligar a registrar acuses o completar recorridos para desactivar el mantenimiento. Se conservan todas las comprobaciones de sesión, rol, contraseña personal y términos.

## Comportamiento

- Estado ausente: operación disponible. Estado persistido inválido: operación pausada hasta reparación desde la consola. Fallo de lectura: operaciones API/acciones y tareas automáticas se detienen; no hay fallback que reabra silenciosamente.
- API: 503, `Cache-Control: no-store`, `Retry-After: 60`, código `MAINTENANCE`. Se controlan todos los métodos, incluidos GET con efectos. La versión y la disponibilidad pública son las únicas excepciones API de lectura.
- Server Actions: validación central en autenticación operativa. Las acciones especiales de instalación y diagnóstico también están cubiertas. La página pública `/mantenimiento` muestra el mensaje; el formulario de login mantiene acceso administrativo.
- Páginas: control tanto por layout como por guard de página, antes de primer acceso o carga operativa. Clientes compatibles ya abiertos consultan disponibilidad cada 30 segundos y al recuperar foco; la protección real está en servidor.
- Los cuatro cron conservan su autenticación y responden `200 {ok:true, skipped:"maintenance"}` sin iniciar trabajo. Los callbacks diferidos vuelven a comprobar el estado al ejecutarse. Los servicios de alertas, push, correo y Fronti proactivo se detienen antes de iniciar trabajo; push/correo y barridos largos comprueban también entre unidades. Los pendientes no se marcan enviados ni se borran por mantenimiento.
- No hay expiración ni reapertura automática. Sólo la acción explícita de desactivación reabre; esto evita que una actualización incompleta se abra por vencimiento de un temporizador.
- Sin migración, nuevos servicios, variables/secretos, paquetes ni planes de pago.

## Límites que deben comunicarse

Esto bloquea solicitudes nuevas que llegan a un **artefacto compatible**. No revierte ni cancela una transacción o envío que ya pasó su comprobación. Una unidad de Fronti ya reclamada completa su resultado para no consumir el cooldown y perder el aviso; el siguiente candidato no comienza. Los procesos de cron tienen `maxDuration` de hasta 120 segundos, pero eso no demuestra por sí solo que todas las solicitudes hayan drenado.

Un despliegue anterior sin este código, una URL antigua o un cliente dirigido por Vercel Skew Protection al artefacto antiguo **ignora el control compartido**. La bandera en Neon no puede proteger código que no la lee. No afirmar congelación total, garantía global de cero escrituras ni mantenimiento comprobado de toda la plataforma sin verificar esas vías. Este cambio no modifica Skew Protection, protección de despliegues, cuentas, permisos ni seguridad de Vercel/Neon.

## Publicación y activación deliberadas

1. Aprobar lint, tipos, pruebas PostgreSQL desechable, build y recorridos en CI del SHA exacto. Revisar que el hotfix desciende de 928f57b y contiene únicamente este control. Publicar como 1.57.1 por el procedimiento autorizado, sin incorporar 1.58 todavía.
2. Verificar el dominio de producción con `/api/health/version`: SHA y versión esperados, `maintenanceControl: "v1"`. `/api/maintenance` debe estar disponible y devolver `enabled:false` antes de activación.
3. Entrar con SysAdmin mediante el flujo seguro habitual. Abrir Administración → Modo mantenimiento. Confirmar que se muestran el estado, mensaje y control de recuperación. No probar escrituras hoteleras reales ni realizar cambios en usuarios/roles.
4. Coordinar con el equipo que guarde su trabajo, cierre acciones pendientes y recargue/cierre pestañas antiguas. Esta coordinación requiere la autorización de comunicación correspondiente. Identificar aliases/URLs antiguas y Skew con lectura de configuración; no cambiar protecciones de manera implícita.
5. Activar desde el formulario con su confirmación explícita. Verificar auditoría `SystemMaintenance` y `enabled:true` leyendo nuevamente la consola. En sesión sin privilegios comprobar el mensaje; en peticiones nuevas contra el artefacto compatible comprobar 503 sin ejecutar acciones hoteleras. SysAdmin debe poder volver al control.
6. Comprobar que los cron autorizados se omiten y no se inician nuevos trabajos. Dar margen para solicitudes existentes y revisar evidencia de drenaje. No basta esperar un número fijo de segundos si aún hay trabajo activo o rutas antiguas posibles. Si no puede acreditarse el límite requerido, detener la promoción y comunicar exactamente la incertidumbre.

## Promoción compatible a 1.58

Incorporar **el mismo cambio funcional** a la rama 1.58, conservando su versión y cambios aprobados. La candidata 1.58 anterior a este parche no obedece mantenimiento y no debe promoverse con la expectativa de conservarlo. Repetir CI del SHA final y verificar `maintenanceControl:"v1"` antes de cambiar el alias.

La fila compartida mantiene `enabled:true` durante la promoción; no hay valores de entorno ni estado local que se pierdan. No activar desde una candidata que comparte producción pensando que es una prueba aislada. Después de promover, comprobar SHA/versión, pantalla pública, 503 para tráfico compatible ordinario y acceso administrativo. No reabrir hasta que la verificación y la autorización de reapertura estén resueltas.

## Desactivación y reversión

SysAdmin → Administración → Modo mantenimiento → confirmar actualización terminada → **Desactivar mantenimiento y reabrir**. Leer de nuevo la consola y `/api/maintenance`; comprobar que la siguiente solicitud de usuario vuelve al flujo normal. Los trabajos pendientes reanudan sus políticas previas; no hay cambios masivos de estados ni envío manual de colas.

Conservar el artefacto **1.57.1 con control** como destino de rollback compatible: seguirá obedeciendo la misma fila activa. Revertir directamente a 928f57b/1.57.0 o a la 1.58 sin control **reabre de hecho el sistema**, aunque la fila diga activo. Debe ser una decisión explícita, nunca una recuperación silenciosa. Si Neon no está disponible, restaurar conectividad normal antes de desactivar; no cambiar políticas de seguridad ni borrar la fila para eludir el bloqueo.
