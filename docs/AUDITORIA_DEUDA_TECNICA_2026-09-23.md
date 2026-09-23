# Auditoría de deuda técnica — 2026-09-23

## Fuente de verdad
- Producción Vercel: commit `14f232a698968d1ee38f5c6b72d94bb2a3cb3f57` (v1.4.3), deployment READY.
- Repositorio: `main`.
- Esta auditoría no elimina datos ni modelos históricos.

## Arquitectura canónica

```text
Turnos
├─ Novedades
├─ Caja
├─ Llaves
└─ Supervisión

Infraestructura:
Usuarios · Roles · Permisos · Auditoría · Configuración

Referencias opcionales:
Habitación · Huésped · Reserva · Identificadores externos
```

El Libro Operativo de Recepción no es un PMS. El PMS externo, cuando exista, es contexto opcional.

## Clasificación

### ACTIVO
- `Shift`, `ShiftAssignment`, `ShiftHandover`.
- `OperationalEntry`, tareas, seguimientos y alertas.
- `CashMovement`, arqueos, transferencias, folios y garantías de efectivo.
- `SupervisionShift` y entidades del Centro de Supervisión.
- `User`, `Role`, `Permission`, `AuditLog`, configuración.
- `Room` únicamente como referencia física (número/piso).
- `Guarantee` como subdominio de Caja; sus vínculos PMS ya son opcionales.

### ACTIVO PERO MAL ACOPLADO
- `RoomKey` y `KeyMovement`.
  - Prisma ya permite `stayId = null`.
  - El servicio `src/server/services/keys.ts` todavía importa `RoomStayStatus`, `RoomStayStage` y reglas de conciliación PMS.
  - `getKeyInventory()` aún hace join a `RoomStay` para mostrar huésped.
  - La ruta `/llaves` fue retirada en v1.4.0 y redirige a `/libro`.

### LEGADO AISLABLE
- `RoomStay`.
- `ReservationReference` y `GuestReference`.
- `PmsImportBatch` y filas de importación.
- `src/server/services/pms-import.ts`.
- Acciones de check-in/check-out, conciliación y reparación de estadías.
- Rutas de habitaciones, huéspedes, reservas e importación PMS accesibles por URL histórica pero ausentes de la navegación principal.

### CANDIDATO A ELIMINACIÓN (NO BORRAR AÚN)
- Componentes de informes PMS retirados del flujo principal.
- Server actions PMS sin consumidores de navegación vigente.
- Permisos exclusivamente PMS/habitaciones cuando ya no tengan consumidores legítimos.
- Helpers de conciliación que queden sin consumidores después del desacoplamiento de Llaves.

## Dependencias obligatorias indebidas encontradas
1. `OPERATIONAL_BASE` todavía concede `guest.manage`, `room.manage` y `pms.import` a Recepción/Auditor nocturno/Supervisor.
2. `RoomKey` mantiene un vínculo opcional a `RoomStay`; puede conservarse por historia, pero no debe usarse como requisito operativo.
3. `KeyMovement` mantiene `stayId` opcional; debe quedar como metadata histórica, no como identidad del movimiento.
4. `keys.ts` todavía ejecuta reconciliación automática contra estadías y PMS.
5. `/llaves` no ofrece inventario físico por piso.

## Plan de desacoplamiento
1. Restaurar `/llaves` como inventario físico autónomo.
2. Añadir conteos persistentes por piso 4/5/6 sin depender de `RoomStay`.
3. Crear acciones físicas de llave (entrega, devolución, extravío, recuperación, alta/baja/ajuste) que no consulten PMS.
4. Mantener funciones antiguas de conciliación aisladas y documentadas como LEGACY mientras tengan consumidores.
5. Retirar permisos PMS/habitaciones del conjunto operativo base; conservarlos solo donde una ruta histórica todavía requiera acceso explícito.
6. Añadir pruebas de independencia de `RoomStay` y actualizar documentación canónica.
7. Solo después, volver a medir consumidores y clasificar piezas realmente eliminables.

## Riesgos
- Las relaciones históricas de Prisma no deben borrarse mientras haya datos o reportes que las lean.
- Las rutas antiguas pueden seguir siendo usadas mediante enlaces directos; ocultarlas no equivale a aislarlas.
- Modificar enums o constraints requiere migración; cualquier cambio destructivo queda fuera de este bloque.
