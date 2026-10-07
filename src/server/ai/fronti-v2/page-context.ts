export type FrontiPageInput = {
  pathname: string;
  search?: string | null;
  hash?: string | null;
  title?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  label?: string | null;
};

export type FrontiResolvedPageContext = {
  pathname: string;
  search: string;
  hash: string;
  title: string | null;
  moduleKey: string;
  moduleLabel: string;
  sectionKey: string;
  sectionLabel: string;
  entityType: string | null;
  entityId: string | null;
  label: string | null;
  filters: Record<string, string>;
  recommendedTools: string[];
};

type RouteMatch = {
  moduleKey: string;
  moduleLabel: string;
  sectionKey: string;
  sectionLabel: string;
  entityType?: string | null;
  entityId?: string | null;
  recommendedTools?: string[];
};

const SENSITIVE_QUERY = /(password|passwd|secret|token|credential|api[_-]?key|auth|cookie|session)/i;

function cleanPath(pathname: string): string {
  const value = pathname.trim().split('?')[0]?.split('#')[0] || '/';
  if (value === '/') return '/';
  return value.replace(/\/+$/, '') || '/';
}

function cleanSearch(search: string | null | undefined): string {
  if (!search) return '';
  return search.startsWith('?') ? search.slice(1) : search;
}

function filtersFromSearch(search: string): Record<string, string> {
  const result: Record<string, string> = {};
  const params = new URLSearchParams(search);
  let count = 0;
  for (const [key, value] of params.entries()) {
    if (count >= 24) break;
    const safeKey = key.trim().slice(0, 80);
    if (!safeKey || SENSITIVE_QUERY.test(safeKey)) continue;
    const safeValue = value.trim().slice(0, 240);
    if (!safeValue) continue;
    result[safeKey] = safeValue;
    count += 1;
  }
  return result;
}

function detail(
  moduleKey: string,
  moduleLabel: string,
  sectionKey: string,
  sectionLabel: string,
  recommendedTools: string[],
  entityType?: string | null,
  entityId?: string | null,
): RouteMatch {
  return {
    moduleKey,
    moduleLabel,
    sectionKey,
    sectionLabel,
    recommendedTools,
    entityType: entityType ?? null,
    entityId: entityId ?? null,
  };
}

