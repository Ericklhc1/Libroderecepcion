# AGENTS.md — contrato para agentes de desarrollo

## Identidad del proyecto

Proyecto: **Libro Operativo de Recepción**
Repositorio: `Ericklhc1/Libroderecepcion`
Aplicación interna para la operación de Recepción de Hotel HW Libertad.

Este archivo existe para que Copilot, Codex, Cursor y otros agentes trabajen bajo el mismo contrato.

## Primeros 60 segundos

1. Ejecuta `git status --short --branch`.
2. Confirma que NO estás desarrollando directamente en `main`.
3. Lee `PROJECT_CONTEXT.md` y `docs/AGENT_HANDOFF.md`.
4. Confirma qué base usa el entorno sin imprimir su URL. Debe ser Neon `development` para desarrollo.
5. Si vas a tocar una función existente, localiza primero su servicio, action, dominio y pruebas.
6. Si la tarea es ambigua, inspecciona antes de crear código.

## Jerarquía de verdad

1. Invariantes de base y esquema
2. Código vigente + pruebas
3. `docs/CIERRE_OPERATIVO_V2.md` para cierre
4. `PROJECT_CONTEXT.md` y `docs/ARQUITECTURA.md`
5. `docs/AGENT_HANDOFF.md` para continuidad reciente
6. La instrucción humana actual

Si dos niveles chocan, no improvises: explica el conflicto y corrige el documento obsoleto cuando corresponda.

## Disciplina de cambios

- Una regla = una implementación canónica.
- Servicios contienen reglas y transacciones; Server Actions validan entrada y permisos; UI no decide reglas.
- Toda transición importante debe ser atómica cuando afecta varias entidades.
- Los estados históricos incoherentes se reparan mediante mecanismos administrativos auditados, no atajos ocultos.
- Nada operativo se borra físicamente desde UI.
- No cambies nombres de roles, estados o conceptos por estética.
- No conviertas el Libro en un PMS paralelo.

## Calidad mínima

Antes de pedir merge:
```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Preferencia: `npm run verify`.

Si una prueba falla de forma aparentemente intermitente:
1. no la ignores;
2. reprodúcela;
3. determina si es flaky o regresión;
4. documenta el resultado en `docs/AGENT_HANDOFF.md`.

## Git

- Trabajo funcional: rama + PR.
- Mantén commits entendibles.
- No mezcles refactors no relacionados con el objetivo.
- No fuerces push sobre ramas compartidas.
- No merges con Compuerta roja.
- `main` debe representar una versión desplegable.

## Desarrollo seguro

El entorno de desarrollo debe usar Neon `development`. Nunca copies a archivos del repo las variables de Neon o Netlify.

Antes de una migración:
- revisa SQL generado;
- confirma que apunta a development;
- prueba sobre development;
- distingue migración de esquema de reparación de datos.

Production sólo se toca como release deliberado.

## Relevo entre agentes

Al finalizar una sesión significativa, actualiza `docs/AGENT_HANDOFF.md`.
El objetivo es que otro agente pueda continuar en menos de dos minutos sin leer conversaciones externas.
