# Cierre Operativo — contrato vigente de Recepción

Estado: **vigente para Libro 1.10.8 / PR #125**.  
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
