# Auditoría operativa integral — 25/09/2026

**Base auditada:** `main` @ `dfc62015a338f938e9b4606a706c901dbc18abef`  
**Producción:** Libro Operativo v1.10.8 · Vercel Production  
**Objetivo:** revisar la experiencia completa, detectar ambigüedades, redundancias,
rutas residuales y pasos evitables, y proponer una simplificación sin reconstruir
módulos funcionales.

## 1. Alcance revisado

Se inspeccionaron:

- 44 páginas autenticadas;
- 36 rutas API;
- 39 módulos de acciones de servidor;
- 56 servicios de dominio/servidor;
- 55 componentes principales bajo `src/components`;
- 93 suites de prueba;
- todos los controles interactivos encontrados en páginas y componentes operativos,
  de Supervisión, Administración, Chat, Fronti y legado PMS;
- navegación por rol y alcanzabilidad móvil;
- telemetría reciente disponible de Production.

La navegación principal vigente está correctamente concentrada en:

1. Inicio
2. Novedades
3. Caja
4. Mi turno
5. Llaves
6. Centro de Supervisión, sólo cuando corresponde

Ese núcleo **no debe ampliarse** con nuevos módulos de primer nivel salvo una razón
operativa fuerte.

## 2. Evidencia de uso reciente

La ventana de logs disponible muestra actividad humana principalmente en:

- `/libro/[id]`
- `/libro`
- `/turno/entrega/[id]`
- `/turno`
- `/llaves`
- `/caja`
- `/admin/turnos`
- `/admin/auditoria`

El tráfico más alto es técnico del widget de Chat:
`/api/chat/bootstrap` y `/api/chat/stream`.

No se observó actividad reciente en las rutas PMS profundas durante la ventana
consultada. Esto no prueba ausencia histórica de uso, pero sí refuerza que no son
parte del flujo operativo actual.

## 3. Principio de simplificación

La aplicación ya tiene la arquitectura correcta en el núcleo. La deuda principal
está en **superficies residuales y estados expuestos al usuario**, no en falta de
funcionalidad.

La regla para las siguientes versiones debe ser:

> **Conservar servicios y trazabilidad; reducir puertas, botones, nombres y decisiones
> que el usuario debe entender.**

---

# 4. Hallazgos P0 — corregir antes de ampliar funcionalidad

## P0.1 — PMS retirado en navegación, pero todavía mutable por rutas profundas

Las rutas superiores:

- `/habitaciones`
- `/habitaciones/[numero]`
- `/habitaciones/importar`
- `/huespedes`
- `/huespedes/importar`
- `/reservas`

redirigen correctamente a `/libro`.

Sin embargo, siguen vivas superficies profundas capaces de modificar datos PMS:

- `/huespedes/nueva-reserva`
- `/huespedes/reservas/[id]`
- `/reservas/[code]`
- componentes de importación, huéspedes, garantías y estadías;
- acciones y servicios PMS asociados.

Ejemplos de controles aún presentes en código:

- “Leer PDF y revisar antes de aplicar”
- “Guardar huésped”
- “Guardar reserva”
- “Registrar garantía”
- “Aplicar a huéspedes & reservas”
- “Añadir a habitación”
- “Resetear la habitación”
- “Confirmar Room move”
- “Confirmar check-in y entregar llave”

### Riesgo

El módulo está muerto para la navegación normal pero sigue vivo para un enlace
antiguo, marcador, historial o URL conocida. Esto contradice la decisión funcional
de retirar PMS del eje operativo.

### Simplificación propuesta

- Redirigir también las rutas PMS profundas de mutación.
- Mantener modelos/tablas históricos mientras sigan teniendo dependencias.
- Conservar Garantías como dominio de Caja, no como subproducto de una reserva.
- Retirar componentes/acciones PMS sólo después de comprobar referencias reales.

**No borrar datos históricos.**

---

## P0.2 — “Programar turnos” sigue existiendo como concepto residual

El servicio actual establece correctamente:

