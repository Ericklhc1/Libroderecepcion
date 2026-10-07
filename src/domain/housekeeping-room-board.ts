export const HK_ROOM_LABELS = { SUCIA: 'Sucia', PENDIENTE_INSPECCION: 'Pendiente inspección', LIMPIA: 'Limpia · inspeccionada', SIN_REGISTRO: 'Sin registro' } as const;
export type HkRoomState = keyof typeof HK_ROOM_LABELS;
type Work = { id: string; humanId: number; roomId: string | null; workKind: string | null; workflowVersion: number; status: string; finishedAt: Date | null; inspectedAt: Date | null };
/** Only visible cleaning evidence from the selected workday can describe a room. */
export function buildHkRoomBoard<T extends { id: string; number: string; floor: number | null }>(rooms: T[], work: Work[]) {
  return rooms.map(room => {
    const cleaning = work.filter(w => w.roomId === room.id && w.workflowVersion === 1 && w.workKind === 'LIMPIEZA' && w.status !== 'CANCELADO');
    const dirty = cleaning.filter(w => !['POR_REVISAR', 'RESUELTO'].includes(w.status));
    const review = cleaning.filter(w => w.status === 'POR_REVISAR');
    const inspected = cleaning.filter(w => w.status === 'RESUELTO' && w.finishedAt && w.inspectedAt);
    const state: HkRoomState = dirty.length ? 'SUCIA' : review.length ? 'PENDIENTE_INSPECCION' : inspected.length === cleaning.length && inspected.length ? 'LIMPIA' : 'SIN_REGISTRO';
    return { ...room, state, work: cleaning.map(w => ({ id: w.id, humanId: w.humanId, status: w.status })) };
  });
}
