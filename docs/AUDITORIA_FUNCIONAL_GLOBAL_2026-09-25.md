# Auditoría funcional global — Libro Operativo de Recepción

Fecha: **25-09-2026**  
Base auditada: **Production v1.10.8** · commit `dfc62015a338f938e9b4606a706c901dbc18abef`

## Alcance real revisado

La auditoría cubre el árbol completo de la aplicación vigente:

- **44 páginas** dentro del área autenticada;
- **36 rutas API**;
- **39 módulos de acciones de servidor**;
- **56 servicios de dominio/servidor**;
- **55 componentes React de aplicación**;
- **93 suites de pruebas**;
- navegación por rol;
- controles visibles de Turno, Novedades, Caja, Llaves, Supervisión, Administración, Chat, FRONTI, Alertas, Tareas y Seguimientos;
- rutas PMS retiradas y rutas profundas todavía existentes;
- actividad reciente de Vercel Production.

En la muestra reciente de Production no aparecen errores runtime. La navegación humana observada se concentra en:
`/libro/[id]`, `/libro`, `/turno/entrega/[id]`, `/turno`, `/admin/turnos`, `/llaves`, `/`, `/caja` y `/admin/auditoria`.
El mayor volumen técnico corresponde a `/api/chat/bootstrap`, no a una pantalla humana.

## Conclusión ejecutiva

La arquitectura correcta ya existe. El Libro no necesita más módulos: necesita **menos superficies y más orquestación**.

El núcleo canónico debe seguir siendo:

1. **Inicio** — qué requiere atención ahora.
2. **Novedades** — qué ocurrió y qué sigue en gestión.
3. **Caja** — custodia y trazabilidad financiera.
4. **Mi turno** — puerta obligatoria de la operación.
5. **Llaves** — inventario físico.
6. **Supervisión** — excepciones, validación y control.
7. **Chat + FRONTI** — comunicación y asistencia contextual.
8. **Administración** — configuración técnica, fuera de la operación.

La mayor deuda actual no está en la base ni en los servicios principales: está en
**rutas históricas, controles redundantes, terminología ambigua y pantallas demasiado cargadas**.

---

# Hallazgos P0 — corregir antes de seguir ampliando

## P0.1 · PMS retirado en navegación, pero todavía mutable por URL profunda

Las rutas principales `/habitaciones`, `/huespedes`, `/reservas` y sus importadores redirigen correctamente a Novedades.

Sin embargo siguen funcionales:

- `/huespedes/nueva-reserva` — carga/aplica PDF de reserva;
- `/huespedes/reservas/[id]` — permite edición de reserva/garantías;
- `/reservas/[code]` — conserva una ficha PMS navegable.

**Problema:** el PMS está retirado conceptualmente pero no completamente retirado del runtime.

**Simplificación:** mantener los datos históricos y servicios sólo donde sigan siendo dependencias internas, pero hacer que esas tres rutas profundas también redirijan a la superficie vigente. Ningún recepcionista debe poder reactivar el PMS con una URL vieja.

**Riesgo:** medio. Antes de retirar hay que confirmar que ningún enlace histórico/documental necesite esas vistas como sólo lectura.

---

## P0.2 · Caja tiene dos conceptos de arqueo que pueden parecer la misma acción

Hoy conviven:

- arqueo operativo de Caja viva (`LiveCashAuditDialog`);
- cierre formal de Caja asociado al turno (`CashBox` / `cash-closure`).

Además existen acciones para:
- registrar movimiento;
- registrar regularización;
- reclasificar un movimiento como regularización;
- garantías;
- devolución de garantías;
- folio gimnasio;
- anulación de folio;
- transferencia a Tesorería;
- dólar;
- cierre formal.

**Problema:** técnicamente son operaciones distintas, pero para Recepción varias se presentan como variaciones de “arreglar/cuadrar Caja”.

