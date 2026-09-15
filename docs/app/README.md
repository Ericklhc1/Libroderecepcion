# Versión alojada (aplicación de una página)

`libro-operativo-app.html` es la versión del Libro Operativo que está **en uso
real**, publicada como página interna en claude.ai con base de datos
compartida y persistente.

Es el mismo producto que la aplicación Next.js de este repositorio —mismo
modelo, misma máquina de estados de turno, misma matriz de permisos, mismo
motor de alertas— implementado sobre el almacén de documentos del artefacto en
lugar de PostgreSQL. Se eligió esta vía porque no requiere infraestructura:
el equipo abre un enlace y opera.

## Diferencias respecto de la aplicación Next.js

| | Alojada (esta) | Next.js (`src/`) |
| --- | --- | --- |
| Puesta en marcha | Abrir el enlace | Servidor + PostgreSQL |
| Acceso | Miembros de la organización con el enlace | Correo y contraseña |
| Identidad | Se elige en el mesón y el dispositivo la recuerda | Sesión autenticada con bcrypt |
| Permisos | Matriz en la aplicación + dos niveles de la plataforma | Verificados en el servidor en cada acción |
| Capacidad | 5.000 documentos, con archivado | Sin límite práctico |

## Niveles de acceso de la plataforma

Las reglas declaradas al publicar establecen una frontera real, verificada:

```
{ path: "",       read: "interact", write: "interact" }   // operar el libro
{ path: "config", read: "interact", write: "admin"    }   // parámetros y permisos
{ path: "staff",  read: "interact", write: "admin"    }   // personal
```

- Compartir como **«puede ver»**: la persona opera el libro completo (registros,
  incidencias, tareas, turnos, entregas, alertas) pero no puede alterar el
  personal ni la matriz de permisos.
- Compartir como **«puede editar»**: además administra personal y configuración.

## Datos

- Un documento por registro, tarea, seguimiento, alerta, turno y entrega.
- Comentarios y checklists viven dentro de su documento, para no multiplicarlos.
- Auditoría: un documento por día y persona, de modo que dos personas
  escribiendo a la vez no se sobrescriban.
- Las alertas automáticas usan su clave de deduplicación como identificador de
  documento: el almacén garantiza que no haya duplicados sin transacciones.
- Los números visibles (#12, T#7) se derivan del orden de creación, no de un
  contador compartido, porque las escrituras se resuelven por última-gana.

## Pruebas

`db-doble-de-pruebas.js` implementa el contrato del almacén (`doc`,
`collection`, `get`/`set`/`update`/`delete`, `onSnapshot`, `acquire`, paridad
de rutas) en memoria y con persistencia en el navegador. Insertándolo antes del
script de la aplicación se puede ejecutar y verificar el ciclo completo en
local, incluido el caso de dos dispositivos compartiendo la misma base.
