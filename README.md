# Libro Operativo de Recepción

Sistema operativo digital para recepción hotelera. Reemplaza el libro de
novedades en papel y centraliza turnos, entregas, novedades, incidencias,
tareas, seguimientos, alertas, trazabilidad e indicadores.

La prioridad del producto es que un recepcionista entienda en pocos segundos
qué está pasando, qué debe hacer, qué quedó pendiente, qué está vencido y qué
debe entregar al turno siguiente.

## Puesta en marcha

Requisitos: Node.js 22+, PostgreSQL 14+.

```bash
# 1. Dependencias
npm install

# 2. Entorno (copiar y completar; nunca se versiona el .env real)
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"  # AUTH_SECRET

# 3. Base de datos
npm run db:deploy      # aplica migraciones
npm run db:seed        # catálogo base + datos demo

# 4. Desarrollo
npm run dev            # http://localhost:3000
```

### Cuentas demo

Todas usan la contraseña definida en `SEED_DEMO_PASSWORD` (por defecto `Demo2024!`).

| Correo | Rol |
| --- | --- |
| `admin@hotel.local` | Administrador de sistema |
| `supervisor@hotel.local` | Supervisor |
| `recepcion.manana@hotel.local` | Recepcionista (mañana) |
| `recepcion.tarde@hotel.local` | Recepcionista (tarde) |
| `auditor.noche@hotel.local` | Auditor nocturno |

Los datos demo dejan el sistema en un punto útil para probar: el turno de la
mañana ya envió su entrega y el turno de la tarde está listo para iniciarse y
recibirla. Entrando como `recepcion.tarde@hotel.local` se recorre el ciclo
completo.

### Paso a producción

Un despliegue nuevo no necesita consola: en la primera visita el sistema abre
`/instalacion`, donde se crea el hotel y la cuenta de Administrador de sistema.
Esa pantalla se desactiva en cuanto existe una cuenta. El paso a paso está en
[`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

Si en cambio partiste del entorno de desarrollo con datos demo, la transición
al uso real es:

```bash
npx tsx scripts/create-admin.ts "Nombre Apellido" correo@hotel.com "ContraseñaSegura1"
npm run demo:purge
```

`demo:purge` borra únicamente los registros marcados como demo y **exige** que
exista al menos un Administrador de sistema real, de modo que el sistema nunca
quede sin acceso administrativo. El catálogo base (permisos, roles, áreas y
parámetros) se conserva.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Compilación y ejecución de producción |
| `npm run lint` | ESLint (configuración de Next.js + reglas propias) |
| `npm run typecheck` | TypeScript en modo estricto, sin emitir |
| `npm test` | Pruebas automatizadas (Vitest + PostgreSQL de pruebas) |
| `npm run verify` | lint + typecheck + pruebas + build |
| `npm run db:migrate` | Nueva migración en desarrollo |
| `npm run db:deploy` | Aplica migraciones (producción) |
| `npm run db:seed` | Catálogo base y datos demo |
| `npm run demo:purge` | Elimina los datos demo |

## Qué incluye

- **Turnos** con máquina de estados explícita: Programado → Iniciado → Turno
  activo → Preparando entrega → Entrega enviada → Recibido → Cerrado. Las
  reglas se validan en servidor y los estados contradictorios se bloquean.
- **Entrega de turno guiada**: resumen automático de todo lo que el turno
  siguiente necesita saber (novedades, incidencias, tareas, alertas,
  seguimientos, reservas, cobros, garantías, solicitudes y mantenimiento),
  clasificado en Urgente / Importante / Informativo, más notas manuales y
  confirmación de recepción. Cada entrega queda registrada de forma permanente
  con una fotografía inmutable de su contenido.
- **Libro operativo**: vista cronológica única que unifica registros, tareas,
  seguimientos y alertas, con búsqueda global y filtros combinables.
- **Incidencias** como registros con estructura ampliada: gravedad, impacto,
  acción inmediata, causa, resolución y fecha de cierre.
- **Tareas** con responsable, prioridad, fecha límite, checklist y origen
  trazable (registro, incidencia, entrega, seguimiento, alerta o manual).
- **Seguimientos** con acción, resultado, próxima acción y fecha programada;
  si vencen sin cerrarse, generan alerta.
- **Motor de alertas** idempotente: garantías, cobros, tarjetas rechazadas,
  reservas sin confirmar, tareas vencidas, incidencias críticas, mantenimiento
  sin resolver, seguimientos vencidos, entregas sin confirmar, VIP y más. Las
  alertas se marcan como vistas, se posponen o se resuelven, y se cierran solas
  cuando la condición de origen desaparece.
- **Panel principal** ordenado por urgencia real, con el turno actual y su
  próximo paso siempre visible.
- **Roles y permisos (RBAC)** aplicados en servidor, editables desde la
  interfaz por el Administrador de sistema.
- **Trazabilidad completa**: auditoría de creación, edición, cambios de estado,
  responsable, prioridad, cierre, reapertura, eliminación, restauración y
  movimientos de turno, con valor anterior, valor nuevo y motivo.
- **Eliminación lógica** con motivo y recuperación desde Administración.
- **Indicadores** operativos: cumplimiento en plazo, tareas vencidas,
  incidencias abiertas, tiempo medio de resolución, pendientes heredados,
  cumplimiento de entregas e incidencias por área.
- **Centro de notificaciones** interno, con la arquitectura lista para agregar
  correo o WhatsApp sin tocar los módulos operativos.

## Documentación

- [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md) — cómo dejar el sistema en línea,
  con dominio y base de datos, sin usar la consola.
- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — decisiones técnicas, modelo
  de datos, seguridad, y limitaciones conocidas.

## Estado de calidad

`npm run verify` ejecuta lint, typecheck, las 136 pruebas automatizadas y la
compilación de producción. Las limitaciones conocidas están documentadas en
`docs/ARQUITECTURA.md`.