> “Los turnos NO se programan de antemano.”

Pero todavía existen:

- `ScheduleShiftForm` con botón “Programar turno”;
- `scheduleShiftAction`;
- schemas con comentarios “Programar o modificar un turno”;
- ayuda que indexa “programar”;
- textos de instalación que dicen que el administrador “programará los turnos”;
- permisos/pruebas con descripciones que siguen llamando `shift.manage`
  “programar turnos”.

El formulario `ScheduleShiftForm` no tiene consumidores actuales detectados:
es código muerto, pero conserva una semántica peligrosa.

### Simplificación propuesta

- Eliminar `ScheduleShiftForm` si se confirma sin consumidores.
- Renombrar conceptualmente `shift.manage` a “administrar historial/excepciones
  de turnos” en etiquetas visibles, sin necesidad inmediata de migrar la clave.
- Retirar “programar turno” de Ayuda, instalación y documentación.
- Mantener sólo: **iniciar, recibir, operar, entregar, cerrar, auditar**.

---

## P0.3 — El motor de “Atención ahora” todavía conserva un fantasma PMS

`buildOperationalAttention()` todavía acepta `rooms`, calcula estados PMS como
`CHECK_IN_EN_COLA`, `CHECK_OUT_PENDIENTE`, etc., y genera enlaces a
`/habitaciones/[numero]`.

El dashboard actual evita el problema pasando `rooms: []`, por lo que en
Production esa rama está dormida. Sin embargo:

- el dominio todavía modela habitaciones PMS;
- las pruebas siguen validando esa rama;
- un futuro cambio puede reactivarla accidentalmente.

### Simplificación propuesta

Retirar del motor transversal:

- `kind: 'room'`;
- `ROOM_SCORE`;
- `ROOM_STATE_ACTIONS`;
- enlaces a `/habitaciones/*`.

“Atención ahora” debe priorizar únicamente objetos del núcleo actual:

- novedades/incidencias;
- tareas;
- seguimientos;
- alertas visibles para el rol;
- estados críticos de Caja/Llaves/Turno cuando sean relevantes.

---

## P0.4 — Caja tiene dos semánticas coexistentes en el dominio

La semántica vigente y correcta ya está implementada en el arqueo vivo:

- denominaciones = **fondo fijo**;
- garantías = validación física separada;
- saldo operacional = movimientos;
- transferible = saldo operacional positivo.

`saveLiveCashAudit()` ya compara el conteo por denominaciones sólo contra el fondo.

Pero `src/domain/cash.ts` todavía conserva una abstracción
`CashExpectation.expectedMinor = fondo + garantías + operacional`, y las pruebas de
`caja.test.ts` siguen afirmando que una garantía forma parte del “esperado” del
conteo total.

El cierre de turno actual usa `fundStatuses()` para el conteo por denominación,
por lo que no se detectó que esta contradicción esté rompiendo el flujo vigente.
Aun así, la coexistencia de ambas definiciones es una fuente clara de regresión.

### Simplificación propuesta

Separar nombres y tipos:

- `FundCountExpectation`: sólo fondo fijo;
- `GuaranteeCustody`: lista/snapshot independiente;
- `OperationalBalance`: saldo y transferible;
- `CashCustodySummary`: composición informativa, nunca base del conteo de
  denominaciones.

Eliminar pruebas que normalizan “fondo + garantía + operación” como un único
objetivo de billetes/monedas.

---

## P0.5 — Documentación de situación quedó parcialmente corrupta/obsoleta

`PROJECT_PROGRESS.md` en `main` todavía:

- marca #125 como `PR_ABIERTO`;
- lo describe como “pendiente antes de Production”;
- conserva una cola de texto de una versión antigua en la línea de actualización;
- mantiene bloques viejos de versiones previas.

La fuente de verdad técnica ya es v1.10.8 en Production.

### Simplificación propuesta

Corregir el tablero en el siguiente PR y hacer que el workflow de release pueda
actualizar automáticamente los campos verificables de versión/estado.

---

