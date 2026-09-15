/**
 * TypeScript 6 exige declaración explícita para importaciones con efecto
 * lateral. Next.js procesa el CSS mediante su pipeline, no el compilador.
 */
declare module '*.css';
