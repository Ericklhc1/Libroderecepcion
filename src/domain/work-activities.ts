import type { PermissionKey } from '@/lib/permissions';

export type WorkActivityPreset = {
  key: string;
  label: string;
  description: string;
  permissions: PermissionKey[];
  dependencies: string[];
  available: boolean;
};

/**
 * Ayuda de configuración: sólo prepara casillas del motor RBAC existente.
 * No autoriza, no crea excepciones y no reemplaza las comprobaciones del servidor.
 */
export const WORK_ACTIVITY_PRESETS: WorkActivityPreset[] = [
  {
    key: 'housekeeping-request',
    label: 'Solicitar servicio de Housekeeping',
    description: 'Permite registrar una necesidad y consultar su resultado sin convertir a la persona en ejecutora.',
    permissions: ['housekeeping.request'],
    dependencies: [
      'Cuenta activa y acceso al contexto de origen.',
      'Solicitar no concede limpiar, asignar ni inspeccionar.',
    ],
    available: true,
  },
  {
    key: 'housekeeping-work',
    label: 'Realizar limpieza',
    description: 'Permite ejecutar trabajos de Housekeeping asignados a la propia cuenta.',
    permissions: ['housekeeping.work'],
    dependencies: [
      'Cuenta operativa y área principal o pertenencia activa al área.',
      'La disponibilidad diaria se confirma por separado y no acredita asistencia.',
      'Realizar trabajo no concede inspeccionar el propio trabajo.',
    ],
    available: true,
  },
  {
    key: 'housekeeping-inspect',
    label: 'Inspeccionar habitaciones',
    description: 'Permite revisar trabajo de otras personas dentro del alcance del área.',
    permissions: ['housekeeping.inspect'],
    dependencies: [
      'Cuenta operativa y alcance del área.',
      'El servidor mantiene la separación entre ejecución e inspección; no habilita autoinspección.',
      'Una cobertura temporal vigente puede conceder esta función sin modificar el rol.',
    ],
    available: true,
  },
  {
    key: 'cash-guarantees',
    label: 'Operar garantías',
    description: 'Permite consultar Caja, registrar garantías y realizar devoluciones físicas autorizadas.',
    permissions: ['cash.view', 'cash.guarantee_in', 'cash.guarantee_out'],
    dependencies: [
      'En perfiles de Recepción, el estado de jornada/relevo se valida al ejecutar.',
      'No concede ingresos, egresos, transferencias, arqueos ni aprobación de Caja.',
    ],
    available: true,
  },
  {
    key: 'linen-management',
    label: 'Gestionar lencería',
    description: 'Se habilitará cuando Inventario/Lavandería tenga permisos canónicos propios.',
    permissions: [],
    dependencies: [
      'No se crea un permiso provisional ni una segunda fuente de autorización.',
    ],
    available: false,
  },
];
