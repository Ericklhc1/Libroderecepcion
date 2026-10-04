export const UX_ACTIONS = ['ASSIGN','RECEIVE','START','FINISH','BLOCK','VALIDATE','RETURN','RESULT','REMIND','MORE','INFORM','REQUEST_ATTENTION','ADVANCED','OTHER'] as const;
export const UX_ROUTES = ['inicio','asunto','tarea','libro','tareas','incidencias','seguimientos','coordinacion','habitacion','housekeeping','supervision','gerencia','turno','caja','llaves','avisos','fronti'] as const;
export type UxEvent = {
  intentId:string;event:'ROUTE'|'ACTION'|'RESULT'|'EXIT';route:(typeof UX_ROUTES)[number];
  entityType?:'OperationalEntry'|'Task'|'Room';entityId?:string;
  selectedAction?:(typeof UX_ACTIONS)[number];visibleActions?:Array<(typeof UX_ACTIONS)[number]>;
  result?:'SUCCESS'|'FAILED'|'LEFT'|'PENDING';duration?:number;backNavigation?:boolean;
};

/** Sólo categorías y folios internos: nunca query strings ni texto de formularios. */
export function uxRoute(path:string):Pick<UxEvent,'route'|'entityType'|'entityId'>|null {
  const detail=/^\/(libro|tareas)\/([a-z0-9]{20,40})$/.exec(path);
  if(detail)return {route:detail[1]==='libro'?'asunto':'tarea',entityType:detail[1]==='libro'?'OperationalEntry':'Task',entityId:detail[2]};
  if(path==='/')return {route:'inicio'};
  const known:Record<string,UxEvent['route']>={'/libro':'libro','/tareas':'tareas','/incidencias':'incidencias','/seguimientos':'seguimientos','/coordinacion':'coordinacion','/novedades/habitacion':'habitacion','/admin/housekeeping':'housekeeping','/supervision':'supervision','/gerencia':'gerencia','/turno':'turno','/caja':'caja','/llaves':'llaves','/alertas':'avisos','/notificaciones':'avisos'};
  return known[path]?{route:known[path]}:null;
}

export function uxAction(label:string):UxEvent['selectedAction'] {
  const known:Record<string,NonNullable<UxEvent['selectedAction']>>={
    'Asignar':'ASSIGN','Reasignar':'ASSIGN','Confirmar recepción':'RECEIVE','Comenzar atención':'START','Finalizar':'FINISH','Resolver':'FINISH','Informar impedimento':'BLOCK','Resolver impedimento':'BLOCK','Validar':'VALIDATE','Devolver':'RETURN','Ver resultado':'RESULT','Continuar atención':'START','Recordarme':'REMIND','Recordarme después':'REMIND','Más ···':'MORE','Informar algo':'INFORM','Necesito atención / derivar':'REQUEST_ATTENTION','Registro avanzado':'ADVANCED','Solicitar otra atención':'REQUEST_ATTENTION','Solicitar atención':'REQUEST_ATTENTION',
  };
  return known[label.trim()]??'OTHER';
}
