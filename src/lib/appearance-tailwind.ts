import plugin from 'tailwindcss/plugin';
import { DARK_OUTLINE_COLORS, DARK_SURFACE_COLORS, DARK_TEXT_COLORS } from './appearance-palette';

type CSSRuleObject = { [key: string]: string | CSSRuleObject };

const darkScreen = (rule: CSSRuleObject): CSSRuleObject => ({
  '@media screen': { ':where(html[data-theme="dark"]) &': rule },
});

function alphaColor(hex: string, opacity: number): string {
  const rgb = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  return `rgb(${rgb.join(' ')} / ${opacity / 100})`;
}

/**
 * Tailwind emits only classes the real app uses, including hover/disabled/peer
 * variants. Explicit role mappings also apply to shared components using @apply.
 * Screen-only rules leave existing printed reports in their original light UI.
 */
export const appearanceUtilities = plugin(({ addUtilities, e }) => {
  const utilities: Record<string, CSSRuleObject> = {};
  function add(className: string, rule: CSSRuleObject) {
    utilities[`.${e(className)}`] = darkScreen(rule);
  }
  for (const [name, color] of Object.entries(DARK_SURFACE_COLORS)) {
    add(`bg-${name}`, { backgroundColor: color });
    for (let opacity = 5; opacity < 100; opacity += 5) {
      // Low-opacity white is an intentional highlight on existing dark branding.
      if (name === 'white' && opacity < 50) continue;
      add(`bg-${name}/${opacity}`, { backgroundColor: alphaColor(color, opacity) });
    }
  }
  for (const [name, color] of Object.entries(DARK_TEXT_COLORS)) add(`text-${name}`, { color });
  for (const [name, color] of Object.entries(DARK_OUTLINE_COLORS)) {
    add(`border-${name}`, { borderColor: color });
    add(`ring-${name}`, { '--tw-ring-color': color });
    add(`divide-${name}`, { '& > :not([hidden]) ~ :not([hidden])': { borderColor: color } });
    for (let opacity = 5; opacity < 100; opacity += 5) {
      add(`ring-${name}/${opacity}`, { '--tw-ring-color': alphaColor(color, opacity) });
      add(`border-${name}/${opacity}`, { borderColor: alphaColor(color, opacity) });
      add(`divide-${name}/${opacity}`, { '& > :not([hidden]) ~ :not([hidden])': { borderColor: alphaColor(color, opacity) } });
    }
  }
  add('ring-offset-white', { '--tw-ring-offset-color': '#142b3a' });
  addUtilities(utilities);
});
