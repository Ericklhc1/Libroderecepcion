# Libro Operativo de Recepción — instrucciones permanentes para Copilot

Este repositorio es un sistema hotelero real y ya está en producción. No reconstruyas el proyecto, no dupliques módulos y no reemplaces arquitectura funcional por una solución nueva salvo instrucción explícita.

## Contexto obligatorio antes de trabajar

Lee en este orden:
1. `AGENTS.md`
2. `PROJECT_CONTEXT.md`
3. `docs/AGENT_HANDOFF.md`
4. Si el cambio toca turnos, cierre, PMS o Caja: `docs/CIERRE_OPERATIVO_V2.md`
5. Si el cambio es estructural: `docs/ARQUITECTURA.md`

La fuente de verdad es el código + esquema + base conectada. La conversación humana aporta requisitos, pero no sustituye la comprobación del estado real.

## Forma de trabajar

- Corrige la causa, no el síntoma.
- Reutiliza servicios, reglas y componentes canónicos.
- No crees una segunda implementación de una regla existente.
- Mantén TypeScript estricto y `noUncheckedIndexedAccess`.
- Autorización siempre en servidor. Ocultar UI nunca sustituye permisos.
- Cambios funcionales deben incluir o actualizar pruebas.
- Antes de declarar algo terminado ejecuta, como mínimo, lint, typecheck y pruebas relevantes. Antes de mergear a `main`, exige `npm run verify` o Compuerta verde.
- No hagas commits directamente a `main` para trabajo funcional normal. Usa una rama y PR.

## Producción y datos

Producción:
- hosting oficial: Vercel, proyecto `libroderecepcion`
- base: Neon, rama `production`
- `main` es la rama de release y es la única rama que Vercel puede desplegar automáticamente

Staging / pruebas reales:
- hosting: Netlify, proyecto `libroderecepcion`
- rama canónica: `preproduction`
- base: Neon `development`
- Netlify nunca debe usar Neon Production

Desarrollo:
- Codespaces/Cursor trabaja en una rama distinta de `main`
- base permitida: Neon `development`
- flujo: feature → PR a `preproduction` → Compuerta → Netlify → validación real → PR `preproduction` a `main` → Vercel
- cada Production verificada en Vercel debe quedar respaldada con un tag `production-*`

Prohibido:
- `prisma migrate reset`, `db:reset`, TRUNCATE, DROP o borrados masivos contra Production
- ejecutar migraciones destructivas sobre Production sin aprobación humana explícita
- imprimir, registrar, copiar al chat o versionar connection strings, passwords, cookies, tokens o secretos
- cambiar `AUTH_SECRET` de Production de forma rutinaria: también deriva la llave de secretos cifrados ya guardados
- usar datos personales reales de huéspedes en fixtures, prompts, logs o documentación

## Reglas de producto que no se revierten

- El rol técnico superior se llama exclusivamente **Administrador de sistema** y queda fuera de la operación habitual.
- El PMS/FNS es fuente de estado PMS, no de hechos físicos como devolución de llaves.
- Check-out no elimina pendientes no resueltos; éstos sobreviven a la estadía hasta resolverse.
- Una reserva puede tener más de un segmento temporal, incluso misma habitación/mismo día.
- Cierre canónico:
  `INICIAR CIERRE → CAJA → PMS → CONCILIACIÓN → PENDIENTES/ELEMENTOS → ENTREGAR → RECIBIR → VALIDACIÓN DE JEFATURA`
- No existe un segundo botón operativo «Cerrar turno». Recibir cierra atómicamente el turno saliente.
- Cierre PMS exige `ACTIVIDAD + SALIDAS + IN_HOUSE`, frescos (≤15 min según timestamp impreso por FNS).
- Todo cierre crea validación posterior crítica asignada a `EHerrera`.
- La validación administrativa no bloquea el siguiente turno.
- La IA interpreta lenguaje y llama operaciones determinísticas; no inventa reglas operativas.
- Fronti debe reportar fallos e ideas de mejora no triviales a Supervisor + Administrador de sistema con evidencia concreta y sin duplicar avisos.

## Protocolo ChatGPT ↔ Copilot

`docs/AGENT_HANDOFF.md` es el canal de relevo compartido.

Antes de empezar una tarea:
- léelo y confirma que entiendes el estado vigente;
- si contradice el código, el código gana y debes corregir el handoff.

Después de un cambio significativo, actualiza el handoff con:
- fecha/hora aproximada
- agente/entorno
- rama y último commit
- objetivo realizado
- archivos clave modificados
- pruebas ejecutadas y resultado
- deploy/preview si aplica
- pendientes
- riesgos o decisiones que necesitan aprobación
- siguiente acción recomendada

No pongas secretos, credenciales ni PII en el handoff.
