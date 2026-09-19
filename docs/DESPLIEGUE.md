# Despliegue y versiones

## Arquitectura de Production

El Libro Operativo utiliza un único entorno alojado:

`GitHub main → Vercel Production → Neon production`

- GitHub es la fuente de verdad del código.
- `main` es la única rama que Vercel puede desplegar.
- Vercel `libroderecepcion` es el único hosting operativo.
- Neon `production` es la única base persistente del sistema.
- No hay staging alojado.
- La Compuerta usa PostgreSQL efímero en GitHub Actions y no toca Neon Production.

## Flujo de actualización

1. Crear una rama de trabajo desde `main`.
2. Implementar el cambio y sus pruebas.
3. Incrementar la versión en `package.json` y `package-lock.json`.
4. Abrir PR directamente a `main`.
5. La Compuerta valida versión, Prisma, lint, TypeScript, regresiones y build.
6. Con la Compuerta verde, mergear.
7. Vercel despliega automáticamente el SHA de `main`.
8. El workflow de release espera a que `/api/health/version` confirme proveedor, SHA y versión.
9. Se ejecuta smoke de `/login`.
10. Si todo está sano, GitHub crea el tag `vX.Y.Z`.

Si Vercel no sirve exactamente el SHA y la versión esperados, no se crea el tag.

## Versionado SemVer

La aplicación usa `MAJOR.MINOR.PATCH`.

- PATCH: corrección o ajuste compatible. Ejemplo: `1.0.0 → 1.0.1`.
- MINOR: nueva capacidad compatible. Ejemplo: `1.0.1 → 1.1.0`.
- MAJOR: cambio incompatible o rediseño contractual importante. Ejemplo: `1.9.0 → 2.0.0`.

Toda actualización que vaya a Production debe incrementar la versión. La Compuerta bloquea PR a `main` que conserven o reduzcan la versión.

## Identificación de una Production

La fuente canónica es:

`GET /api/health/version`

Debe devolver:

- `provider: "vercel"`
- `version: "X.Y.Z"`
- `commit: "<SHA de main>"`

La interfaz muestra además `Libro Operativo vX.Y.Z`.

## Base de datos

Production usa exclusivamente Neon `production`.

- `DATABASE_URL`: conexión agrupada.
- `DIRECT_DATABASE_URL`: conexión directa usada por migraciones.
- Nunca imprimir ni versionar estas cadenas.
- `prisma migrate deploy` se ejecuta durante el build de Vercel.
- No ejecutar `migrate reset`, `db:reset`, TRUNCATE, DROP o borrados masivos sobre Production.
- Una migración potencialmente destructiva requiere aprobación humana explícita.

## Desarrollo y pruebas

No existe una segunda base persistente obligatoria.

- GitHub Actions levanta PostgreSQL efímero para lint/tipos/regresiones/build.
- Un entorno local o Codespace debe usar una base local/desechable propia.
- Nunca conectar un entorno de desarrollo a Neon `production`.
- No crear previews hospedados o ramas Neon de desarrollo salvo instrucción humana explícita.

## Rollback

Cada tag `vX.Y.Z` representa una Production que Vercel sirvió y que pasó smoke.

Ante una regresión:

1. identificar el último tag sano;
2. restaurar/promover ese commit;
3. verificar nuevamente SHA, versión y smoke;
4. evaluar migraciones de base por separado: revertir código no revierte datos automáticamente.

## Reglas que no se negocian

- Sólo `main` despliega.
- Sólo Vercel aloja la aplicación.
- Sólo Neon `production` contiene la base operativa.
- Ningún cambio entra a Production sin Compuerta verde.
- Ninguna Production queda sin versión.
