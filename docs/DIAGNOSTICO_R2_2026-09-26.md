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


## Resultado de Production v1.14.2

- Account ID presente, longitud 32 y forma hexadecimal esperada.
- `default`, `us` y `eu`: fallo TLS antes de recibir HTTP
  (`ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE`).
- `fedramp`: transporte disponible, pero HTTP 403.
- Ninguna jurisdicción autenticó con las credenciales actuales.
- Por tanto, no se cambia automáticamente de jurisdicción.

## Resiliencia v1.14.3

Mientras la infraestructura se corrige:

- el Chat deja de equiparar «variables presentes» con «R2 disponible»;
- un probe autenticado con cache corta determina si multimedia está operativa;
- si R2 no responde, adjuntos, stickers personalizados y notas de voz se
  muestran temporalmente no disponibles en lugar de conducir a una subida que
  va a fallar;
- Salud añade `matchesAccessKeyId` para detectar una posible confusión entre
  Account ID y Access Key ID sin revelar ninguno.

Esto no sustituye la reparación de Cloudflare/Vercel. Sólo elimina la calle sin
salida para Recepción mientras se identifica/corrige la configuración raíz.
