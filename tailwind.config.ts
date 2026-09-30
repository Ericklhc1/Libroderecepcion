import type { Config } from 'tailwindcss';

/**
 * Paleta del producto: azul petróleo como color principal, dorado como acento,
 * blanco y grises para el resto. Los tonos del semáforo visual se definen en
 * `src/components/ui/tone.ts` con clases completas para que Tailwind las
 * detecte en compilación.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    borderRadius: {
      none: '0px',
      sm: '2px',
      DEFAULT: '3px',
      md: '4px',
      lg: '5px',
      xl: '6px',
      '2xl': '8px',
      '3xl': '10px',
      full: '9999px',
    },
    extend: {
      colors: {
        slate: {
          50: '#faf9f6',
          100: '#f4f2ed',
          200: '#e7e2d9',
          300: '#d6cfc3',
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
          50: '#fbf8ef',
          100: '#f5edd5',
          200: '#ead9a6',
          300: '#dcc06f',
          400: '#cfa844',
          500: '#c9a227',
          600: '#a8811f',
          700: '#85631c',
          800: '#6d501e',
          900: '#5c431e',
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
        card: '0 1px 1px rgba(9, 24, 32, 0.04), 0 4px 14px rgba(9, 24, 32, 0.035)',
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
  plugins: [],
};

export default config;
