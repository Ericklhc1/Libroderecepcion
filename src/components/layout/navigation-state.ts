import type { NavGroup, NavItem } from './nav-items';

const BASE = 'https://navigation.invalid';

function destinations(item: NavItem): string[] {
  return [item.href, ...(item.menu ?? []).flatMap(section => section.items.map(link => link.href))];
}

/** Select the most specific permitted module, including secondary routes and query views. */
export function activeModule(groups: NavGroup[], pathname: string, search = ''): string | null {
  const params = new URLSearchParams(search);
  const candidates = groups.flatMap(group => group.items).flatMap(item =>
    destinations(item).filter(href => !href.includes('#')).map(href => {
      const url = new URL(href, BASE);
      const queryMatches = [...url.searchParams].every(([key, value]) => params.getAll(key).includes(value));
      return { root: item.href, path: url.pathname, primary: href === item.href, specificity: queryMatches ? url.searchParams.size : -1 };
    }),
  ).filter(candidate => candidate.path === '/' ? pathname === '/' :
    pathname === candidate.path || pathname.startsWith(candidate.path + '/'));
  return candidates.sort((a, b) => b.path.length - a.path.length || b.specificity - a.specificity || Number(b.primary) - Number(a.primary))[0]?.root ?? null;
}

/** Query parameters belong to navigation; unrelated list filters do not cancel selection. */
export function activeDestination(item: NavItem, pathname: string, search: string): string | null {
  const params = new URLSearchParams(search);
  return destinations(item).filter(href => {
    if (href.includes('#')) return false;
    const url = new URL(href, BASE);
    return url.pathname === pathname && [...url.searchParams].every(([key, value]) => params.getAll(key).includes(value));
  }).sort((a, b) => new URL(b, BASE).searchParams.size - new URL(a, BASE).searchParams.size)[0] ?? null;
}

export function navigationContext(groups: NavGroup[], pathname: string, search: string) {
  const href = activeModule(groups, pathname, search);
  const group = groups.find(candidate => candidate.items.some(item => item.href === href));
  const item = group?.items.find(candidate => candidate.href === href);
  const destination = item ? activeDestination(item, pathname, search) : null;
  const destinationLabel = item?.menu?.flatMap(section => section.items).find(link => link.href === destination)?.label;
  return { group, item, destination, destinationLabel };
}

export function badgeFor(badges: Partial<Record<string, number>> | undefined, href: string): number {
  return badges?.[href] ?? badges?.[href.split(/[?#]/)[0] ?? href] ?? 0;
}