# 5. Hallazgos P1 — simplificación visible para Recepción

## P1.1 — Mi turno expone demasiada máquina de estados

Controles actuales detectados:

- Abrir mi turno
- Sumar al turno
- Confirmar recepción
- Preparar entrega de turno
- Enviar entrega al turno siguiente
- Cerrar mi turno
- Cancelar preparación
- Recontar y recibir Caja
- Cerrar Caja primero
- Revisar y enviar la entrega
- Ver entrega

Todos representan estados válidos, pero obligan al usuario a comprender la
orquestación interna.

### Objetivo

Mostrar un flujo guiado:

**Inicio**
1. Iniciar turno
2. Recontar Caja y garantías, si hay entrega
3. Confirmar recepción
4. Operar

**Cierre**
1. Iniciar cierre
2. Arquear Caja
3. Revisar pendientes
4. Enviar entrega
5. Cerrar turno
6. Imprimir informe cuando el entrante confirme

El backend puede conservar los estados actuales.

### Microcopias a mejorar

- “Sumar al turno” → **“Unirme a este turno”**
- “Preparar entrega de turno” → **“Iniciar cierre”**
- “Enviar entrega al turno siguiente” → **“Enviar entrega”**
- “Cerrar mi turno” → **“Finalizar turno”** si ya quedó claro que Caja/entrega
  están completos.

La frase residual “puedes cerrar este turno sin esperar a que el siguiente confirme”
es técnicamente compatible con el relevo secuencial, pero puede interpretarse como
una excepción a la nueva regla. Cambiar por:

> “Cierra este turno para habilitar el inicio del recepcionista entrante.”

---

## P1.2 — Novedades sigue rodeado por módulos especializados redundantes

El menú principal ya retiró correctamente:

- Tareas
- Incidencias
- Alertas
- Seguimientos

como módulos principales.

Sin embargo siguen existiendo páginas completas:

- `/incidencias`
- `/tareas`
- `/seguimientos`
- `/alertas`

y enlaces internos continúan saltando entre ellas y el Libro.

### Simplificación propuesta

**Recepción**
- `/libro` = única bandeja de gestión.
- Novedad e Incidencia = tipos de registro.
- Tareas = acciones vinculadas y “Mis tareas”.
- Seguimientos = acciones vinculadas al registro/tarea.
- Alertas = atención generada por el sistema; no “novedades”.

Mantener detalles individuales cuando aportan profundidad, pero redirigir las
listas especializadas a vistas filtradas del Libro para Recepción.

**Supervisión**
puede conservar vistas especializadas si realmente las necesita.

---

## P1.3 — Inicio es correcto, pero su dominio conserva conceptos retirados

La UI de Inicio ya está simplificada y las pruebas protegen que no vuelva a
duplicar bloques. Eso es bueno.

Aun así, `OperationalAttention` conserva habitaciones PMS y el contador
`roomsNeedingAction` existe siempre vacío.

### Simplificación propuesta

Eliminar esos residuos y hacer que el contrato de Inicio represente exactamente
lo que puede aparecer hoy.

---

## P1.4 — Caja es funcional, pero demasiado densa en una sola superficie

Controles detectados entre Caja viva y cierre:

- Generar folio
- Registrar movimiento
- Registrar regularización
- Confirmar regularización
- Registrar garantía
- Guardar arqueo
- Devolver garantía
- Anular folio
- Guardar dólar
- Registrar transferencia
- Confirmar cierre formal

No son redundantes técnicamente, pero compiten visualmente.

### Simplificación propuesta

Una sola pantalla Caja con cuatro vistas:

1. **Resumen**
   - fondo;
   - garantías;
   - saldo operacional;
   - transferible;
   - última diferencia.

2. **Arqueo**
   - denominaciones;
   - validación de garantías;
   - resultado;
   - una sola acción principal.

3. **Movimientos**
   - ingresos/egresos;
   - regularizaciones;
   - Tesorería.

4. **Folios**
   - gimnasio;
   - búsqueda;
   - anulación.

