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
    extend: {
      colors: {
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
        card: '0 1px 2px rgba(15, 36, 48, 0.06), 0 1px 12px rgba(15, 36, 48, 0.05)',
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
