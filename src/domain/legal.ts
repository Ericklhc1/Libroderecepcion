export const TERMS_DOCUMENT = 'TERMINOS_DESARROLLO_USO_INTERNO';
export const TERMS_VERSION = '2026-09-18.v1';
export const TERMS_TITLE = 'Términos y condiciones de desarrollo y uso interno';

export const AI_ATTRIBUTION =
  'Plataforma impulsada por LLM, desarrollada por Erick Herrera | Administradora de Recursos y Operaciones Hoteleras SpA';

export const TERMS_SECTIONS = [
  {
    title: '1. Finalidad de la plataforma',
    paragraphs: [
      'El Libro Operativo de Recepción es una plataforma interna de apoyo a la operación hotelera. Centraliza información, seguimiento, trazabilidad y acciones operativas, pero no sustituye las políticas internas, el PMS ni las instrucciones formales de la organización.',
    ],
  },
  {
    title: '2. Uso autorizado y credenciales',
    paragraphs: [
      'El acceso es personal. Cada usuario debe utilizar únicamente su propia cuenta y mantener sus credenciales bajo resguardo. Las acciones realizadas con una cuenta autenticada se atribuyen a esa cuenta para efectos de trazabilidad y auditoría.',
    ],
  },
  {
    title: '3. Información y confidencialidad',
    paragraphs: [
      'La plataforma puede contener información operativa, comercial y datos asociados a huéspedes, reservas, pagos, garantías, incidencias y personal. Esta información debe utilizarse exclusivamente para fines autorizados de operación y gestión.',
      'No debe copiarse, compartirse ni utilizarse fuera de los fines operativos autorizados.',
    ],
  },
  {
    title: '4. Responsabilidad operacional',
    paragraphs: [
      'El usuario debe verificar que las acciones que confirma reflejen la situación real del hotel. Los estados del sistema, el PMS, las llaves, las garantías, la Caja y los hechos físicos son fuentes distintas y no deben confundirse entre sí.',
      'Las acciones sensibles pueden requerir confirmación explícita, permisos adicionales o revisión de Supervisión.',
    ],
  },
  {
    title: '5. Inteligencia artificial y modelos de lenguaje',
    paragraphs: [
      'La plataforma puede utilizar modelos de lenguaje para interpretar instrucciones, resumir información, explicar estados, proponer prioridades y preparar acciones.',
      'La inteligencia artificial no reemplaza las reglas determinísticas del Libro ni constituye por sí sola una fuente de verdad. Puede cometer errores, omitir contexto o interpretar de forma incorrecta una instrucción.',
      'Las acciones sensibles o que modifiquen información operativa deben respetar los permisos, validaciones, confirmaciones y auditoría del sistema, aunque hayan sido propuestas por un modelo de lenguaje.',
    ],
  },
  {
    title: '6. Auditoría, seguridad y mejora continua',
    paragraphs: [
      'La plataforma registra acciones y eventos técnicos necesarios para seguridad, trazabilidad, investigación de errores y mejora de procesos.',
      'Los hallazgos técnicos u operativos detectados por Fronti pueden notificarse a Supervisor y Administrador de sistema para revisión.',
    ],
  },
  {
    title: '7. Desarrollo y cambios',
    paragraphs: [
      'La plataforma se encuentra en evolución continua. Las nuevas funciones se prueban en un entorno de staging antes de promoverse a Producción.',
      'Una modificación sustancial de estos términos puede generar una nueva versión y requerir una nueva aceptación al siguiente ingreso.',
    ],
  },
  {
    title: '8. Identificación del desarrollo',
    paragraphs: [
      AI_ATTRIBUTION,
    ],
  },
  {
    title: '9. Aceptación',
    paragraphs: [
      'Al aceptar estos términos, el usuario declara haberlos leído y comprender que el Libro Operativo es una herramienta interna de apoyo, sujeta a controles de seguridad, auditoría y mejora continua.',
    ],
  },
] as const;
