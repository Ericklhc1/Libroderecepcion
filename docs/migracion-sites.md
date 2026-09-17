# Migración desde Sites — Libro Operativo de Recepción

## Origen verificado

- Sitio: `Libro Operativo de Recepción`
- URL histórica: `https://libroderecepcion.ericklhc.chatgpt.site`
- Estado del artefacto recuperado: activo, acceso personalizado/privado.
- Versión de fuente recuperada: 17.
- La versión Sites debe tratarse como **origen histórico de datos**, no como fuente para reconstruir la arquitectura nueva.

## Principio de migración

La migración debe conservar datos y trazabilidad sin reemplazar registros que ya existan en Neon. No se importará a ciegas ni se hará un volcado directo de tablas incompatibles.

Flujo obligatorio:

1. Extraer tablas/registros del origen Sites en modo lectura.
2. Congelar un inventario con conteos por entidad y fecha máxima de modificación.
3. Normalizar cada registro al modelo actual.
4. Resolver identidades antes de importar relaciones.
5. Ejecutar una simulación (`dry-run`) con: nuevos, coincidencias, conflictos y descartados.
6. Importar en una transacción por bloque lógico, manteniendo referencias al origen cuando sea posible.
7. Conciliar conteos y muestras después de cada bloque.
8. No borrar ni sobrescribir datos actuales de Neon por defecto.

## Entidades que deben extraerse del origen

Como mínimo, revisar y exportar:

- usuarios y roles;
- turnos y asignaciones;
- entregas/cierres de turno;
- novedades/registros operativos;
- incidencias, seguimientos y responsables;
- habitaciones;
- huéspedes/estancias/reservas históricas;
- movimientos y estado de llaves;
- caja/cierres o conteos existentes;
- auditoría e historial;
- recordatorios/alertas si existen;
- configuraciones operativas que contengan datos y no sólo presentación.

## Datos visibles recuperados de una captura histórica

En un informe del 11-09-2026 17:03 se observa:

- Novedades generales: 0.
- Operación interna: 1.
- Registro: `Se presta plancha`.
- Texto visible asociado: `porte tenemos 4 y porque se puede jaja`.
- Pendiente: `Pedir plancha`.
- Responsable: `Todos`.
- Plazo: `11/09/2026 17:32`.
- Estado visible: `nueva`.
- Informado: `No registrado`.
- Validación: `Sin validar`.
- No show: 0.

Este registro debe localizarse en la exportación real antes de migrarlo; la captura sirve como control de conciliación, no como fuente primaria para crear el dato.

## Regla especial de turnos

Existe referencia histórica a una entrega incompleta identificada como `6692abba-be44-4b...`. Si aparece en Sites, no debe importarse como un turno activo actual. Debe migrarse como histórico con su estado original y una marca de origen, o conciliarse con el registro equivalente que ya exista en el sistema nuevo.

## Mapeo al modelo actual

- Novedades/incidencias → `OperationalEntry`.
- Responsables y pendientes → `ownerId`, `Task` y/o `FollowUp` según semántica real.
- Turnos → `Shift` + `ShiftAssignment` + `ShiftHandover`.
- Habitaciones → `Room`.
- Estancias históricas → `RoomStay`.
- Huéspedes/reservas → `GuestReference` + `ReservationReference` cuando haya identidad suficiente.
- Llaves → `RoomKey` + `KeyMovement`; no importar sólo un contador si existe historial de movimientos.
- Caja → entidades actuales de caja; no mezclar pesos y dólares ni convertir moneda.
- Auditoría → conservar como histórico de origen; no falsificar `AuditLog` como si las acciones hubieran ocurrido en el sistema nuevo.

## Identidad y deduplicación

Orden de coincidencia sugerido:

1. identificador estable del origen, si puede recuperarse;
2. código/localizador de reserva;
3. habitación + huésped + intervalo de fechas para estadías;
4. nombre de usuario para cuentas;
5. combinación de fecha/hora + tipo + texto + autor para novedades sin ID reutilizable.

Toda coincidencia ambigua va a una lista de conflictos; no se decide automáticamente.

## Qué falta extraer todavía

El artefacto de Sites recuperable desde Library expone la pantalla de acceso y metadatos del sitio, pero no entrega por sí mismo el contenido de su base autenticada. Antes de ejecutar la migración hace falta obtener el dataset real en modo lectura (exportación de la base de Sites o acceso a sus tablas). Hasta entonces este documento es el inventario y contrato de migración, no una afirmación de que todos los datos ya estén copiados.
