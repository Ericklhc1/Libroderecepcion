# Estabilización operativa posterior a Observabilidad P2

Fecha: 26/09/2026  
Versión objetivo: **v1.14.1**  
Base: **v1.14.0 / 58d1a4c398e979fc9a3b07233f20127234907e16**

## Objetivo

Validar el Libro como sistema transversal después de P0–P2, buscando
especialmente calles sin salida entre módulos, fallos runtime reales, salud de
dependencias y ruido de observabilidad.

Esta campaña no cambia reglas hoteleras ni rediseña flujos.

## Validación ejecutada

### Producción

- Vercel sirve v1.14.0 desde el SHA canónico de `main`.
- `/api/health/version` responde correctamente.
- `/api/health/storage` confirmaba configuración R2, pero hasta esta campaña
  no verificaba conectividad real.
- `/api/health/asistente` confirma Fronti operativo con Groq 120B y Groq 20B.
- El proveedor Cloudflare intermedio está degradado por
  `CLAVE_RECHAZADA`; Fronti sigue disponible por los otros proveedores.

### Errores históricos de Vercel

Se revisaron grupos recientes y se contrastaron contra el código actual.

Ya corregidos y cubiertos por regresión:

- FollowUp privado en Supervisión usando un campo Prisma inexistente
  `authorId`; el código vigente usa `createdById`.
- actualización de FollowUp intentando escribir `ownerId` de forma
  incompatible; el servicio vigente usa la relación Prisma `owner`.
- esquema de `consultar_prioridades` rechazado por el proveedor;
  la normalización de schema vigente tiene pruebas específicas.
- extracción de memoria con importance fuera de 1–5; el esquema actual permite
  el valor del modelo y el Libro lo normaliza.
- cierre de turno sin cierre formal de Caja; el servicio y la base validan la
  misma precondición.

Señales que permanecen relevantes:

- saturación del proveedor principal de Fronti puede ocurrir;
- la capa Cloudflare de fallback está degradada por credencial rechazada;
- hubo fallos TLS históricos al usar el fallback same-origin de adjuntos R2.

## Cambios v1.14.1

### Jornada E2E de servicios

`tests/operational-journey-e2e.test.ts` encadena en una sola prueba:

1. inicio de turno de Recepción;
2. creación y resolución de un registro del Libro;
3. inventario físico completo de llaves;
4. arqueo y cierre formal de Caja;
5. envío de entrega y cierre del turno saliente;
6. bloqueo del entrante antes de recepción;
7. recuento de Caja por el entrante;
8. recepción de la entrega;
9. apertura del turno entrante;
10. validación de una sola participación operativa viva;
11. creación de la validación posterior del cierre;
12. acceso del Supervisor a su Centro sin interferir con Recepción.

Se ejecuta contra PostgreSQL efímero de CI. No toca datos de Production.

### Higiene de logs Fronti

Los fallos conocidos ya no se registran todos como `console.error`:

- `DESACTIVADO` → información;
- fallos temporales → warning;
- fallos definitivos/técnicos → error.

La respuesta HTTP y el comportamiento funcional no cambian.

### Salud degradada de Fronti

El endpoint de salud conserva `estado: OK` cuando existe al menos un
proveedor sano, pero ahora informa además:

- `healthyProviders`;
- `degradedProviders`;
- `degraded`.

Así se distingue disponibilidad de redundancia completa.

### Salud real de R2

El healthcheck de Storage ahora hace un HEAD firmado no destructivo a una clave
reservada de salud:

- 200/404 = endpoint, TLS, firma y lectura utilizables;
- otros estados = conectividad no sana;
- excepción de red/TLS = `reachable: false`.

No se escribe ningún objeto y no se devuelve cuerpo de error ni secreto.

Además, el endpoint advierte si `R2_ACCOUNT_ID` se resolvió desde un alias
heredado. En Production actualmente se resuelve desde `R2_ACCOUND_ID`, que
conviene corregir en la configuración cuando haya acceso seguro a variables de
Vercel.

## Límites de esta ejecución

### Navegador autenticado

La sesión actual no expone un navegador interactivo autenticado al Libro.
No se crearon usuarios ni datos ficticios en Production para forzar un E2E.

La cobertura equivalente se reforzó mediante la jornada transversal de
servicios en CI y smoke/healthchecks reales contra Production.

### Neon Production

El conector Neon de esta sesión está sin alcance de proyecto y exige un
`project_id`. Ese identificador no se expone en el repositorio ni mediante las
herramientas de Vercel disponibles. Por seguridad no se intentó inferirlo desde
secretos o connection strings.

Por ello no se leyó directamente `OperationalMetricEvent` desde Neon en esta
campaña. La línea base sigue acumulándose y no se fijan objetivos con datos
insuficientes.

## Decisiones

- No abrir P3 de observabilidad.
- No optimizar tiempos hasta contar con una línea base suficiente.
- No eliminar fallback Cloudflare: primero corregir su credencial.
- No silenciar fallos reales para “limpiar” Vercel; sólo reclasificar estados
  esperados.
- No realizar refactors sin una señal reproducible.

## Próximo punto de decisión

Tras aproximadamente 30 días de datos P0–P2, revisar Salud Operativa y escoger
mejoras por evidencia: duración, fallos, abandono de flujo, fallback y
diferencias reales.
