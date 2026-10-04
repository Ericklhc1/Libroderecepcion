/**
 * Presentation compatibility for the existing utility-based UI.
 * Colors are mapped by role (surface / text / outline), never globally inverted.
 * Saturated status dots and dark brand buttons retain their original colors.
 */
export const DARK_SURFACE_COLORS: Record<string, string> = {
  white: '#142b3a',
  'slate-50': '#102533', 'slate-100': '#1b3546', 'slate-200': '#294657', 'slate-300': '#466274',
  'petrol-50': '#163443', 'petrol-100': '#1c4050', 'petrol-200': '#2b5060', 'petrol-300': '#3e6170',
  'gold-50': '#123844', 'gold-100': '#184652', 'gold-200': '#215564',
};
export const DARK_TEXT_COLORS: Record<string, string> = {
  'slate-400': '#a2b7c6', 'slate-500': '#adbfcd', 'slate-600': '#c0d0dc',
  'slate-700': '#d3dfe8', 'slate-800': '#e1eaf0', 'slate-900': '#eef4f8', 'slate-950': '#f3f7fa',
  'petrol-400': '#a0bac8', 'petrol-500': '#aac8d5', 'petrol-600': '#b9d3de',
  'petrol-700': '#c8dfe8', 'petrol-800': '#d7e8ef', 'petrol-900': '#e9f2f7', 'petrol-950': '#f0f6fa',
  'gold-500': '#67e8f9', 'gold-600': '#67e8f9', 'gold-700': '#8cecf7', 'gold-800': '#a5f3fc', 'gold-900': '#cffafe',
};
export const DARK_OUTLINE_COLORS: Record<string, string> = {
  'slate-100': '#284253', 'slate-200': '#345164', 'slate-300': '#58778b', 'slate-400': '#68889b',
  'petrol-100': '#2b5264', 'petrol-200': '#376274', 'petrol-300': '#50788a', 'petrol-400': '#648c9e',
  'gold-100': '#26505c', 'gold-200': '#326879', 'gold-300': '#41869a',
};

/** Preserve each semantic hue and its explicit labels/symbols in both modes. */
export const DARK_STATUS_COLORS = {
  red: { surface: '#44272e', text: '#fecaca', outline: '#94515e' },
  orange: { surface: '#432f26', text: '#fed7aa', outline: '#91613f' },
  amber: { surface: '#3b3221', text: '#fde68a', outline: '#8e7741' },
  sky: { surface: '#19364d', text: '#bae6fd', outline: '#426f92' },
  emerald: { surface: '#173c33', text: '#a7f3d0', outline: '#437e68' },
  cyan: { surface: '#173b44', text: '#a5f3fc', outline: '#417987' },
  blue: { surface: '#233653', text: '#bfdbfe', outline: '#5273a2' },
  indigo: { surface: '#303455', text: '#c7d2fe', outline: '#6b70a1' },
  purple: { surface: '#392e4d', text: '#e9d5ff', outline: '#8562a1' },
  violet: { surface: '#342f50', text: '#ddd6fe', outline: '#7969a2' },
  rose: { surface: '#432936', text: '#fecdd3', outline: '#965568' },
  green: { surface: '#1d3c2e', text: '#bbf7d0', outline: '#4e805f' },
  teal: { surface: '#173c3b', text: '#99f6e4', outline: '#437f7b' },
} as const;

for (const [name, colors] of Object.entries(DARK_STATUS_COLORS)) {
  for (const shade of [50, 100, 200]) DARK_SURFACE_COLORS[`${name}-${shade}`] = colors.surface;
  for (const shade of [500, 600, 700, 800, 900, 950]) DARK_TEXT_COLORS[`${name}-${shade}`] = colors.text;
  for (const shade of [100, 200, 300]) DARK_OUTLINE_COLORS[`${name}-${shade}`] = colors.outline;
}