**Simplificación:**
- **Arquear Caja** = contar fondo por denominación + validar garantías.
- **Registrar movimiento** = sólo ingreso/egreso real autorizado.
- **Regularizar diferencia** = herramienta excepcional, con autorización.
- **Cerrar Caja del turno** = paso del flujo de cierre, no otro módulo de Caja.
- **Tesorería** = transferencia, nunca “ajuste”.
- garantías siempre visibles aparte del fondo.

**Riesgo:** alto si se cambia dominio; bajo si primero se simplifica solamente la presentación.

---

## P0.3 · Cloudflare sigue fuera de servicio como fallback real de FRONTI

Health Production actual:

- Groq GPT-OSS 120B: **OK**
- Cloudflare GLM-4.7-Flash: **CLAVE_RECHAZADA**
- Groq GPT-OSS 20B: **OK**

**Problema:** la cadena declarada es multi-proveedor, pero la resiliencia real sigue dependiendo de Groq.

**Simplificación/acción:** no ampliar Beta hasta diagnosticar la credencial/token/account de Workers AI y observar al menos una inferencia real completa por Cloudflare.

**Riesgo:** bajo funcionalmente; alto para la promesa de resiliencia USD 0.

---

## P0.4 · Documento de situación desactualizado

`PROJECT_PROGRESS.md` todavía declara #125 como PR abierto y contiene restos concatenados de una versión antigua.

**Acción:** corregirlo inmediatamente. Es documentación canónica de desarrollo y no debe contradecir Production.

---

# Hallazgos P1 — simplificación operativa

## P1.1 · Turno todavía expone demasiado la máquina de estados

Controles actuales relevantes:

- Abrir mi turno
- Sumar al turno
- Confirmar recepción
- Preparar entrega de turno
- Actualizar resumen automático
- Guardar nota para el turno siguiente
- Enviar entrega al turno siguiente
- Cerrar mi turno
- Cancelar preparación

La lógica v1.10.8 es correcta, pero el usuario todavía ve muchos pasos técnicos.

**Objetivo UX:**

### Entrada
`Iniciar turno → Recontar Caja / validar garantías → Confirmar recepción → Operar`

### Salida
`Iniciar cierre → Revisar pendientes → Cerrar Caja → Revisar entrega → Enviar y cerrar`

Los estados internos se conservan; la interfaz no necesita obligar al recepcionista a comprenderlos todos.

**Riesgo:** medio.

---

## P1.2 · Novedades mantiene vistas especializadas que pueden volver a fragmentar el flujo

El menú ya retiró Tareas, Incidencias, Alertas y Seguimientos como módulos raíz, lo cual es correcto.

Aun existen:
- `/tareas`
- `/incidencias`
- `/alertas`
- `/seguimientos`

y todas enlazan de vuelta al Libro.

**Recomendación:** tratarlas como **vistas especializadas internas**, no como destinos conceptuales independientes.

Para Recepción:
- Novedades
- Incidencias
- Mis tareas
- Historial

Alertas y seguimientos deberían aparecer sólo cuando sean la acción concreta que el sistema necesita que el usuario resuelva.

**Riesgo:** bajo.

---

## P1.3 · Llaves mezcla inventario diario y administración patrimonial

Controles actuales:
- Ingresar llave
- Guardar inventario del piso
- Confirmar entrega
- Confirmar devolución
- Guardar incidencia
- Reintegrar
- Confirmar baja

**Problema:** “Tomar inventario” —la tarea rutinaria— comparte superficie con operaciones de excepción.

**Simplificación:**
- vista predeterminada: **Tomar inventario**;
- acción secundaria: **Gestionar una llave**;
- alta, baja, recuperación y extravío dentro de esa gestión secundaria.

**Riesgo:** bajo/medio.

---

## P1.4 · Supervisión es demasiado ancha

La pantalla actual contiene simultáneamente:

- bandeja integrada;
- turno de Supervisión;
- tareas del equipo;
- seguimientos;
- notas;
- auditorías abiertas;
- medidas correctivas;
- comunicados obligatorios;
- rendimiento;
- entregas pendientes;
- accesos rápidos.

