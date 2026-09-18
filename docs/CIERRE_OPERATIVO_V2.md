# Cierre Operativo V2 — contrato de producto

Estado: aprobado para implementación.
Fuente de verdad: este documento + código y esquema vigentes. No reconstruir módulos que ya funcionan.

## Flujo canónico

INICIAR CIERRE → CAJA → PMS → CONCILIACIÓN → PENDIENTES/ELEMENTOS → ENTREGAR → RECIBIR → VALIDACIÓN DE JEFATURA.

No existe un segundo «Cerrar turno» después de Recibir. Al recibir correctamente:
- el turno entrante queda ACTIVO;
- el saliente queda CERRADO con hora real;
- el cierre saliente queda CERRADO · PENDIENTE DE VALIDACIÓN.

El cierre operacional no espera la validación administrativa.

## Fotografía del cierre

Iniciar cierre congela la configuración relevante del turno: Caja/divisas activas, elementos de entrega, garantías vigentes y pendientes. Cambios administrativos posteriores aplican al siguiente cierre.

## Caja

Caja es el primer trabajo del cierre y se cierra una sola vez. Reutilizar ShiftCashClosure existente y su snapshot. Ingresos, egresos y ajustes no atribuibles a garantía requieren autorización de Supervisor. Diferencias deben conciliarse antes de continuar. Supervisor autoriza excepciones operacionales; no valida el cierre completo.

## PMS

El cierre exige exactamente tres informes independientes: ACTIVIDAD, SALIDAS e IN_HOUSE. ENTRADAS puede seguir existiendo para otros flujos, pero no satisface el cierre.

Todo PDF que modifique estado vivo debe incluir «Informe generado el DD/MM/AAAA HH:MM:SS». La fecha/hora se interpreta en America/Santiago y se compara en servidor:
- 0–15 minutos: válido;
- >15 minutos: vencido;
- fecha futura fuera de tolerancia: inválido;
- timestamp ausente/ilegible: inválido.

No hay override operacional. Una importación histórica futura debe ser explícitamente no operativa.

Cada archivo guarda hash criptográfico y metadatos de generación para impedir que el mismo informe se aplique como si fuera nuevo.

## Evidencia vectorial FNS

El lector PDF debe conservar, además de texto y posición, evidencia de estilo necesaria para el ID FNS (incluido color de fuente cuando pdf.js permita extraerlo de forma fiable).

No codificar globalmente NEGRO=PROCESADO. El significado de color se define por tipo de informe y sólo después de fixtures reales. Si la señal no está confirmada, el color es evidencia informativa y nunca autoridad para una transición.

## Identidad y ocupación

reservationId (ID FNS) es identidad canónica de reserva.
Una ocupación concreta se identifica por reservationId + habitación + segmento temporal.

Una reserva puede producir varias ocupaciones, incluso en la misma habitación el mismo día. La conciliación nunca reconstruye el hotel desde cero: calcula delta contra el estado conocido.

## Autoridad de datos

FNS puede confirmar estados PMS de check-in/check-out y datos de estancia.
FNS NO tiene autoridad sobre hechos físicos que no conoce: devolución de llaves, efectivo físico, entrega de elementos, etc.

Si un check-out queda procesado y hay llaves activas, mostrar cola compacta para confirmar cantidad devuelta. No marcar llaves como devueltas automáticamente.

## Conciliación por delta

La interfaz muestra sólo cambios y revisiones, más un contador de condiciones sin cambio. Una condición que permanece igual no genera una nueva novedad. Resolver una condición cierra el evento; una anomalía posterior es un evento nuevo.

Salida esperada:
«N sin cambios · A check-in actualizados · B check-out procesados · C nuevas reservas · D requieren revisión».

El botón «Validar y actualizar estado de habitaciones» permanece deshabilitado hasta que los tres informes requeridos sean válidos y frescos.

## Pendientes y elementos

Después de conciliación se presentan sólo alertas críticas, pendientes heredables, garantías no resueltas, elementos físicos y una observación única. Ningún elemento seleccionado exige justificación y revisión de Supervisor, pero no bloquea por sí solo la entrega.

## Entrega y recepción

Resumen de salida: Caja cerrada, edad de última actualización PMS, habitaciones conciliadas, garantías, cantidad de pendientes y elementos.

El entrante verifica la Caja recibida y elementos; no vuelve a cerrar Caja. Diferencia abre excepción. Recibir es la única acción final operacional y cierra automáticamente el turno saliente.

Eliminar del camino principal cualquier «Cerrar turno» manual posterior. Mantener sólo mecanismos administrativos auditados que sean imprescindibles para recuperación/anulación.

## Validación obligatoria

Todo cierre genera automáticamente una validación de cierre de prioridad alta asignada a Erick Herrera, sin excepción, incluso si participó en el cierre.

No se resuelve desde un botón genérico de alertas. Sólo:
- Validar cierre;
- Devolver para corrección (observación obligatoria).

El PDF de cierre registra inicialmente «Pendiente de validación de jefatura» y, tras validación, «Validado por Erick Herrera · fecha/hora».

## PDF de cierre

Generar al finalizar operación con Caja/arqueo, garantías, conciliación PMS, pendientes, novedades, elementos, responsables y horas. Mantener posibilidad de envío como adjunto a uno o más destinatarios.

## Motor Operativo — siguiente capa

No crear reglas duplicadas por pantalla. Evolucionar hacia un motor determinístico que proyecte:

ESTADÍA + PMS + HABITACIÓN + GARANTÍA + LLAVES + CAJA + TURNO + PENDIENTES + TIEMPO = ESTADO OPERATIVO.

El motor debe producir condiciones/acciones explicables y alimentar una Bandeja de Atención universal. La IA futura interpreta lenguaje y solicita acciones al motor; no inventa ni sustituye reglas operacionales.

## Seguridad de despliegue

Vercel es Production y sólo despliega `main` contra Neon `production`. Netlify es staging/prueba real y usa Neon `development`; nunca debe recibir credenciales de Production. Ningún preview/desarrollo puede migrar o ejecutar código con escritura si no tiene una conexión aislada. La promoción exige Compuerta verde + validación funcional en Netlify antes de entrar a `main`.

## Criterios de aceptación mínimos

1. Caja cerrada es precondición real para avanzar.
2. Cierre requiere ACTIVIDAD + SALIDAS + IN_HOUSE frescos ≤15 min.
3. Repetir un PDF no duplica ni simula una actualización nueva.
4. Caso mismo ID/misma habitación con check-out y nuevo check-in conserva dos segmentos.
5. Check-out FNS no devuelve llaves automáticamente.
6. Conciliación muestra delta, no tres tablas repetidas.
7. Recibir activa entrante y cierra saliente atómicamente.
8. No queda acción manual «Cerrar turno» en el flujo normal.
9. Todo cierre genera validación de jefatura obligatoria.
10. Validación posterior no bloquea el siguiente turno.
11. Reglas críticas tienen pruebas automatizadas y Compuerta verde antes de merge.
