# Diagnóstico R2 · v1.14.2

Fecha: 26/09/2026  
Base: v1.14.1 · `8c99b05b5e0fdda3e07c6322868cd617f153623d`

## Motivo

El healthcheck real de v1.14.1 confirmó que Cloudflare R2 tiene variables
configuradas, pero el HEAD firmado desde Vercel falla antes de recibir una
respuesta HTTP (`TypeError`). Esto coincide con fallos TLS históricos del
fallback de adjuntos del Chat.

## Objetivo

Obtener diagnóstico suficiente sin exponer secretos ni cambiar todavía el
almacenamiento:

- comprobar forma esperada y longitud del Account ID sin devolver su valor;
- probar en paralelo los endpoints S3 R2:
  - `default`;
  - `us`;
  - `eu`;
  - `fedramp`;
- distinguir:
  - transporte disponible;
  - autenticación aceptada;
  - rechazo HTTP;
  - fallo de red/TLS.

## Seguridad

Las sondas son HEAD no destructivos sobre una clave reservada de salud.

La respuesta pública NO contiene:

- Account ID;
- Access Key ID;
- Secret Access Key;
- firma;
- host completo;
- URL;
- cuerpo de respuesta del proveedor.

Sólo devuelve jurisdicción, booleanos de alcance/autenticación, status HTTP y
tipo/código técnico seguro cuando la red falla.

## Interpretación

- `reachable=false` en todas las jurisdicciones: problema de DNS/TLS/red o
  identificador de cuenta incapaz de resolver correctamente.
- `reachable=true` pero ninguna `authenticated=true`: transporte sano, pero
  credenciales/cuenta/jurisdicción no aceptadas.
- una única jurisdicción con `authenticated=true`: candidato fuerte para
  corregir el host operativo de R2.
- varias jurisdicciones autenticadas: no cambiar endpoint automáticamente;
  revisar la configuración del bucket antes.

v1.14.2 es diagnóstica. No introduce fallback en base de datos, no migra
archivos y no cambia reglas de Chat.
