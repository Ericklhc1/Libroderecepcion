/** Presentation of the existing explicit candidateIds contract; never assigns work. */
export type SubstitutionWorkKind = 'task' | 'entry' | 'housekeeping';
export type SubstitutionCandidate = {
  id: string;
  name: string;
  username: string;
  role: string;
  areas: Array<{ id: string; name: string }>;
  workKinds: SubstitutionWorkKind[];
};

export function candidateIsSelectable(
  candidate: SubstitutionCandidate,
  departmentId: string,
  kind: SubstitutionWorkKind,
): boolean {
  return candidate.areas.some(area => area.id === departmentId) && candidate.workKinds.includes(kind);
}

export function candidateLabel(candidate: SubstitutionCandidate): string {
  return `${candidate.name} · @${candidate.username} · ${candidate.role} · ${candidate.areas.map(area => area.name).join(', ') || 'Sin área'}`;
}

export function addOrderedCandidate(ids: readonly string[], id: string): string[] {
  if (!id || ids.includes(id) || ids.length >= 20) return [...ids];
  return [...ids, id];
}

export function moveOrderedCandidate(ids: readonly string[], id: string, direction: -1 | 1): string[] {
  const next = [...ids], index = next.indexOf(id), target = index + direction;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function removeOrderedCandidate(ids: readonly string[], id: string): string[] {
  return ids.filter(candidate => candidate !== id);
}
