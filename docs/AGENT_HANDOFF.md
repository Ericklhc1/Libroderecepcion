# Relevo de agentes — Libro Operativo de Recepción

> Canal persistente de continuidad entre ChatGPT, GitHub Copilot, Cursor/Codex y otros agentes.
> No guardar secretos, connection strings, passwords, tokens, cookies ni PII.

## Estado actual

- Fecha de referencia: **2026-09-20**.
- Versión en Production: **v1.1.2**, commit `af7d568`.
- Siguiente versión propuesta en la rama de auditoría: **v1.1.3**.
- Código fuente de verdad: GitHub `Ericklhc1/Libroderecepcion`.
- Rama de release: `main`, protegida por ruleset y Compuerta obligatoria.
- Hosting único de Production: Vercel `libroderecepcion`, región `gru1`.
- Base de Production: Neon, rama `production` en `sa-east-1`.
- Flujo canónico: rama de trabajo → PR a `main` → Compuerta → merge →
  Vercel Production → health/smoke → tag `vX.Y.Z`.

## Auditoría profesional del 20/09/2026

- Production sirve exactamente `v1.1.2` y el SHA de `main`.
- El despliegue actual está `READY`; no registró errores `error/fatal` en la
  ventana revisada.
- Compuerta #436: 71 archivos, 738 pruebas aprobadas y una omitida; migraciones,
  lint, tipos y build en verde.
- Verificación local independiente: instalación reproducible, lint, tipos y
  build en verde.
- Las invariantes estructurales de habitaciones, estadías, llaves y turnos se
  comprobaron sin publicar datos operativos de Production.
- Informe completo: `docs/AUDITORIA_PROFESIONAL_2026-09-20.md`.

## Riesgos abiertos

1. La política de protección, respaldo y restauración de Neon requiere una
   revisión privada de infraestructura.
2. Existen residuos de previews históricos que no deben limpiarse sin una
   autorización explícita y una verificación privada de recuperación.
3. GitHub conserva una PR borrador y la rama/ruleset `preproduction`, ya
   reemplazados por el flujo directo a `main`.
4. `npm audit --omit=dev` informa cinco vulnerabilidades conocidas —cuatro
   altas y una moderada— en la cadena Next/PostCSS y Prisma/config. La solución
   automática exige cambios mayores; no ejecutar `npm audit fix --force`.
5. No existe todavía una prueba de navegador autenticada que recorra el turno
   completo. La cobertura actual es de servicios/integración más smoke público.

## Reglas de continuidad

1. GitHub es la fuente de verdad del código.
2. `main` siempre debe ser desplegable.
3. Trabajo funcional normal: rama + PR a `main`; nunca commit directo.
4. La Compuerta debe quedar verde antes del merge.
5. No usar Neon Production para desarrollo interactivo, fixtures ni pruebas.
6. No crear otro hosting, staging persistente o rama de base de datos sin
   instrucción humana explícita.
7. Cada Production verificada debe tener un tag único `vX.Y.Z`.
8. No borrar ramas Neon de respaldo o `preview/*` sin autorización explícita.

## Siguiente acción

Resolver la higiene de infraestructura mediante una decisión humana explícita:

1. conservar o eliminar los previews históricos después de revisar en privado
   sus puntos de recuperación;
2. retirar la rama/ruleset `preproduction` y cerrar la PR obsoleta si se confirma que
   ya no tienen valor de recuperación;
3. definir una política de snapshot/restauración compatible con el plan de Neon;
4. planificar la actualización controlada de Next/PostCSS y Prisma sin usar
   correcciones forzadas.

## Mensaje para otros agentes

No reintroducir hosting alternativo, ramas intermedias de release, previews
alojados ni bases persistentes de desarrollo como parte del flujo. Para pruebas
usa el PostgreSQL efímero de CI o una base local desechable que nunca sea
Production.
