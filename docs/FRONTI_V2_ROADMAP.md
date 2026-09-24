# FRONTI v2 — Plan de implementación y despliegue gradual

## Objetivo

Reconstruir FRONTI como agente operativo contextual del Libro, capaz de consultar transversalmente el sistema, razonar en varios pasos, mantener memoria útil y participar como actor nativo del chat.

FRONTI v2 no debe convertirse en un usuario humano ficticio ni disponer de acceso SQL arbitrario. Debe operar mediante servicios y herramientas tipadas del Libro, con trazabilidad, permisos y confirmaciones.

## Política de activación por usuario

El acceso a FRONTI se controla por usuario desde Administración.

- Administrador de sistema: siempre activo.
- @eherrera: activo desde la primera etapa.
- Resto de cuentas: desactivado por defecto.
- Cada ampliación de usuarios se realiza manualmente desde la consola de Fronti.
- Ocultar el componente no basta: la API también debe bloquear cuentas no habilitadas.
- La habilitación por usuario funciona como feature flag de despliegue gradual.

## Release 2.0.0-alpha — Núcleo del agente

### Alcance

1. Crear un nuevo núcleo de orquestación multi-paso.
2. Construir un Context Builder común que entregue:
   - usuario y rol;
   - permisos;
   - turno operativo;
   - fecha/hora operativa;
   - ruta/pantalla actual;
   - entidad seleccionada cuando exista;
   - conversación activa;
   - mensaje citado cuando la consulta nazca desde chat.
3. Crear un Tool Registry central.
4. Mapear capacidades de lectura de:
   - Turnos;
   - Novedades/Incidencias;
   - Caja;
   - Garantías;
   - Llaves;
   - Tareas;
   - Seguimientos;
   - Supervisión;
   - Habitaciones/estadías cuando existan como contexto;
   - alertas y notificaciones;
   - auditoría;
   - usuarios y roles;
   - configuración operativa segura.
5. FRONTI puede encadenar varias consultas antes de responder.
6. Mantener confirmación explícita para acciones de escritura.
7. Mantener auditoría de cada acción.
8. Añadir telemetría del agente:
   - proveedor/modelo;
   - herramientas usadas;
   - duración;
   - resultado;
   - causa de error.
9. Banco de pruebas funcional con consultas reales del hotel.
10. El FRONTI v1 queda disponible como fallback técnico durante alpha.

### No incluido todavía

- memoria semántica/vectorial;
- ingestión documental completa;
- FRONTI como actor nativo de grupos;
- transcripción de audio;
- ejecución autónoma en segundo plano.

### Criterio de aprobación alpha

No se promueve a beta hasta cumplir, como mínimo:

- responde correctamente consultas transversales sobre varios módulos;
- no responde “no puedo” cuando el dato existe y hay una herramienta disponible;
- no inventa estados operativos;
- verifica hechos cambiantes en el Libro;
- ninguna escritura evita permisos o confirmaciones;
- cero regresiones en Recepción;
- pruebas end-to-end del banco FRONTI en verde;
- uso estable por Administrador de sistema y @eherrera.

## Release 2.0.0-beta — Memoria y conocimiento

### Alcance

1. Separar tres niveles de memoria:
   - conversación;
   - turno;
   - conocimiento persistente.
2. Incorporar búsqueda semántica en Neon.
3. Añadir embeddings para recuerdos y conocimiento interno.
4. R2 conserva objetos originales:
   - PDF;
   - imágenes;
   - audio;
   - capturas;
   - adjuntos.
5. Neon conserva:
   - texto extraído;
   - metadatos;
   - embeddings;
   - referencias al objeto R2.
6. Añadir controles de memoria:
   - “no guardes esto”;
   - olvidar conversación;
   - eliminar/corregir memoria;
   - caducidad por tipo.
7. Añadir memoria compartida de turno con trazabilidad.
8. Evaluar proveedores con un benchmark común:
   - Groq;
   - OpenAI;
   - vLLM/autohospedado cuando corresponda.
9. Elegir proveedor primario por calidad de tool-calling, precisión, latencia y costo; mantener fallback.