function matchRoute(pathname: string, filters: Record<string, string>): RouteMatch {
  if (pathname === '/') {
    return detail('inicio', 'Inicio', 'panorama', 'Panorama operativo', [
      'consultar_contexto_pantalla',
      'consultar_estado_operativo',
      'consultar_prioridades',
    ]);
  }

  if (pathname === '/jornada') {
    return detail('jornada', 'Mi jornada', 'jefatura', 'Jornada de jefatura por área', [
      'consultar_contexto_pantalla',
    ]);
  }

  if (pathname === '/buscar') {
    return detail('buscar', 'Búsqueda global', 'resultados', 'Resultados de búsqueda', [
      'consultar_contexto_pantalla',
    ]);
  }

  const libroDetail = pathname.match(/^\/libro\/([^/]+)$/);
  if (libroDetail) {
    return detail('novedades', 'Novedades', 'detalle', 'Detalle de registro', [
      'consultar_contexto_pantalla',
      'consultar_novedades',
    ], 'OperationalEntry', libroDetail[1] ?? null);
  }
  if (pathname === '/libro') {
    if (filters.clase === 'task') {
      return detail('tareas', 'Novedades', 'tareas', 'Mis tareas', [
        'consultar_contexto_pantalla',
        'consultar_tareas',
      ]);
    }
    if (filters.tipo === 'INCIDENCIA') {
      return detail('novedades', 'Novedades', 'incidencias', 'Incidencias', [
        'consultar_contexto_pantalla',
        'consultar_novedades',
      ]);
    }
    return detail('novedades', 'Novedades', 'bandeja', 'Novedades', [
      'consultar_contexto_pantalla',
      'consultar_novedades',
    ]);
  }
  if (pathname === '/custodia') {
    return detail('custodia', 'Novedades', 'objetos-olvidados', 'Objetos olvidados y custodia', [
      'consultar_contexto_pantalla',
    ]);
  }

  if (pathname === '/incidencias') {
    return detail('novedades', 'Novedades', 'incidencias-especializadas', 'Incidencias', [
      'consultar_contexto_pantalla',
      'consultar_novedades',
    ]);
  }

  const taskDetail = pathname.match(/^\/tareas\/([^/]+)$/);
  if (taskDetail) {
    return detail('tareas', 'Tareas', 'detalle', 'Detalle de tarea', [
      'consultar_contexto_pantalla',
      'consultar_tareas',
    ], 'Task', taskDetail[1] ?? null);
  }
  if (pathname === '/tareas') {
    return detail('tareas', 'Tareas', 'bandeja', 'Tareas', [
      'consultar_contexto_pantalla',
      'consultar_tareas',
    ]);
  }
  if (pathname === '/seguimientos') {
    return detail('seguimientos', 'Seguimientos', 'bandeja', 'Seguimientos', [
      'consultar_contexto_pantalla',
      'consultar_seguimientos',
    ]);
  }
  if (pathname === '/alertas') {
    return detail('avisos', 'Alertas', 'bandeja', 'Alertas programadas', [
      'consultar_contexto_pantalla',
      'consultar_alertas',
    ]);
  }
  if (pathname === '/alertas/sistema') {
    return detail(
      'senales-internas',
      'Señales internas',
      'bandeja',
      'Autorizaciones y validaciones internas',
      ['consultar_contexto_pantalla'],
    );
  }
  if (pathname === '/historial') {
    return detail('historial', 'Historial', 'archivo', 'Historial y búsqueda', [
      'consultar_contexto_pantalla',
    ]);
  }
  if (pathname === '/notificaciones') {
    return detail('notificaciones', 'Notificaciones', 'centro', 'Notificaciones', [
      'consultar_contexto_pantalla',
    ]);
  }

  const reservationCode = pathname.match(/^\/reservas\/([^/]+)$/);
  if (reservationCode) {
    return detail('reservas', 'Reservas', 'detalle', 'Detalle de reserva', [
      'consultar_contexto_pantalla',
      'consultar_garantias',
    ], 'ReservationCode', decodeURIComponent(reservationCode[1] ?? ''));
  }
  if (pathname === '/reservas') {
    return detail('reservas', 'Reservas', 'retirada', 'Ruta de reservas retirada', [
      'consultar_contexto_pantalla',
    ]);
  }

  const guestReservation = pathname.match(/^\/huespedes\/reservas\/([^/]+)$/);
  if (guestReservation) {
    return detail('reservas', 'Reservas', 'detalle-interno', 'Detalle de reserva', [
      'consultar_contexto_pantalla',
      'consultar_garantias',
    ], 'ReservationReference', guestReservation[1] ?? null);
  }
  if (pathname === '/huespedes/nueva-reserva') {
    return detail('reservas', 'Reservas', 'nueva', 'Nueva referencia de reserva', [
      'consultar_contexto_pantalla',
    ]);
  }
  if (pathname === '/huespedes/importar') {
    return detail('reservas', 'Reservas', 'importar', 'Importar referencias', [
      'consultar_contexto_pantalla',
    ]);
  }
  if (pathname === '/huespedes') {
    return detail('reservas', 'Reservas', 'retirada-huespedes', 'Ruta de huéspedes retirada', [
      'consultar_contexto_pantalla',
    ]);
  }

  const roomDetail = pathname.match(/^\/habitaciones\/([^/]+)$/);
  if (roomDetail && roomDetail[1] !== 'importar') {
    return detail('habitaciones', 'Habitaciones', 'detalle', 'Detalle de habitación', [
      'consultar_contexto_pantalla',
      'consultar_habitacion',
    ], 'RoomNumber', decodeURIComponent(roomDetail[1] ?? ''));
  }
  if (pathname === '/habitaciones/importar') {
    return detail('habitaciones', 'Habitaciones', 'importar', 'Importación de habitaciones', [
      'consultar_contexto_pantalla',
    ]);
  }
  if (pathname === '/habitaciones') {
    return detail('habitaciones', 'Habitaciones', 'retirada', 'Ruta de habitaciones retirada', [
      'consultar_contexto_pantalla',
    ]);
  }

  const cashAudit = pathname.match(/^\/caja\/arqueos\/([^/]+)$/);
  if (cashAudit) {
    return detail('caja', 'Caja', 'arqueo-detalle', 'Detalle de arqueo', [
      'consultar_contexto_pantalla',
      'consultar_caja',
    ], 'CashAudit', cashAudit[1] ?? null);
  }
  if (pathname === '/caja/cierre') {
    return detail('caja', 'Caja', 'cierre', 'Cierre de Caja', [
      'consultar_contexto_pantalla',
      'consultar_caja',
      'consultar_garantias',
    ]);
  }
  if (pathname === '/caja/gimnasio') {
    return detail('caja', 'Caja', 'gimnasio', 'Folios de gimnasio', [
      'consultar_contexto_pantalla',
      'consultar_caja',
    ]);
  }
  if (pathname === '/caja') {
    const section = filters.seccion || 'general';
    const tools = ['consultar_contexto_pantalla', 'consultar_caja'];
    if (section === 'garantias') tools.push('consultar_garantias');
    return detail('caja', 'Caja', section, section === 'garantias' ? 'Garantías' : section === 'movimientos' ? 'Movimientos' : section === 'auditorias' ? 'Arqueos' : section === 'gimnasio' ? 'Gimnasio' : section === 'estacionamiento' ? 'Estacionamiento' : 'Vista general', tools);
  }

  const handover = pathname.match(/^\/turno\/entrega\/([^/]+)$/);
  if (handover) {
    return detail('turno', 'Mi turno', 'entrega', 'Entrega de turno', [
      'consultar_contexto_pantalla',
      'consultar_turnos',
      'consultar_caja',
    ], 'ShiftHandover', handover[1] ?? null);
  }
  if (pathname === '/turno/cambios') return detail('cambios-turno', 'Mi turno', 'cambios', 'Qué cambió desde mi último turno', ['consultar_contexto_pantalla']);
  if (pathname === '/turno') {
    return detail('turno', 'Mi turno', 'estado', 'Estado y continuidad', [
      'consultar_contexto_pantalla',
      'consultar_turnos',
      'consultar_caja',
    ]);
  }

  const staffLoan = pathname.match(/^\/llaves\/personal\/([^/]+)$/);
  if (staffLoan) return detail('llaves', 'Llaves', 'entrega-personal', 'Entrega de llaves a personal', ['consultar_contexto_pantalla'], 'KeyStaffLoan', staffLoan[1] ?? null);
  if (pathname === '/llaves/personal') return detail('llaves', 'Llaves', 'personal', 'Áreas y entregas a personal', ['consultar_contexto_pantalla','consultar_llaves']);
  const keyCount = pathname.match(/^\/llaves\/inventarios\/([^/]+)$/);
  if (keyCount) return detail('llaves', 'Llaves', 'inventario-guardado', 'Inventario guardado e impresión', ['consultar_contexto_pantalla', 'consultar_llaves'], 'KeyInventoryCount', keyCount[1] ?? null);
  if (pathname === '/llaves') {
    return detail('llaves', 'Llaves', filters.piso ? `piso-${filters.piso}` : 'inventario', filters.piso ? `Inventario piso ${filters.piso}` : 'Inventario de llaves', [
      'consultar_contexto_pantalla',
      'consultar_llaves',
    ]);
  }
  if (pathname === '/avisos') {
    return detail('avisos', 'Alertas', 'redireccion', 'Ruta anterior de alertas', [
      'consultar_contexto_pantalla',
      'consultar_vencimientos',
    ]);
  }
  if (pathname === '/central-reservas') {
    return detail(
      'novedades-habitacion',
      'Novedades / habitación',
      'redireccion',
      'Ruta anterior de Central de Reservas',
      ['consultar_contexto_pantalla'],
    );
  }
  if (pathname === '/novedades/habitacion') {
    return detail(
      'novedades-habitacion',
      'Novedades / habitación',
      filters.habitacion ? `Hab. ${filters.habitacion}` : '89 habitaciones',
      'Monitor operacional por habitación',
      [
        'consultar_contexto_pantalla',
        'consultar_prioridades',
        'consultar_caja',
        'consultar_garantias',
        'consultar_llaves',
      ],
    );
  }

  if (pathname === '/inventario') {
    return detail('inventario', 'Inventario', 'estado', 'Inventario común', [
      'consultar_contexto_pantalla',
    ]);
  }
  if (pathname === '/lavanderia') {
    return detail('lavanderia', 'Inventario', 'lavanderia', 'Lavandería', [
      'consultar_contexto_pantalla',
    ]);
  }

  if (pathname === '/indicadores') {
    return detail('indicadores', 'Indicadores', filters.dias ? `${filters.dias}d` : '30d', 'Indicadores operativos', [
      'consultar_contexto_pantalla',
      'consultar_prioridades',
    ]);
  }
  if (pathname === '/gerencia/evidencia') {
    return detail('gerencia', 'Gerencia', 'evidencia', 'Evidencia gerencial de sólo lectura', ['consultar_contexto_pantalla']);
  }
  if (pathname === '/gerencia') {
    return detail('gerencia', 'Gerencia', filters.dias ? `${filters.dias}d` : '30d', 'Cockpit estratégico de Gerencia', [
      'consultar_contexto_pantalla',
      'consultar_prioridades',
      'consultar_supervision',
      'consultar_caja',
      'consultar_garantias',
      'consultar_llaves',
      'consultar_turnos',
      'consultar_auditoria',
    ]);
  }

  if (pathname === '/supervision/documentos') return detail('supervision', 'Centro de Supervisión', 'documentos-locales', 'Revisión documental local sin persistencia central', ['consultar_contexto_pantalla']);
  if (pathname === '/supervision') {
    return detail('supervision', 'Centro de Supervisión', 'centro', 'Centro de Supervisión', [
      'consultar_contexto_pantalla',
      'consultar_supervision',
    ]);
  }
  if (pathname === '/supervision/tablero') {
    return detail('supervision', 'Centro de Supervisión', 'tablero', 'Tablero de asignación', [
      'consultar_contexto_pantalla',
      'consultar_supervision',
      'consultar_tareas',
      'consultar_seguimientos',
    ]);
  }
  if (pathname === '/supervision/auditorias') {
    return detail('supervision', 'Centro de Supervisión', 'auditorias', 'Auditorías de Supervisión', [
      'consultar_contexto_pantalla',
      'consultar_supervision',
      'consultar_auditoria',
    ]);
  }
  if (pathname === '/supervision/informes') {
    return detail('supervision', 'Centro de Supervisión', 'informes', 'Informes de Supervisión', [
      'consultar_contexto_pantalla',
      'consultar_supervision',
    ]);
  }
  if (pathname === '/supervision/rendimiento') {
    return detail('supervision', 'Centro de Supervisión', 'rendimiento', 'Rendimiento operativo', [
      'consultar_contexto_pantalla',
      'consultar_supervision',
    ]);
  }
  if (pathname === '/supervision/salud') {
    return detail('supervision', 'Centro de Supervisión', 'salud', 'Salud operativa', [
      'consultar_contexto_pantalla',
      'consultar_supervision',
    ]);
  }

  const auditResult = pathname.match(/^\/auditorias\/resultados\/([^/]+)$/);
  if (auditResult) {
    return detail('auditorias', 'Auditorías', 'resultado', 'Resultado de auditoría', [
      'consultar_contexto_pantalla',
      'consultar_auditoria',
    ], 'ChecklistRun', auditResult[1] ?? null);
  }

  if (pathname === '/equipo') {
    const sections: Record<string, string> = { calendario: 'Calendario del equipo', colaboradores: 'Colaboradores por área', plantillas: 'Tipos de turno', cobertura: 'Cobertura mínima', configuracion: 'Alcance y feriados' };
    const section = filters.seccion && sections[filters.seccion] ? filters.seccion : 'calendario';
    return detail('equipo', 'Equipo y horarios', section, sections[section]!, ['consultar_contexto_pantalla', 'consultar_horarios'], filters.malla ? 'SchedulePlan' : null, filters.malla ?? null);
  }

  if (pathname === '/perfil') {
    return detail('perfil', 'Mi cuenta', 'perfil', 'Mi perfil', [
      'consultar_contexto_pantalla',
    ]);
  }

  if (pathname === '/fronti/procedimientos') return detail('fronti-procedimientos', 'Fronti', 'ejecuciones', 'Mis procedimientos', ['consultar_contexto_pantalla', 'consultar_procedimientos']);
  if (pathname === '/coordinacion/indicadores') return detail('indicadores-operativos', 'Coordinación', 'indicadores', 'Resumen e indicadores', ['consultar_contexto_pantalla']);
  if (pathname === '/coordinacion/automatizaciones') return detail('automatizaciones', 'Coordinación', 'politicas', 'Reglas y procedimientos', ['consultar_contexto_pantalla']);
  if (pathname === '/coordinacion/areas') return detail('coordinacion', 'Coordinación', 'areas', 'Bandeja de revisión por áreas', ['consultar_contexto_pantalla']);
  if (pathname === '/coordinacion') return detail('coordinacion', 'Coordinación', 'pendientes', 'Coordinación y continuidad', ['consultar_contexto_pantalla']);

  if (pathname === '/admin') {
    return detail('administracion', 'Administración', 'inicio', 'Inicio de Administración', [
      'consultar_contexto_pantalla',
      'consultar_configuracion_operativa',
    ]);
  }
  const adminMap: Record<string, [string, string, string[]]> = {
    '/admin/areas': ['areas', 'Áreas', ['consultar_contexto_pantalla', 'consultar_configuracion_operativa']],
    '/admin/auditoria': ['auditoria', 'Auditoría', ['consultar_contexto_pantalla', 'consultar_auditoria']],
    '/admin/correo': ['correo', 'Correo', ['consultar_contexto_pantalla']],
    '/admin/diagnostico': ['diagnostico', 'Diagnóstico y reparación', ['consultar_contexto_pantalla', 'consultar_auditoria']],
    '/admin/mantenimiento': ['mantenimiento', 'Modo mantenimiento', ['consultar_contexto_pantalla']],
    '/admin/limpieza': ['limpieza', 'Limpiar datos de prueba', ['consultar_contexto_pantalla']],
    '/admin/eliminados': ['eliminados', 'Papelera / eliminados', ['consultar_contexto_pantalla', 'consultar_auditoria']],
    '/admin/fronti': ['fronti', 'Fronti', ['consultar_contexto_pantalla', 'consultar_configuracion_operativa']],
    '/admin/parametros': ['parametros', 'Parámetros', ['consultar_contexto_pantalla', 'consultar_configuracion_operativa']],
    '/admin/puesta-en-cero': ['puesta-en-cero', 'Puesta en cero', ['consultar_contexto_pantalla']],
    '/admin/roles': ['roles', 'Roles y permisos', ['consultar_contexto_pantalla', 'consultar_usuarios']],
    '/admin/soporte': ['soporte', 'Reportes y solicitudes', ['consultar_contexto_pantalla']],
    '/housekeeping': ['housekeeping', 'Housekeeping', ['consultar_contexto_pantalla']],
    '/admin/housekeeping': ['housekeeping', 'Housekeeping · ruta anterior', ['consultar_contexto_pantalla']],
    '/admin/turnos': ['turnos', 'Historial de turnos', ['consultar_contexto_pantalla', 'consultar_turnos', 'consultar_auditoria']],
    '/admin/usuarios': ['usuarios', 'Usuarios', ['consultar_contexto_pantalla', 'consultar_usuarios']],
  };
  const admin = adminMap[pathname];
  if (admin) {
    return detail('administracion', 'Administración', admin[0], admin[1], admin[2]);
  }

  return detail('desconocido', 'Otra pantalla', 'desconocido', 'Pantalla no catalogada', [
    'consultar_contexto_pantalla',
  ]);
}

export function resolveFrontiPageContext(input: FrontiPageInput): FrontiResolvedPageContext {
  const pathname = cleanPath(input.pathname);
  const search = cleanSearch(input.search);
  const filters = filtersFromSearch(search);
  const matched = matchRoute(pathname, filters);

  return {
    pathname,
    search,
    hash: (input.hash ?? '').trim().slice(0, 200),
    title: input.title?.trim().slice(0, 240) || null,
    moduleKey: matched.moduleKey,
    moduleLabel: matched.moduleLabel,
    sectionKey: matched.sectionKey,
    sectionLabel: matched.sectionLabel,
    entityType: input.entityType?.trim().slice(0, 120) || matched.entityType || null,
    entityId: input.entityId?.trim().slice(0, 200) || matched.entityId || null,
    label: input.label?.trim().slice(0, 300) || null,
    filters,
    recommendedTools: Array.from(new Set(matched.recommendedTools ?? ['consultar_contexto_pantalla'])),
  };
}

export function isCataloguedFrontiPage(pathname: string, search = ''): boolean {
  return resolveFrontiPageContext({ pathname, search }).moduleKey !== 'desconocido';
}