Acciones visibles incluyen:
- Iniciar turno
- Generar entrega
- Finalizar turno
- Confirmar recepción
- Guardar nota
- Eliminar lógicamente
- Crear medida y tarea
- Validar cierre
- Guardar observación
- asignaciones;
- recorridos/checklists;
- auditoría sorpresa.

**Simplificación recomendada:**

### Hoy
Sólo excepciones que requieren atención:
- cierres por validar;
- descuadres;
- incidencias críticas;
- tareas/seguimientos vencidos;
- auditorías activas.

### Equipo
Tareas, seguimientos, notas, comunicados y rendimiento.

### Control
Auditorías, medidas correctivas, informes y trazabilidad.

El supervisor no necesita ver “lo normal”; sólo desviaciones y herramientas de gestión.

**Riesgo:** medio.

---

## P1.5 · Administración muestra once puertas del mismo nivel

Secciones actuales:

1. Usuarios
2. Roles y permisos
3. Áreas
4. Fronti
5. Parámetros
6. Diagnóstico y reparación
7. Correo
8. Historial de turnos
9. Dejar el sistema en cero
10. Auditoría
11. Registros eliminados

**Problema:** una operación peligrosa como “Dejar el sistema en cero” tiene el mismo peso visual que Usuarios.

**Simplificación:**

### Personas y acceso
Usuarios · Roles · Áreas

### Sistema
Parámetros · Correo · Fronti

### Control
Auditoría · Historial de turnos · Registros eliminados

### Mantenimiento
Diagnóstico y reparación

### Zona de riesgo
Dejar el sistema en cero

**Riesgo:** bajo.

---

## P1.6 · Chat + FRONTI hace demasiados refrescos completos

En Production, `/api/chat/bootstrap` es con diferencia la ruta más solicitada de la muestra reciente.

El widget llama `loadBootstrap()`:
- al abrir;
- al recibir feed de notificaciones;
- ante eventos SSE;
- después de enviar;
- después de borrar;
- al crear chat;
- al modificar grupo;
- al crear grupo;
- tras adjuntos y otras mutaciones.

**Problema:** el stream en tiempo real dispara a menudo una recarga completa del bootstrap.

**Simplificación técnica:** bootstrap inicial + eventos delta/incrementales. Refrescar sólo la conversación afectada y sus contadores.

**Riesgo:** medio.

---

## P1.7 · @Fronti bloquea el POST del mensaje hasta que termina la inferencia

Actualmente el envío del mensaje y la invocación de FRONTI comparten la misma petición.

**Problema:** una inferencia lenta hace parecer que el mensaje humano tampoco se envió.

**Simplificación:** persistir el mensaje primero y responder `201`; invocar FRONTI como ejecución desacoplada y publicar su mensaje después mediante el stream de Chat.

**Riesgo:** medio. Debe preservar confirmaciones y permisos.

---

# Hallazgos P2 — higiene y deuda técnica

## P2.1 · Motor de Atención conserva un contrato de habitaciones ya retirado

`buildOperationalAttention()` todavía acepta `rooms`, y sus pruebas ejercitan habitaciones, aunque `dashboard.ts` le pasa siempre `rooms: []`.

También se conserva `roomsNeedingAction: []` sólo para mantener el contrato.

**Simplificación:** retirar ese eje del motor de atención y sus contadores cuando se confirme que no hay consumidor externo.

**Riesgo:** bajo.

---

## P2.2 · Indicadores es una página huérfana

`/indicadores` existe y calcula Tareas, Incidencias/Alertas y Turnos/Entregas, pero no forma parte de la navegación principal.

**Decisión recomendada:** o integrarlo dentro de Supervisión → Rendimiento, o retirarlo. No mantener dos superficies analíticas.

**Riesgo:** bajo.

---

