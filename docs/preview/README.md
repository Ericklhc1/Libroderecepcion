# Preview operativa

`libro-operativo.html` es una preview autocontenida del sistema: una sola
página que reproduce el modelo, la máquina de estados del turno, la matriz de
permisos y el motor de alertas de la aplicación real, ejecutándose por completo
en el navegador.

Sirve para recorrer los flujos y validar la experiencia operativa sin
levantar la base de datos: abrir el archivo en cualquier navegador basta.

Qué se puede hacer en ella:

- Iniciar sesión con cualquiera de las cinco cuentas de demostración, con las
  mismas reglas que la aplicación: mensaje de error genérico que no revela si
  el correo existe, y bloqueo temporal tras cinco intentos fallidos.
- Recorrer el ciclo completo del turno: iniciar, recibir la entrega anterior,
  registrar novedades, preparar la entrega (con resumen automático), agregar
  notas manuales, enviarla y cerrar el turno.
- Comprobar las reglas: intentar cerrar el turno sin entregar, recibir dos
  veces la misma entrega o cerrar una incidencia sin resolución devuelve el
  mismo mensaje que la aplicación.
- Cambiar de usuario (recepcionista, supervisor, auditor nocturno,
  administrador) y ver cómo cambian el menú y las acciones disponibles.
- Editar la matriz de permisos y observar el efecto de inmediato.
- Crear novedades, incidencias, tareas y seguimientos; marcar checklists;
  gestionar alertas; consultar indicadores calculados en vivo.

El estado se guarda en el navegador de cada visitante y se reinicia con el
botón «Reiniciar preview». No hay servidor ni datos compartidos: es una
preview, no el sistema en producción.
