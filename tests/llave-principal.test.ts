import { describe, expect, it } from 'vitest';
import { principalKeyHolder, type KeyHolderCandidate } from '@/domain/rooms';

/**
 * Quién debe tener la llave principal.
 *
 * La regla vive en el dominio porque la usan dos sitios: lo que escribe la
 * importación y lo que la pantalla de revisión anuncia que va a pasar. Si
 * viviera en cada uno, podrían divergir y la revisión mentiría.
 */
const stay = (
  id: string,
  status: KeyHolderCandidate['status'],
  stage: KeyHolderCandidate['stage'] = 'PENDIENTE',
): KeyHolderCandidate => ({ id, status, stage });

describe('quién tiene la llave principal', () => {
  it('nadie, si la habitación está vacía', () => {
    expect(principalKeyHolder([])).toBeNull();
  });

  it('el huésped in house, asignada', () => {
    expect(principalKeyHolder([stay('a', 'IN_HOUSE', 'CONFIRMADO')])).toEqual({
      stayId: 'a',
      status: 'ASIGNADA',
    });
  });

  it('quien sale sin confirmar, pendiente de devolución', () => {
    expect(principalKeyHolder([stay('b', 'CHECK_OUT')])).toEqual({
      stayId: 'b',
      status: 'PENDIENTE_DEVOLUCION',
    });
  });

  it('nadie, si sólo hay una entrada sin confirmar', () => {
    // La regla de cola: quien espera no recibe llave.
    expect(principalKeyHolder([stay('c', 'CHECK_IN')])).toBeNull();
    expect(principalKeyHolder([stay('c', 'CHECK_IN', 'CONFIRMADO')])).toBeNull();
  });

  it('la salida manda sobre el in house de la misma persona', () => {
    /*
      Es el caso normal de quien se va hoy: aparece en el informe in house y
      en el de salidas. La llave tiene que quedar por recuperar, no como una
      asignación tranquila.
    */
    const holder = principalKeyHolder([
      stay('dentro', 'IN_HOUSE', 'CONFIRMADO'),
      stay('sale', 'CHECK_OUT'),
    ]);
    expect(holder).toEqual({ stayId: 'sale', status: 'PENDIENTE_DEVOLUCION' });
  });

  it('la salida manda aunque llegue después en la lista', () => {
    const holder = principalKeyHolder([stay('sale', 'CHECK_OUT'), stay('dentro', 'IN_HOUSE')]);
    expect(holder?.stayId).toBe('sale');
  });

  it('ignora lo finalizado: una salida ya confirmada no retiene la llave', () => {
    expect(principalKeyHolder([stay('ida', 'CHECK_OUT', 'FINALIZADO')])).toBeNull();
    // Y si además entra alguien y ya está dentro, la llave es suya.
    expect(
      principalKeyHolder([
        stay('ida', 'CHECK_OUT', 'FINALIZADO'),
        stay('nueva', 'IN_HOUSE', 'CONFIRMADO'),
      ]),
    ).toEqual({ stayId: 'nueva', status: 'ASIGNADA' });
  });

  it('con salida pendiente y entrada en cola, la llave es de quien sale', () => {
    // El caso de la 408 sobre los informes reales.
    const holder = principalKeyHolder([stay('sale', 'CHECK_OUT'), stay('espera', 'CHECK_IN')]);
    expect(holder).toEqual({ stayId: 'sale', status: 'PENDIENTE_DEVOLUCION' });
  });
});