Durante cierre de turno, Caja entra en **modo cierre** y muestra sólo lo necesario
para completar el cierre.

### Microcopias

- “Registrar movimiento” debe indicar **Ingreso** o **Egreso** según selección.
- “Regularización” debe explicitar que **no altera el esperado**, sino que documenta
  una diferencia previa.
- “Guardar arqueo” y “Confirmar cierre formal” deben mostrarse como pasos, no como
  acciones hermanas.

---

## P1.5 — Llaves mezcla inventario oficial y gestión patrimonial avanzada

La función que Recepción necesita diariamente es clara:

> **Tomar inventario de llaves por piso**

La pantalla también ofrece:

- Ingresar llave
- Entregar
- Recibir
- Registrar incidencia
- Reintegrar
- Dar de baja
- administrar copias/llaves individuales

### Simplificación propuesta

Vista predeterminada:

**Inventario**
- Piso 4 / 5 / 6
- 89 habitaciones
- faltantes con observación obligatoria
- Guardar inventario

Sección secundaria:

**Gestión de llaves**
- alta;
- entrega/devolución;
- extraviada;
- fuera de servicio;
- reintegro/baja.

No eliminar capacidades; cambiar jerarquía visual.

---

# 6. Hallazgos P1 — Supervisión

El Centro de Supervisión contiene correctamente muchas capacidades, pero el
usuario debe navegar entre:

- turno de Supervisión;
- entrega/recepción de Supervisión;
- bandeja integrada;
- asignación;
- tareas;
- seguimientos;
- notas;
- auditorías sorpresa;
- checklists;
- medidas correctivas;
- comunicados;
- rendimiento;
- informes;
- validación de cierres.

### Simplificación propuesta

Tres áreas visibles:

## Hoy
- turno de Supervisión;
- cierres por validar;
- diferencias de Caja;
- novedades críticas;
- tareas/seguimientos vencidos;
- acciones rápidas.

## Equipo
- asignaciones;
- tareas;
- seguimientos;
- notas;
- comunicados;
- rendimiento.

## Control
- auditorías sorpresa;
- checklists;
- medidas correctivas;
- informes;
- trazabilidad.

### Microcopias

- “Iniciar turno” → **“Iniciar turno de Supervisión”**
- “Generar entrega” → **“Preparar entrega de Supervisión”**
- “Finalizar turno” → **“Cerrar turno de Supervisión”**

Así nunca se confunde con el turno de Recepción.

---

# 7. Hallazgos P1 — Administración

Administración tiene 11 accesos del mismo nivel:

- Usuarios
- Roles y permisos
- Áreas
- Fronti
- Parámetros
- Diagnóstico y reparación
- Correo
- Historial de turnos
- Dejar el sistema en cero
- Auditoría
- Registros eliminados

“Dejar el sistema en cero” aparece al mismo nivel visual que Usuarios o Correo.

### Simplificación propuesta

## Personas y acceso
- Usuarios
- Roles y permisos
- Áreas

## Operación
- Parámetros
- Historial de turnos
- Correo

## Sistema
- Fronti
- Diagnóstico
- Auditoría
- Eliminados

## Zona de riesgo
- **Dejar el sistema en cero**

“Mantenimiento” debe vivir dentro de Diagnóstico, no como otra acción global al pie
de Administración.

### Formularios residuales

`admin-forms.tsx` todavía contiene `ScheduleShiftForm`, aunque no se detectaron
consumidores. Retirarlo reduce superficie muerta.

Los múltiples botones genéricos “Guardar” en Fronti deberían decir qué guardan:
“Guardar proveedor”, “Guardar comportamiento”, “Guardar acceso”, etc.

---

# 8. Hallazgos P1 — Chat, Fronti, notificaciones y ayuda

## Chat + Fronti

La integración ya es rica y funcional. El componente soporta:

