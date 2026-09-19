# Relevo de agentes — Libro Operativo de Recepción

> Canal persistente de continuidad entre ChatGPT, GitHub Copilot, Cursor/Codex y otros agentes.
> No guardar secretos, connection strings, passwords, tokens, cookies ni PII.

## Estado actual

- Fecha de referencia: 2026-09-18.
- Versión base del nuevo esquema: **v1.0.0**.
- Código fuente de verdad: GitHub `Ericklhc1/Libroderecepcion`.
- Rama de release: `main`.
- Hosting único de Production: Vercel `libroderecepcion`.
- Base de Production: Neon, rama `production`.
- Vercel sólo despliega `main`; los previews automáticos de otras ramas están desactivados.
- No existe staging alojado. Las pruebas automáticas usan PostgreSQL efímero dentro de GitHub Actions.
- Flujo canónico: rama de trabajo → PR a `main` → Compuerta → merge → Vercel Production → smoke → tag `vX.Y.Z`.
- Toda actualización de Production debe incrementar la versión SemVer en `package.json` y `package-lock.json`.

## Último bloque consolidado

- Se corrigió el polling de notificaciones para no depender de identificadores de Server Actions entre deployments.
- Supervisión excluye turnos históricos archivados.
- Vercel Production y Neon `production` son el único entorno operativo.
- La versión visible de la aplicación y `/api/health/version` provienen de `package.json`.

## Reglas de continuidad

1. GitHub es la fuente de verdad del código.
2. `main` siempre debe ser desplegable.
3. Trabajo funcional normal: rama + PR a `main`; nunca commit directo.
4. La Compuerta debe quedar verde antes del merge.
5. No usar Neon Production para desarrollo interactivo, fixtures ni pruebas.
6. No crear otro hosting, staging persistente o rama de base de datos sin instrucción humana explícita.
7. Cada Production verificada debe tener un tag único `vX.Y.Z`.

## Versionado

- PATCH: correcciones sin cambio funcional incompatible, por ejemplo `1.0.0 → 1.0.1`.
- MINOR: función nueva compatible, por ejemplo `1.0.1 → 1.1.0`.
- MAJOR: cambio incompatible o rediseño contractual importante, por ejemplo `1.9.0 → 2.0.0`.

## Siguiente acción

Continuar siempre desde:

`feature/fix branch → PR main → Compuerta → Vercel Production → Neon production → verificación → tag vX.Y.Z`.

## Mensaje para otros agentes

No reintroducir hosting alternativo, ramas intermedias de release, previews hospedados ni bases persistentes de desarrollo como parte del flujo. Para pruebas usa el PostgreSQL efímero de CI o una base local desechable que nunca sea Production.
