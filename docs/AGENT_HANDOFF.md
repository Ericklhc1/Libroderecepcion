# Relevo de agentes — Libro Operativo de Recepción

> Canal persistente de continuidad entre ChatGPT, GitHub Copilot, Cursor/Codex y otros agentes.  
> No guardar secretos, connection strings, passwords, tokens, cookies ni PII.

## Estado actual

- Fecha de referencia: 2026-09-18
- Producción: Netlify `libroderecepcion`
- Rama de producción: `main`
- Base de producción: Neon `production`
- Base destinada a desarrollo: Neon `development`
- Último release funcional conocido: `9deb7fa4914812a03d6649d335bd99ea74000798`
- Estado del release: Netlify READY
- Compuerta previa al merge: verde
- Login Netlify + Neon: verificado funcionando

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

Netlify está conectado al repositorio y se comprobó un deploy disparado desde Codespaces.

Desde 2026-09-18:
- `DATABASE_URL` y `DIRECT_DATABASE_URL` de contextos `dev`, `branch-deploy` y `deploy-preview` apuntan a Neon `development`;
- Production conserva Neon `production`;
- el trabajo funcional debe seguir usando rama distinta de `main`;
- Production no se usa como entorno de prueba.

## Decisiones de continuidad

1. GitHub es la fuente de verdad del código.
2. `PROJECT_CONTEXT.md` contiene memoria técnica de largo plazo.
3. `docs/CIERRE_OPERATIVO_V2.md` contiene el contrato del cierre.
4. Este archivo contiene sólo el estado reciente y el próximo relevo.
5. Trabajo funcional normal se hace por rama + PR + Compuerta.
6. Production no es entorno de experimentación.

## Pendientes inmediatos

- [x] Separar Netlify Preview/branch deploy de Neon Production.
- [x] Retirar el endpoint temporal de diagnóstico de auth.
- [ ] Evitar que el hook de Codespaces dispare Production durante trabajo experimental.
- [ ] Revisar documentación histórica que aún describe Vercel como hosting primario.
- [ ] Rotar la contraseña de la cuenta que fue compartida accidentalmente en una conversación, sin registrar la nueva credencial aquí.

## Siguiente acción

Continuar desde ChatGPT como agente principal con:
`rama de trabajo → Neon development → pruebas → Netlify Preview → PR → Compuerta → main → Production`.

El puente de Copilot queda disponible como apoyo, pero no es requisito para continuar.

## Mensaje para Copilot

Trabaja desde este estado. Antes de cambiar código, comprueba que el Codespace NO usa Neon Production. Si el entorno aún no está aislado, esa configuración es más prioritaria que cualquier nueva función.

## Mensaje para ChatGPT

Copilot debe actualizar este documento cuando termine trabajo significativo. ChatGPT puede leerlo desde GitHub y continuar desde la sección **Siguiente acción**.