- conversaciones individuales;
- grupos;
- presencia;
- perfil;
- reacciones;
- guardados;
- edición/eliminación;
- GIF;
- stickers;
- archivos;
- respuestas;
- menciones;
- `@todos`;
- `@turno`;
- `@Fronti`;
- confirmaciones de acciones IA.

La funcionalidad no debe crecer en ancho antes de consolidar la experiencia.

### Simplificación

- mantener una sola burbuja;
- conservar archivos/GIF/stickers detrás de un único menú “+”;
- esconder administración de grupos en “Información del grupo”;
- no agregar nuevos botones permanentes al compositor.

El componente independiente `fronti-assistant.tsx` sigue existiendo para el
Administrador técnico. Está justificado mientras ese rol no pertenezca al chat
operativo, pero debe considerarse una excepción explícita para no volver a dos
burbujas en Recepción.

## Notificaciones

Hay widget en tiempo real **y** página completa `/notificaciones`.

Para la operación diaria, el widget ya cumple el objetivo originalmente definido.
La página puede quedar como historial si aporta valor, pero no debe competir como
otro “centro”.

## Ayuda / Tutorial / Fronti

Definir responsabilidades:

- **Ayuda:** procedimiento oficial y determinista.
- **Tutorial:** onboarding guiado, no consulta diaria.
- **Fronti:** explicación conversacional y ejecución bajo permisos.

Evitar que tres sistemas enseñen reglas distintas.

---

# 9. Hallazgos P2 — deuda técnica y superficies huérfanas

## P2.1 — Componentes PMS y de habitaciones todavía ocupan gran superficie

Persisten componentes completos de:

- Room move;
- check-in;
- multas por habitación;
- reconciliación con estadías;
- conflictos PMS;
- huéspedes/reservas;
- importadores PMS;
- reset de habitación.

No eliminarlos a ciegas: primero cerrar rutas profundas y ejecutar búsqueda de
dependencias. Después retirar por lotes pequeños.

## P2.2 — `/indicadores` existe pero no está en navegación

El Centro de Supervisión ya tiene rendimiento e indicadores contextualizados.
Decidir una única casa para métricas. Recomendación: **Supervisión**.

## P2.3 — `/supervision/informes` es una ruta especializada secundaria

No es un problema, pero debería aparecer desde “Control” y no como módulo mental
independiente.

## P2.4 — páginas especializadas de Caja

`/caja/cierre` y `/caja/gimnasio` existen mientras la página principal ya
incorpora esas capacidades. Revisar si son wrappers/compatibilidad y, si no aportan
un flujo distinto, redirigir a secciones de `/caja`.

## P2.5 — Chat hace mucho bootstrap

En la ventana reciente, `/api/chat/bootstrap` domina el tráfico.

No es una urgencia funcional, pero el objetivo técnico debe ser:

- bootstrap al abrir;
- stream/deltas para cambios;
- evitar recargar todo el estado cuando basta una actualización incremental.

---

# 10. Botones y lenguaje ambiguo detectado

## Turno
- “Sumar al turno” → “Unirme a este turno”
- “Preparar entrega de turno” → “Iniciar cierre”
- “Enviar entrega al turno siguiente” → “Enviar entrega”
- “Cancelar preparación” → “Cancelar cierre” sólo si realmente revierte el modo
  cierre completo; si no, explicar exactamente qué revierte.

## Caja
- “Registrar movimiento” → “Registrar ingreso” / “Registrar egreso”
- “Registrar regularización” → “Documentar diferencia”
- “Confirmar regularización” → “Confirmar documentación de diferencia”
- “Guardar dólar” → “Guardar tipo de cambio USD”
- “Registrar transferencia” → “Enviar a Tesorería”

## Llaves
- “Ingresar llave” → “Agregar llave al stock”
- “Confirmar entrega” → “Entregar llave”
- “Confirmar devolución” → “Recibir llave”
- “Guardar incidencia” → indicar estado: “Marcar extraviada” o “Marcar fuera de
  servicio” cuando corresponda.

## Supervisión
- todas las acciones de turno deben decir “de Supervisión”.