### Criterio de aprobación beta

- recupera contexto relevante aunque cambie la redacción;
- distingue memoria de fuente de verdad;
- no persiste secretos ni datos prohibidos por las reglas internas;
- documentos subidos pueden ser consultados posteriormente;
- benchmark documentado y proveedor principal seleccionado;
- estabilidad confirmada por el grupo piloto.

## Release 2.0.0-rc — FRONTI dentro del chat

### Alcance

1. Crear FRONTI como actor de sistema, no como usuario humano.
2. Chat directo FRONTI disponible para usuarios habilitados.
3. FRONTI aparece como:
   - nombre propio;
   - avatar;
   - estado;
   - indicador de agente.
4. Permitir añadir FRONTI a grupos.
5. Activación mediante:
   - @Fronti;
   - responder un mensaje de FRONTI;
   - acción “Preguntar a FRONTI”.
6. Contexto del grupo limitado y relevante.
7. FRONTI no interviene espontáneamente en todas las conversaciones.
8. Soporte para mensajes citados, imágenes, archivos y capturas.
9. Notas de voz:
   - reproductor embebido estilo mensajería;
   - transcripción opcional;
   - posibilidad de usar la transcripción como entrada para FRONTI.
10. Sustituir el widget flotante antiguo por un atajo al chat de FRONTI cuando la experiencia nueva esté validada.

### Criterio de aprobación RC

- interacción directa y grupal estable;
- @Fronti funciona en tiempo real;
- no duplica respuestas;
- el contexto de grupos no contamina memorias personales;
- permisos y confirmaciones siguen ligados al usuario invocante;
- multimedia operativa sin salir del chat.

## Release 2.0.0 — Producción estable

### Alcance

1. FRONTI v2 pasa a ser la implementación principal.
2. Retirar el núcleo v1 que ya no sea necesario.
3. Mantener proveedor secundario como fallback.
4. Documentación operativa para Administrador de sistema y Supervisión.
5. Panel de salud:
   - proveedor;
   - latencia;
   - fallos;
   - herramientas;
   - memoria;
   - R2;
   - vector search.
6. Activación de nuevos usuarios sigue siendo manual desde Management.
7. No habilitar masivamente FRONTI sin aprobación explícita.

## Evolución posterior a 2.0

Posibles etapas posteriores, sujetas a aprobación:

- análisis multimodal más profundo;
- resúmenes programados;
- sugerencias proactivas;
- detección de anomalías;
- búsqueda documental avanzada;
- voz bidireccional;
- automatizaciones operativas con aprobación;
- evaluación continua del rendimiento del agente.

## Principios no negociables

1. GitHub + Vercel + Neon siguen siendo fuente de verdad técnica.
2. R2 almacena objetos; Neon almacena conocimiento estructurado y semántico.
3. FRONTI consulta servicios del Libro antes de afirmar hechos cambiantes.
4. No SQL arbitrario generado por el modelo.
5. Ninguna escritura sin controles del sistema.
6. Todo cambio relevante queda auditado.
7. El Administrador de sistema tiene FRONTI siempre disponible.
8. El rollout por usuario se conserva durante todo FRONTI v2.


### Estado alpha.4 — Router de modelos

Durante el piloto alpha se adopta un router automático:

1. OpenAI GPT-5.6 Sol como cerebro principal cuando exista credencial OpenAI válida.
2. Groq GPT-OSS 120B como fallback de proveedor/modelo.
3. Groq GPT-OSS 20B como fallback de continuidad ante saturación y para tareas auxiliares.
4. OpenAI GPT-5.6 Luna puede asumir tareas auxiliares si Groq no está disponible.

La extracción de memoria deja de ejecutarse después de cada consulta. Sólo se intenta cuando el mensaje contiene una intención durable de recordar, una preferencia o una regla. Esto evita gastar capacidad del modelo principal en mantenimiento de memoria.

El router no requiere redeploy para empezar a usar OpenAI: al guardar una credencial OpenAI válida en Administración > Fronti, Sol pasa automáticamente a ser el primer proveedor de la cadena.