## P2.3 · Informes de Supervisión es otra superficie aislada

`/supervision/informes` ofrece período, PDF y envío por correo, pero no está integrado como destino principal del Centro.

**Simplificación:** integrarlo dentro de **Control** en Supervisión.

**Riesgo:** bajo.

---

## P2.4 · Terminología ambigua en controles

Etiquetas que merecen precisión:

- Supervisión: **“Iniciar turno”** → “Iniciar turno de Supervisión”.
- Alertas: **“Marcar vista”** → “Marcar como vista”.
- Tareas/Registros: **“Actualizar estado”** es aceptable dentro del detalle, pero no como acción primaria sin mostrar el estado destino.
- Checklists: **“Guardar”**, **“Cerrar”**, **“Recorrer”** son demasiado genéricos.
- Administración: **“Depurar y reparar”** debe explicar previamente qué tipos de reparación puede ejecutar.

**Riesgo:** muy bajo.

---

# Inventario resumido de controles operativos

## Turnos
Abrir · sumar participante · recibir · preparar entrega · guardar nota · regenerar resumen · enviar entrega · cerrar · cancelar preparación.

## Novedades
Crear novedad/incidencia · editar · cambiar estado · cerrar seguimiento · eliminar/restaurar · comentar · enviar por correo.

## Tareas
Crear · checklist · cambiar estado · reasignar · editar · eliminar/restaurar.

## Alertas
Marcar vista · posponer · resolver · crear manual · recalcular motor.

## Caja
Arqueo · garantía entrada/salida · movimiento manual · regularización · reclasificación · gimnasio · anulación · transferencia Tesorería · dólar · cierre/reapertura formal.

## Llaves
Inventario · alta · entrega · devolución · incidencia · recuperación · baja.

## Supervisión
Turno propio · entrega/recepción · notas · tareas · seguimientos · asignaciones · auditorías · checklists · medidas correctivas · validación de cierres · comunicados · rendimiento · informes.

## Chat + FRONTI
Directos · grupos · roles de grupo · adjuntos · stickers · GIF · audio · editar/eliminar · responder · reaccionar · guardar · menciones · @todos · @turno · @Fronti · confirmaciones FRONTI.

## Administración
Usuarios · roles · áreas · FRONTI · parámetros · correo · diagnóstico · mantenimiento · turnos · auditoría · restauración · puesta en cero.

---

# Propuesta de versiones

## v1.10.9 — Higiene P0
- corregir documentación canónica;
- decidir y cerrar definitivamente rutas PMS profundas;
- resolver Cloudflare Workers AI;
- precisar textos ambiguos de muy bajo riesgo;
- ninguna reconstrucción.

## v1.11.0 — Simplificación de Recepción
- Turno como wizard guiado;
- Caja organizada por intención;
- Llaves con Inventario como flujo predeterminado;
- Novedades como superficie única de gestión;
- mantener servicios/tablas existentes.

## v1.12.0 — Supervisión por excepciones
- Hoy / Equipo / Control;
- integrar Indicadores + Informes;
- eliminar duplicaciones visuales;
- conservar todas las capacidades y auditoría.

## FRONTI Beta
Sólo después de:
- Cloudflare operativo;
- banco Alpha completo;
- prueba sostenida;
- @Fronti desacoplado del POST;
- memoria y web diseñadas sobre la interfaz ya consolidada.

---

# Criterio de simplificación obligatorio

Antes de añadir un botón o una página nueva, responder:

1. ¿El usuario ya puede hacer esto desde una superficie existente?
2. ¿Es una acción diaria o una excepción?
3. ¿Debe verla Recepción o sólo Supervisión/Administración?
4. ¿El nombre describe el resultado, no el mecanismo técnico?
5. ¿Puede automatizarlo el sistema sin pedir otro paso?
6. ¿Puede convertirse en un estado dentro de una ficha existente en vez de otro módulo?

Si las respuestas indican duplicación, **no se crea una nueva superficie**.
