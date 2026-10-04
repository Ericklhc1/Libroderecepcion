import type { Config } from 'tailwindcss';
import { appearanceUtilities } from './src/lib/appearance-tailwind';

/**
 * Paleta del producto: azul noche como base, blanco/gris frío para superficies
 * y cian como acento principal. Por compatibilidad, la clave interna `gold`
 * conserva su nombre histórico pero representa el acento cian de AROH.
 * Los tonos del semáforo visual se definen en
 * `src/components/ui/tone.ts` con clases completas para que Tailwind las
 * detecte en compilación.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    borderRadius: {
      none: '0px',
      sm: '3px',
      DEFAULT: '4px',
      md: '6px',
      lg: '8px',
      xl: '10px',
      '2xl': '12px',
      '3xl': '16px',
      full: '9999px',
    },
    extend: {
      colors: {
        slate: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
        },
        petrol: {
          50: '#eef5f7',
          100: '#d5e6ea',
          200: '#aecdd5',
          300: '#7facb8',
          400: '#528998',
          500: '#356c7c',
          600: '#265563',
          700: '#1d4351',
          800: '#173442',
          900: '#0f2430',
          950: '#091820',
        },
        gold: {
          50: '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
        },
      },
      fontFamily: {
        sans: [
          'var(--font-inter)',
          'Inter',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: 'var(--aroh-shadow-card)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: { 'fade-in': 'fade-in 150ms ease-out' },
    },
  },
  plugins: [appearanceUtilities],
};

export default config;
