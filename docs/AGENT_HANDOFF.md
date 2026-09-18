# Relevo de agentes — Libro Operativo de Recepción

> Canal persistente de continuidad entre ChatGPT, GitHub Copilot, Cursor/Codex y otros agentes.  
> No guardar secretos, connection strings, passwords, tokens, cookies ni PII.

## Estado actual

- Fecha de referencia: 2026-09-18
- Production oficial: Vercel `libroderecepcion`
- Rama de Production: `main`
- Base de Production: Neon `production`
- Staging real: Netlify `libroderecepcion`
- Rama de staging: `preproduction`
- Base de staging/desarrollo: Neon `development`
- Netlify quedó aislado de Neon Production
- Vercel puede generar previews de ramas; sólo `main` representa Production
- Compuerta corre en PR/push de `preproduction` y `main`
- Pipeline: feature → preproduction → Netlify → validación → main → Vercel → tag `production-*`
- Production no fue promovida durante la auditoría de IA; continúa intacta hasta validar staging

## Último bloque consolidado

Se consolidó Cierre Operativo V2:
- Recibir cierra atómicamente el turno saliente.
- Se retiró el cierre manual del flujo operativo normal.
- El cierre manual queda reservado a recuperación administrativa auditada.
- Caja cerrada es precondición cuando el módulo está activo.
- Para cierre PMS se exige `ACTIVIDAD + SALIDAS + IN_HOUSE`.
- Los informes de cierre deben ser frescos (≤15 min según timestamp impreso FNS).
- La validación posterior del cierre genera una tarea crítica asignada a `EHerrera`.
- Ayuda/tutoriales/documentación se alinearon con ese flujo.
- El paquete pasó lint, TypeScript, regresiones y build antes del merge.

## Infraestructura de desarrollo

Desde 2026-09-18:
- Netlify es exclusivamente staging/prueba real y sus conexiones apuntan a Neon `development`;
- Vercel aloja Production en `main` y puede generar previews de ramas de trabajo;
- `preproduction` es la rama canónica de staging;
- el trabajo funcional se hace en ramas feature y entra primero por PR a `preproduction`;
- Production no se usa como entorno de prueba;
- el repo incluye un empaquetado de `preproduction` para poder desplegar exactamente el SHA validado.

## Decisiones de continuidad

1. GitHub es la fuente de verdad del código.
2. `PROJECT_CONTEXT.md` contiene memoria técnica de largo plazo.
3. `docs/CIERRE_OPERATIVO_V2.md` contiene el contrato del cierre.
4. Este archivo contiene sólo el estado reciente y el próximo relevo.
5. Trabajo funcional normal se hace por rama + PR + Compuerta.
6. Production no es entorno de experimentación.

## Pendientes inmediatos

- [x] Separar Netlify de Neon Production.
- [x] Retirar el endpoint temporal de diagnóstico de auth.
- [x] Retirar la política rígida que intentaba bloquear previews de Vercel por rama.
- [x] Restaurar Vercel como hosting oficial de Production y Netlify como staging.
- [x] Integrar Fronti al Inicio con bandeja determinística y briefing contextual.
- [x] Fronti reporta fallos/mejoras a Supervisor + Administrador con deduplicación.
- [ ] Terminar el disparo automático de `preproduction` hacia Netlify sin paso manual.
- [ ] Integrar Fronti en ficha de Habitación, Turno y Supervisión.
- [ ] Rotar la contraseña de la cuenta que fue compartida accidentalmente en una conversación, sin registrar la nueva credencial aquí.

## Siguiente acción

Continuar desde ChatGPT como agente principal con:
`feature → PR preproduction → Compuerta → Netlify + Neon development → validación → PR main → Vercel + Neon Production → tag production-*`.

El puente de Copilot queda disponible como apoyo, pero no es requisito para continuar.

## Mensaje para Copilot

Trabaja desde este estado. Antes de cambiar código, comprueba que el Codespace NO usa Neon Production. Si el entorno aún no está aislado, esa configuración es más prioritaria que cualquier nueva función.

## Mensaje para ChatGPT

Copilot debe actualizar este documento cuando termine trabajo significativo. ChatGPT puede leerlo desde GitHub y continuar desde la sección **Siguiente acción**.
