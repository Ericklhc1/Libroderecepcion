# Operación práctica · AROH 1.42.0

## Llaves

Una toma guarda las 89 habitaciones de los pisos 4, 5 y 6. Iniciar, registrar excepciones en Detalle y confirmar las habitaciones visibles tras verificación física. Se puede confirmar por piso; el cierre sólo se habilita con las 89 revisadas. Cambiar de piso conserva el conteo; el borrador se recupera en la misma pestaña y usuario, si el navegador permite almacenamiento de sesión. No es una toma guardada hasta finalizar.

Físicas útiles, custodia conocida y fuera de servicio se registran por separado. Custodia exige identificación mediante observación; los faltantes exigen justificación. Guardar no cambia estados ni movimientos de llaves. Referencia única por envío evita duplicados; reusar la referencia con contenido distinto se rechaza.

Historial e impresión abre el documento propio de cada toma, con fecha, responsable, resumen, filas por piso, observaciones y firmas. Los conteos antiguos por piso se conservan identificados como históricos. Números de habitación y estados de custodia se congelan en la nueva toma.

## Colaboradores

Añadir usuario reutiliza una identidad por cuenta y conserva las demás áreas y referencia. Editar referencia global exige alcance sobre todas sus áreas. Cuenta activa, operativa y visible obligatoria para nuevas asignaciones. Las mallas y códigos históricos permanecen. Referencia semanal introducida en horas; persistencia histórica en minutos. No se configura ni deduce colación o descanso mínimo. Se mantienen controles de solape, ausencia y versión concurrente.

## Coordinación entre áreas

Nuevo aviso selecciona área y responsable opcional. Los responsables disponibles pertenecen al área y tienen housekeeping.manage; no se habilitan permisos automáticamente. Sin responsable, queda por tomar y se avisa a gestores del área habilitados. Tomar y comenzar registra responsable, recepción y gestión en una acción. Confirmar recepción sigue disponible si todavía no se inicia la tarea.

Derivar / relevar requiere área y motivo; conserva el aviso y su historial, vuelve a pendiente y exige recepción del siguiente responsable. Registrar resultado requiere evidencia y avisa al solicitante habilitado. El origen vinculado conserva su estado y contenido canónico; una edición exige volver a confirmar. Mis avisos, pendientes, historial y vinculación tienen accesos separados.

Campana interna y canales externos utilizan el despachador existente y sus preferencias. Sólo se notifica a cuentas activas, visibles y autorizadas a consultar Housekeeping. El cron existente avisa vencimientos a responsables y supervisores habilitados una vez por revisión; no resuelve ni confirma automáticamente. Sin plazo explícito no se inventa un vencimiento. Pendientes y bloqueos persisten entre turnos.

## Navegación

Listas principales usan desplazamiento de página, con desplazamiento horizontal en tablas. Los diálogos, ayuda y soporte comparten un bloqueo de desplazamiento que se libera cuando cierra la última ventana, independientemente del orden de cierre. No se eliminan los desplazamientos necesarios dentro de ventanas o del menú fijo.

## Publicación

Migración aditiva 20261001180000_operacion_practica. Sin eliminación de historiales ni expansión de permisos. Compuerta ejecuta migración, lint, tipos, pruebas PostgreSQL desechable y build antes de integrar. Verificación autenticada posterior a Production sin inventarios ficticios ni avisos operativos de prueba.
