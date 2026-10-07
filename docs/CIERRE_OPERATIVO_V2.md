> Vigente desde 1.64.0: la validación posterior es una acción del mismo Shift en el Centro de Supervisión, no una tarea/alerta operativa. Recepción no hereda tareas ni acciones de Supervisión; la visibilidad por área y en entrega es explícita y auditada. Diseño y pruebas de impresión: [IMPRESION_ENTREGA_1_64.md](IMPRESION_ENTREGA_1_64.md). Las referencias anteriores a publicación de tareas/alertas de validación se conservan como historia y quedan sustituidas por esta regla.

# Cierre Operativo — contrato vigente de Recepción

Estado: **vigente para Libro 1.14.9**.  
Fuente de verdad superior: `PROJECT_CONTEXT.md` + código y esquema vigentes.

> Este documento reemplaza el contrato V2 anterior. En particular, quedan
> retiradas como reglas del cierre principal: la conciliación PMS obligatoria,
> el cierre automático del saliente al recibir y el solapamiento de turnos de
> Recepción.

## Principio de acceso

Un recepcionista sólo puede interactuar con la operación cuando su turno está
**ACTIVO**.

- Sin turno: sólo puede iniciar su propio turno.
- `INICIADO`: está recibiendo; sólo puede recontar Caja/garantías y confirmar
  la recepción.
- `ACTIVO`: puede operar Novedades, Caja, Llaves y demás funciones habilitadas.
- `PREPARANDO_ENTREGA` / `ENTREGA_ENVIADA`: la operación general queda
  bloqueada para esa cuenta y sólo continúa el flujo de cierre.
- `CERRADO`: el usuario ya no tiene un turno operativo.

La regla se aplica en servidor, interfaz y Fronti. No es un bloqueo meramente
visual.

## Relevo secuencial

Flujo canónico:

`SALIENTE ACTIVO → INICIAR CIERRE → ARQUEAR/VALIDAR CAJA → ENVIAR ENTREGA → CERRAR TURNO → ENTRANTE INICIA → RECUENTA CAJA/GARANTÍAS → CONFIRMA RECEPCIÓN → ENTRANTE ACTIVO`

No se abren dos turnos operativos de Recepción en paralelo. El relevo físico
puede ocurrir con ambos recepcionistas presentes en el mesón, pero el control
del sistema es secuencial.

Enviar la entrega **no** libera al saliente. Su participación termina sólo
cuando el turno queda formalmente `CERRADO`.

### Excepción: turno de emergencia

El turno de emergencia no es una segunda forma normal de iniciar turno. Antes
de abrirlo, la interfaz muestra una advertencia bloqueante, obliga a seleccionar
una causa válida de una lista cerrada y exige aceptación expresa.

Causas válidas:
- el recepcionista saliente no está disponible y no puede cerrar;
- una falla técnica impide completar el cierre normal;
- una situación operacional excepcional obliga a mantener Recepción activa.

El atraso, descuido u olvido del saliente no es por sí solo causa de emergencia.
La apertura queda marcada en el turno entrante, vinculada al turno saliente y
auditada. Mientras el turno saliente siga sin cierre formal, el motor mantiene
una alerta crítica automática para Supervisión y la reabre si alguien intenta
resolverla antes de regularizar la condición.

## Cierre guiado v3

La máquina de estados del turno sigue siendo la misma, pero la experiencia del
saliente se presenta como un recorrido secuencial y reversible hasta el envío:

1. **Caja y custodia:** arqueo, garantías y elementos físicos; Caja debe quedar
   formalmente cerrada.
2. **Pendientes:** Novedades, incidencias, tareas y demás asuntos que siguen
   vigentes. El sistema los reúne; el recepcionista no inventa una lista.
3. **Revisión final:** fotografía legible de Caja, custodia y puntos de entrega.
4. **Enviar entrega:** requiere confirmación explícita y constituye el punto de
   no retorno del cierre normal.
5. **Cerrar turno:** termina la responsabilidad operativa del saliente.

Antes del envío se puede navegar hacia atrás o cancelar el cierre. Cancelar
devuelve el turno a `ACTIVO`, invalida los arqueos/preparativos que deben
repetirse y, si Caja ya estaba cerrada, la reabre automáticamente. **Nunca
borra un hecho financiero ya ocurrido**: ingresos, egresos, garantías,
devoluciones y transferencias sobreviven y mantienen su trazabilidad.

El inventario de llaves no forma parte del cierre guiado. Conserva su propia
frecuencia operativa y sólo sus diferencias alimentan Supervisión.

## Caja y garantías

El saliente:
1. inicia la preparación de entrega;
2. arquea por denominación;
3. valida físicamente todas las garantías bajo custodia;
4. documenta cualquier diferencia;
5. completa el cierre formal de Caja;
6. envía la entrega y cierra el turno.

El entrante:
1. inicia su turno después del cierre saliente;
2. permanece `INICIADO` y bloqueado;
3. recuenta físicamente Caja;
4. valida las garantías recibidas;
5. documenta diferencias si existen;
6. confirma la recepción de la entrega;
7. sólo entonces pasa a `ACTIVO`.

El recuento de Caja por sí solo no activa el turno entrante.

## Informe de Caja · entrega/recepción

Después de que el entrante confirma la recepción se habilita la impresión del
informe final de entrega/recepción.

Debe identificar y dejar espacio de firma para:
- **Recepcionista saliente**;
- **Recepcionista entrante**;
- **Validación / auditoría de cierre**: Erick Herrera o auditor designado por él.

El informe conserva la evidencia de Caja, garantías, responsables, fechas y
trazabilidad de la entrega. La validación administrativa puede ser posterior y
no bloquea el inicio del siguiente turno una vez terminada la recepción.

## Validación de cierre

Cada cierre genera la validación posterior existente de prioridad crítica,
asignada a Erick Herrera. La validación/auditoría no se publica como una
“Novedad” de Recepción.

Un auditor designado puede efectuar la revisión física/documental según la
delegación operativa de Supervisión; el informe impreso dispone del espacio
correspondiente para firma y fecha.

## Novedades

La vista operativa de Novedades para Recepción contiene únicamente:
- registros tipo `NOVEDAD` o `INCIDENCIA`;
- creados por un recepcionista;
- todavía abiertos / en gestión.

Procesos internos, alertas técnicas y validaciones de cierre no deben mezclarse
con Novedades. Los registros resueltos permanecen disponibles en Historial.

## Seguridad de despliegue

GitHub `main` es la rama de release, Vercel es Production y Neon
`production` es la base persistente. Toda promoción requiere Compuerta verde,
incremento SemVer y verificación posterior del SHA desplegado.
