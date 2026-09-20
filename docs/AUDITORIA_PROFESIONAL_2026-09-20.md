# Auditoría profesional — 20/09/2026

## Alcance

Auditoría no destructiva del Libro Operativo de Recepción sobre sus tres fuentes
oficiales:

`GitHub main → Vercel Production → Neon production`

Historia verificada:

`acceso → turno → importación PMS → habitación/estadía → llave/garantía/caja → entrega → recepción/cierre`

Este documento está sanitizado para un repositorio público. No incluye nombres,
identificadores, conteos de ocupación, movimientos financieros, estados de
turno, ramas de respaldo ni otra información operativa de Production.

No se aplicaron migraciones, no se modificaron datos operativos y no se desplegó
Production durante la auditoría.

## Resultado ejecutivo

El código desplegado coincide con la fuente de verdad, la compuerta de calidad
está verde y las invariantes estructurales revisadas no mostraron corrupción
activa. Los flujos críticos tienen cobertura de dominio e integración sobre una
base PostgreSQL efímera.

Los riesgos principales están en la continuidad técnica: falta un recorrido de
navegador autenticado en CI, la estrategia privada de respaldo/restauración
debe formalizarse y algunas dependencias requieren una actualización mayor
controlada.

## Evidencia reproducible

| Control | Resultado | Evidencia pública |
|---|---:|---|
| Fuente de verdad | Verde | `main`, tag `v1.1.2` |
| Instalación | Verde | `npm ci` reproducible |
| Migraciones | Verde | `prisma migrate deploy` sobre PostgreSQL efímero |
| Lint | Verde | Sin errores ni advertencias en esta rama |
| TypeScript | Verde | `tsc --noEmit` |
| Pruebas | Verde | 71 archivos; 738 aprobadas; una omitida |
| Build | Verde | Next.js 15.5.25 |
| Dependencias | Amarillo | Avisos sin corrección automática segura |

La Compuerta usa PostgreSQL 16 efímero y no utiliza Neon Production.

## Matriz funcional

| Flujo | Verificación | Estado |
|---|---|---:|
| Acceso, sesión y permisos | Pruebas de autenticación, identidad, roles y permisos | Verde |
| Turnos y horarios | Estados, participación, zona horaria y ciclo completo | Verde |
| Importación PMS | Detección, importes, advertencias, frescura y aplicación | Verde |
| Habitaciones y llaves | Ocupación, cola, asignación y reconciliación | Verde |
| Garantías y Caja | Transiciones, permisos, arqueo, traspaso y cierre | Verde |
| Novedades/tareas/alertas | Creación, estados, seguimiento y supervisión | Verde |
| Entrega y cierre | Continuidad, fotografía, deduplicación y cancelación | Verde |
| Navegador autenticado | No existe todavía una suite E2E de CI | Amarillo |

## Infraestructura y continuidad

### GitHub

- `main` tiene ruleset activo.
- Exige PR, historial sin force-push y el check obligatorio
  `Regresiones, tipos y build` actualizado contra la base.
- Existe trabajo histórico obsoleto que debe cerrarse mediante una limpieza
  deliberada, sin borrar referencias útiles por accidente.

### Vercel

- Vercel es el único hosting oficial.
- `vercel.json` desactiva despliegues de cualquier rama distinta de `main`.
- El health público valida proveedor, versión y commit.

### Neon

- Neon es la única base persistente oficial.
- Las pruebas y el desarrollo no utilizan Production.
- La protección, los respaldos, la retención y los ensayos de restauración se
  administran como información privada de infraestructura.

## Cambios preparados

1. Corrección de la advertencia `consistent-type-imports`.
2. Permiso mínimo `contents: read` en la Compuerta.
3. Bloqueo de vulnerabilidades de severidad crítica en CI.
4. Actualización del relevo y del contexto técnico.
5. Incremento propuesto a `v1.1.3` para respetar la política SemVer.

## Riesgos y próximos pasos

### Altos

1. Formalizar y ensayar de manera privada la recuperación de la base.
2. Actualizar Next/PostCSS y Prisma en ramas separadas. La corrección sugerida
   por npm cambia versiones mayores; no ejecutar `npm audit fix --force`.

### Medios

1. Incorporar un smoke autenticado con cuenta y base efímeras de CI.
2. Limpiar previews y ramas históricas sólo después de validar recuperación.
3. Migrar `next lint` antes de Next 16.
4. Migrar la configuración Prisma antes de Prisma 7.

## Criterio de cierre

Una actualización sólo está lista cuando la Compuerta completa queda verde, el
artefacto desplegado coincide con el SHA esperado y el smoke posterior confirma
la versión. Revertir código no revierte datos: cualquier rollback debe revisar
las migraciones por separado.

## Ampliación autenticada — Recepción y Supervisión

Después de la revisión estructural se recorrió Production con ambos perfiles.
El recorrido reveló cuatro discrepancias de criterio operativo que no eran
visibles en las pruebas técnicas originales:

1. La matriz persistida había derivado: Recepción acumulaba permisos de
   eliminación, reapertura, cierre de incidencias y auditoría; Supervisión
   acumulaba permisos técnicos de usuarios, roles y configuración.
2. La alerta «Validar cierre de turno» aparecía en Inicio para Recepción,
   aunque el servidor correctamente impedía resolverla con ese rol.
3. Una llave principal correctamente entregada a una habitación ocupada se
   interpretaba como acción pendiente y producía el mensaje contradictorio
   «Sin acción pendiente».
4. Auditoría aparecía bajo el acceso genérico «Administración», mezclando una
   capacidad de consulta con control técnico del sistema.

La corrección v1.1.4 normaliza únicamente Recepcionista y Supervisor mediante
una migración conservadora: elimina capacidades no canónicas, restaura las
faltantes y conserva `requiresApproval` en los permisos que ya existían. Además
filtra las validaciones de cierre según el rol, distingue una llave asignada de
una incidencia real, da una acción explícita a cada habitación mostrada y
separa «Auditoría» de «Administración» en la navegación.

Las ventanas conservan exactamente la misma lógica semiabierta
`[07:00,20:00)` / `[20:00,08:00)`; sólo se corrige su presentación humana a
«07:00–20:00» y «20:00–08:00».