## Administración
- evitar botones genéricos “Guardar” cuando hay varias tarjetas en una misma
  pantalla.

---

# 11. Flujo objetivo de Recepción

La operación diaria debería poder explicarse en menos de un minuto:

## Al entrar
1. Inicia tu turno.
2. Si recibes entrega: recuenta Caja y garantías.
3. Confirma la recepción.
4. El Libro se desbloquea.

## Durante el turno
- **Inicio:** qué requiere atención ahora.
- **Novedades:** qué pasó y qué sigue en gestión.
- **Caja:** dinero y garantías.
- **Llaves:** inventario físico.
- **Chat + Fronti:** coordinación y asistencia.

## Al salir
1. Inicia cierre.
2. Arquea Caja y valida garantías.
3. Revisa pendientes.
4. Envía entrega.
5. Cierra turno.
6. El entrante inicia, recuenta y confirma.
7. Impriman/firmen el informe Caja entrega/recepción.

Todo lo demás es detalle, historia, Supervisión o Administración.

---

# 12. Modelo objetivo de Novedades

**Novedad** e **Incidencia** son las únicas entidades raíz que Recepción necesita
crear de forma habitual.

- Una tarea puede nacer de una novedad/incidencia.
- Un seguimiento puede nacer de una novedad, incidencia o tarea.
- Una alerta es producida por el sistema.
- Una validación de cierre pertenece a Supervisión.
- Un evento técnico pertenece a Auditoría.

Esto evita que “algo que pasó” se replique simultáneamente como novedad, alerta,
tarea y seguimiento sin que el usuario sepa cuál debe cerrar.

---

# 13. Orden de implementación recomendado

## Libro 1.10.9 — Higiene operativa P0

Sin cambios de esquema destructivos:

1. cerrar rutas PMS profundas mutables;
2. retirar `ScheduleShiftForm` y lenguaje “programar turnos”;
3. sacar habitaciones PMS de `OperationalAttention`;
4. unificar la semántica de tipos/pruebas de Caja;
5. corregir `PROJECT_PROGRESS.md`;
6. pruebas que impidan reintroducir esas cuatro deudas.

## Libro 1.11.0 — Simplificación de Recepción

1. Turno como flujo guiado;
2. Caja por vistas/etapas;
3. Llaves: Inventario primero, gestión avanzada secundaria;
4. listas especializadas de Incidencias/Seguimientos/Alertas → filtros o
   redirecciones según rol;
5. microcopias operativas coherentes.

## Libro 1.12.0 — Supervisión y Administración

1. Supervisión → Hoy / Equipo / Control;
2. Administración agrupada;
3. Zona de riesgo;
4. consolidar métricas/informes;
5. limpiar rutas/componentes ya sin referencias.

## FRONTI

Mantener su evolución separada del refactor de interfaz. No usar FRONTI para
compensar procedimientos confusos: primero el procedimiento debe ser claro y
determinista, luego FRONTI lo explica o ejecuta.

---

# 14. Criterios de éxito

La simplificación se considera exitosa cuando:

- un recepcionista nuevo entiende el flujo principal sin conocer estados internos;
- ninguna operación normal requiere recordar una URL oculta;
- no existe más de una pantalla principal para resolver el mismo concepto;
- cada botón dice exactamente qué cambia;
- Caja tiene una sola interpretación de fondo, garantías y saldo operacional;
- Novedades no contiene validaciones técnicas/administrativas;
- PMS no puede reaparecer por una ruta profunda;
- Supervisión ve excepciones, no ruido de operación normal;
- Administración separa configuración normal de acciones destructivas;
- los tests protegen las decisiones de simplificación igual que hoy protegen
  permisos y estados.

## Conclusión

El Libro no necesita una reconstrucción. El núcleo ya está bien orientado.

La siguiente ganancia grande no viene de agregar módulos, sino de **retirar caminos
alternativos, código residual y palabras heredadas**. La base funcional puede
mantenerse mientras la experiencia se reduce a una secuencia operacional mucho más
obvia.
