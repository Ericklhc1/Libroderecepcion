import type { NavItem, NavMenuSection } from './nav-items';

/** Presentation only: the permission-filtered catalog and exact URLs stay canonical. */
export function secondaryDestinations(item: NavItem): NavMenuSection[] {
  const seen = new Set([item.href]);
  return (item.menu ?? []).map(section => ({
    ...section,
    items: section.items.filter(link => {
      if (seen.has(link.href)) return false;
      seen.add(link.href);
      return true;
    }),
  })).filter(section => section.items.length > 0);
}
