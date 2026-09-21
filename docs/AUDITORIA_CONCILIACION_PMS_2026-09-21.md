# Auditoría de conciliación PMS — 21/09/2026

## Alcance y criterio

Auditoría de sólo lectura sobre la rama `production` de Neon antes de cambiar
datos. Se contrastaron `PmsImportBatch`, `RoomStay`, `ReservationReference`,
llaves, movimientos, garantías, novedades, multas y caja. La unidad evaluada
fue la ocurrencia `reservationId + habitación + llegada`; el estado no se usó
como identidad.

## Causa raíz

1. `applyImport` identificaba una estancia con
   `reservationId + roomId + stayPhase(status)`. Como `CHECK_OUT` pertenecía a
   otra fase, una transición válida `IN_HOUSE → CHECK_OUT` creaba otra
   `RoomStay` y ambas competían en el snapshot.
2. El lector flexible asignaba tanto `ID` como `Localizador` a
   `reservationId`. Al reconstruir la fila concatenaba ambas celdas; por
   ejemplo `7510383` + `2539932938` se guardó como
   `75103832539932938`.

Los 10 grupos duplicados existentes en toda Production son exactamente las 10
habitaciones señaladas. No apareció otro grupo vivo con la misma
`reserva + habitación + llegada`.

## Casos comprobados antes de la reparación

Todas las filas de esta tabla tienen `businessDate = 20/09/2026` y salida
20/09/2026. Las llegadas son 19/09 salvo 601 y 603, que son 18/09.

| Hab. | Reserva real | RoomStay histórica | RoomStay vigente | Fila ID concatenado | Diagnóstico | Snapshot antes | Snapshot tras v1.1.6 |
|---|---:|---|---|---|---|---|---|
| 406 | 7510383 | `cmu8y5opv000zjt040c04jgln` · IN_HOUSE/PENDIENTE | `cmuagg5fi0000lb04m154fcd7` · CHECK_OUT/PENDIENTE | `cmuagnv780002jr04qubgpd52` | transición duplicada + parser | CHECK_OUT pendiente | CHECK_OUT pendiente, una sola realidad |
| 411 | 7534334 | `cmu8y5opu0004jt04m3ohbtay` · IN_HOUSE/FINALIZADO | `cmuagg5fi0005lb04tidr7wox` · CHECK_OUT/FINALIZADO | `cmuagnv780003jr04g4bi9gal` | transición histórica duplicada + parser | CHECK_IN 7534591 | CHECK_IN 7534591; historial anterior no compite |
| 416 | 7534679 | `cmu9nv8mc0002jv04q9ry3kbg` · IN_HOUSE/CONFIRMADO | `cmuagg5fi000clb04x19fk008` · CHECK_OUT/PENDIENTE | `cmuagnv780004jr0496gf349f` | transición duplicada + parser | CHECK_OUT pendiente | CHECK_OUT pendiente, una sola realidad |
| 419 | 7534394 | `cmu9nv8mc0003jv04isohspjh` · IN_HOUSE/CONFIRMADO | `cmuagg5fi0006lb04d63kqvhf` · CHECK_OUT/PENDIENTE | `cmuagnv780005jr04ly9weu4o` | transición duplicada + parser | CHECK_OUT pendiente | CHECK_OUT pendiente, una sola realidad |
| 420 | 7534638 | `cmu9nv8mc0004jv04wk5j2nrz` · IN_HOUSE/CONFIRMADO | `cmuagg5fi000blb04bve6ixya` · CHECK_OUT/PENDIENTE | `cmuagnv790006jr041w57g6us` | transición duplicada + parser | CHECK_OUT pendiente | CHECK_OUT pendiente, una sola realidad |
| 512 | 7534481 | `cmu9nv8mc0005jv049kfpa16a` · IN_HOUSE/CONFIRMADO | `cmuagg5fi0007lb04dzb2gw8h` · CHECK_OUT/PENDIENTE | `cmuagnv790007jr0472nv1y2p` | transición duplicada + parser | CHECK_OUT pendiente | CHECK_OUT pendiente, una sola realidad |
| 523 | 7534549 | `cmu8y5opv0012jt04ek1sskmd` · IN_HOUSE/CONFIRMADO | `cmuagg5fi0009lb04zdey7wcu` · CHECK_OUT/PENDIENTE | `cmuagnv790008jr04kajvp67l` | transición duplicada + parser | CHECK_OUT pendiente | CHECK_OUT pendiente, una sola realidad |
| 601 | 7524389 | `cmu8y5opu000ajt04ipcfgzh8` · IN_HOUSE/CONFIRMADO | `cmuagg5fi0002lb04t9h62n1h` · CHECK_OUT/PENDIENTE | `cmuagnv790009jr04f3piwn3b` | transición duplicada + parser | CHECK_OUT pendiente | CHECK_OUT pendiente, una sola realidad |
| 603 | 7524379 | `cmu8y5opu000bjt045lv1bnju` · IN_HOUSE/CONFIRMADO | `cmuagg5fi0001lb04rpwt2jl6` · CHECK_OUT/PENDIENTE | `cmuagnv79000ajr04ar6p2t5l` | transición duplicada + parser | CHECK_OUT pendiente | CHECK_OUT pendiente, una sola realidad |
| 605 | 7534529 | `cmu9nv8mc0006jv04o3840hlw` · IN_HOUSE/CONFIRMADO | `cmuagg5fi0008lb04pxk8alqz` · CHECK_OUT/PENDIENTE | — | transición duplicada; el localizador 1789850333 no produjo una fila concatenada en el lote aplicado | CHECK_OUT pendiente | CHECK_OUT pendiente, una sola realidad |

Los `CHECK_OUT` canónicos proceden del lote de actividad nocturno
`cmuagmocm0001js041pjzmlfk`, salvo 605, cuyo lote es
`cmu9oxvwd0001jp04t9oi4fid`. Las filas `IN_HOUSE` proceden del lote
`cmu9ocnf30003lb04deslflka`. La evidencia de los informes queda conservada en
los payloads de esos lotes.

## Dependencias operativas

- Las llaves principales estaban vinculadas a los `CHECK_OUT` canónicos o ya
  habían sido resueltas (411). Las filas históricas sólo conservaban movimientos
  anteriores; las filas concatenadas no tenían llaves ni movimientos.
- No había garantías, multas, novedades ni movimientos de caja ligados a las
  19 filas que se retiran del estado vivo.
- Las nueve `ReservationReference` con código concatenado sólo estaban ligadas
  a su fila falsa y no tenían dependencias operativas.

## Reparación trazable

La migración `20260921103000_conciliar_identidad_estadias`:

- conserva el `CHECK_OUT` canónico y le asigna el localizador secundario cuando
  corresponde;
- aplica eliminación lógica a las 10 filas históricas `IN_HOUSE` redundantes y
  a las 9 filas de ID concatenado;
- aplica eliminación lógica a las 9 referencias falsas;
- crea un `AuditLog` por cada corrección;
- no modifica `PmsImportBatch.payload`;
- crea la garantía parcial única de una fila viva por
  `(reservationId, roomId, arrivalDate)`.

No se ejecutó limpieza masiva ni se alteró otra estancia histórica.
