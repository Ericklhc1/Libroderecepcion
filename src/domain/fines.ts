/**
 * Multas: el formulario real del hotel, con sus reglas.
 *
 * Lo que hace este archivo es decidir qué campos son obligatorios según lo
 * que se está multando. La regla que importa: **una multa que no explica por
 * qué procede el cobro no sirve**, porque cuando el huésped la discute lo
 * único que queda es lo que se escribió en el momento.
 *
 * Todo puro: se prueba sin base de datos.
 */

export type FineKindValue = 'BLANCO' | 'DANO' | 'FALTANTE' | 'OTRO';

export const FINE_KIND_LABELS: Record<FineKindValue, string> = {
  BLANCO: 'Blanco (toallas, sábanas, cubrecamas)',
  DANO: 'Daño a mobiliario o instalaciones',
  FALTANTE: 'Falta un elemento de la habitación',
  OTRO: 'Otro',
};

export type LinenKindValue =
  | 'TOALLA_MANO'
  | 'TOALLA_CUERPO'
  | 'TOALLA_PISO'
  | 'SABANA'
  | 'FUNDA_ALMOHADA'
  | 'CUBRECAMA'
  | 'PROTECTOR_COLCHON'
  | 'BATA'
  | 'MANTEL'
  | 'CORTINA'
  | 'OTRO';

export const LINEN_KIND_LABELS: Record<LinenKindValue, string> = {
  TOALLA_MANO: 'Toalla de mano',
  TOALLA_CUERPO: 'Toalla de cuerpo',
  TOALLA_PISO: 'Toalla de piso',
  SABANA: 'Sábana',
  FUNDA_ALMOHADA: 'Funda de almohada',
  CUBRECAMA: 'Cubrecama',
  PROTECTOR_COLCHON: 'Protector de colchón',
  BATA: 'Bata',
  MANTEL: 'Mantel',
  CORTINA: 'Cortina',
  OTRO: 'Otro (detállalo)',
};

export type FineStatusValue =
  | 'REGISTRADA'
  | 'NOTIFICADA'
  | 'COBRADA'
  | 'CONDONADA'
  | 'ANULADA';

export const FINE_STATUS_LABELS: Record<FineStatusValue, string> = {
  REGISTRADA: 'Registrada',
  NOTIFICADA: 'Notificada al huésped',
  COBRADA: 'Cobrada',
  CONDONADA: 'Condonada',
  ANULADA: 'Anulada',
};

export const FINE_STATUS_TONE: Record<FineStatusValue, string> = {
  REGISTRADA: 'pendiente',
  NOTIFICADA: 'atencion',
  COBRADA: 'resuelto',
  CONDONADA: 'neutro',
  ANULADA: 'neutro',
};

/** Estados en que la multa sigue pidiendo una decisión. */
export const OPEN_FINE_STATUSES: FineStatusValue[] = ['REGISTRADA', 'NOTIFICADA'];

/**
 * Transiciones posibles. Una multa cobrada o anulada no vuelve atrás: si hubo
 * un error, se anula y se registra otra, porque así queda el rastro de las dos.
 */
const TRANSITIONS: Record<FineStatusValue, FineStatusValue[]> = {
  REGISTRADA: ['NOTIFICADA', 'COBRADA', 'CONDONADA', 'ANULADA'],
  NOTIFICADA: ['COBRADA', 'CONDONADA', 'ANULADA'],
  COBRADA: [],
  CONDONADA: [],
  ANULADA: [],
};

export function canTransition(from: FineStatusValue, to: FineStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: FineStatusValue): FineStatusValue[] {
  return TRANSITIONS[from];
}

export type FineDraft = {
  reservationCode: string;
  guestName: string;
  kind: FineKindValue;
  linenKind?: LinenKindValue | null;
  itemDetail?: string | null;
  stainType?: string | null;
  reason?: string | null;
  /** Observaciones o antecedentes sobre la negativa del huésped. */
  guestStatement?: string | null;
  /** Cantidad de unidades afectadas por la misma multa. */
  quantity?: number | null;
  amount?: number | null;
};

/**
 * Qué le falta al formulario. Lista vacía = se puede registrar.
 *
 * Se devuelven TODOS los problemas, no el primero: quien está en el mesón con
 * el huésped delante no puede descubrir los campos que faltan de uno en uno.
 */
export function fineProblems(draft: FineDraft): Array<{ field: string; message: string }> {
  const problems: Array<{ field: string; message: string }> = [];

  if (!draft.reservationCode?.trim()) {
    problems.push({
      field: 'reservationCode',
      message: 'Indica el número de la reserva: es lo que liga la multa a la cuenta.',
    });
  }
  if (!draft.guestName?.trim()) {
    problems.push({ field: 'guestName', message: 'Indica el nombre completo del huésped.' });
  }
  if (!draft.reason?.trim()) {
    problems.push({
      field: 'reason',
      message:
        'Explica por qué procede el cobro. Cuando el huésped lo discuta, esto es lo único que queda.',
    });
  }

  if (draft.kind === 'BLANCO') {
    if (!draft.linenKind) {
      problems.push({
        field: 'linenKind',
        message: 'Indica qué blanco resultó afectado.',
      });
    }
    if (draft.linenKind === 'OTRO' && !draft.itemDetail?.trim()) {
      problems.push({
        field: 'itemDetail',
        message: 'Si el blanco no está en la lista, descríbelo.',
      });
    }
    if (!draft.stainType?.trim()) {
      problems.push({
        field: 'stainType',
        message:
          'Indica el tipo de mancha identificada. De eso depende si la prenda se recupera o se pierde.',
      });
    }
  } else if (!draft.itemDetail?.trim()) {
    problems.push({
      field: 'itemDetail',
      message: 'Describe qué se dañó, faltó o se cobra.',
    });
  }

  if (draft.quantity !== null && draft.quantity !== undefined) {
    if (!Number.isInteger(draft.quantity) || draft.quantity < 1) {
      problems.push({
        field: 'quantity',
        message: 'La cantidad debe ser un número entero mayor que cero.',
      });
    }
  }

  if (draft.amount !== null && draft.amount !== undefined) {
    if (!(draft.amount > 0)) {
      problems.push({ field: 'amount', message: 'El monto debe ser mayor que cero.' });
    }
  }

  return problems;
}

/** Resumen de una línea, para listados y para la entrega de turno. */
export function fineSummary(fine: {
  roomNumber: string;
  kind: FineKindValue;
  linenKind?: LinenKindValue | null;
  itemDetail?: string | null;
  stainType?: string | null;
  quantity?: number | null;
}): string {
  const what =
    fine.kind === 'BLANCO' && fine.linenKind
      ? fine.linenKind === 'OTRO'
        ? (fine.itemDetail ?? 'blanco sin detallar')
        : LINEN_KIND_LABELS[fine.linenKind]
      : (fine.itemDetail ?? FINE_KIND_LABELS[fine.kind]);
  const quantity = fine.quantity && fine.quantity > 1 ? ` · ${fine.quantity} unidades` : '';

  return fine.stainType
    ? `Hab. ${fine.roomNumber} · ${what}${quantity} · ${fine.stainType}`
    : `Hab. ${fine.roomNumber} · ${what}${quantity}`;
}
