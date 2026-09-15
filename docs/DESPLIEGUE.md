# Poner el sistema en línea

Esta guía deja la aplicación Next.js funcionando en un dominio público, con
inicio de sesión por contraseña y base de datos PostgreSQL.

No hace falta usar la consola en ningún momento: el despliegue aplica las
migraciones por sí solo y la primera cuenta se crea desde el navegador.

## Lo que ya está resuelto

- El código está en GitHub, en este repositorio.
- El despliegue ejecuta `prisma generate && prisma migrate deploy && next build`
  (guion `vercel-build`): las tablas se crean solas en el primer despliegue y
  en cada actualización posterior.
- La primera visita abre `/instalacion`, donde se crea el hotel y la cuenta de
  Administrador de sistema. Esa pantalla se desactiva en cuanto existe una
  cuenta.
- No se cargan datos de demostración: el sistema arranca vacío y listo para
  operar.

## Camino recomendado: Vercel + Neon (unos diez minutos, sin consola)

### 1. Crear la base de datos

1. Entra a <https://neon.com> y pulsa **Sign up**. Puedes entrar con la misma
   cuenta de GitHub. El plan gratuito alcanza para una recepción.
2. **Create project**. Ponle un nombre (por ejemplo `hotel-hw-libertad`) y
   elige la región más cercana; para Chile, São Paulo (`sa-east-1`) es la mejor
   opción de las disponibles.
3. Al terminar, Neon muestra un panel **Connection string**. Ahí hay un
   interruptor llamado **Connection pooling**. Necesitas copiar la cadena dos
   veces:
   - Con *Connection pooling* **activado** → es la agrupada, y va en
     `DATABASE_URL`. Se reconoce porque el servidor lleva `-pooler` en el
     nombre.
   - Con *Connection pooling* **desactivado** → es la directa, y va en
     `DIRECT_DATABASE_URL`. No lleva `-pooler`.

   Las dos terminan en `?sslmode=require`: déjalo tal cual. Prisma necesita la
   directa para crear las tablas, y la agrupada es la que usa la aplicación
   mientras opera.

   > En el plan gratuito la base se duerme si nadie la usa. La primera visita
   > del día puede tardar unos segundos; después va normal.

### 2. Desplegar

1. Entra a <https://vercel.com> con tu cuenta de GitHub.
2. **Add New → Project** e importa el repositorio `libroderecepcion`.
3. **Importante: elige la rama.** Vercel propone la rama principal del
   repositorio. Si el trabajo todavía vive en la rama de desarrollo
   (`claude/libro-operativo-recepcion-eshapj`), abre **Settings → Git →
   Production Branch** y escribe ese nombre; si el trabajo ya está fusionado en
   la rama principal, no hay nada que cambiar.
4. En **Environment Variables** agrega:

   | Nombre | Valor |
   | --- | --- |
   | `DATABASE_URL` | la cadena *pooled* de Neon |
   | `DIRECT_DATABASE_URL` | la cadena *direct* de Neon |
   | `AUTH_SECRET` | una cadena aleatoria de 48 caracteres o más |
   | `SESSION_TTL_HOURS` | `12` |
   | `CREDENTIALS_MAIL_TO` | `recepcion@hoteleshw.com` |

   Para `AUTH_SECRET` sirve cualquier texto largo e impredecible; no se
   comparte con nadie y puede cambiarse después (al cambiarlo se cierran las
   sesiones abiertas). Si tienes Node a mano, una forma de generarlo es:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
   ```

   Las variables de correo (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
   `SMTP_PASSWORD`, `MAIL_FROM`) son opcionales. Sin ellas el sistema funciona
   igual, pero al crear un usuario muestra la clave en pantalla en lugar de
   enviarla por correo, y lo avisa.

5. **Deploy**. Tarda unos minutos. El primer despliegue crea las tablas solo.

### 3. Crear la primera cuenta

Abre el dominio que entrega Vercel. Aparecerá la pantalla de instalación:
nombre del hotel, tu nombre, tu correo y tu contraseña. Al enviarla quedas como
Administrador de sistema y el sistema empieza a operar.

### 4. Dar de alta al equipo

Desde **Administración → Usuarios**: cada persona con su rol. El sistema exige
que cambien la contraseña en su primer ingreso.

Luego, en **Administración → Programación de turnos**, asigna mañana, tarde y
noche del día. Con eso el equipo ya puede iniciar turno.

## Alternativas equivalentes

Cualquier plataforma que ejecute Node.js sirve. Lo único indispensable es que
el arranque ejecute `npm run vercel-build` (o `prisma migrate deploy` antes de
`next build`) y que estén definidas las cuatro variables de entorno.

- **Railway** o **Render**: incluyen PostgreSQL administrado en el mismo panel;
  en ese caso `DATABASE_URL` y `DIRECT_DATABASE_URL` son la misma cadena.
- **Supabase** como base de datos: usa el puerto 6543 (*pooler*) para
  `DATABASE_URL` y el 5432 para `DIRECT_DATABASE_URL`.

## Después del despliegue

- **Copias de seguridad**: actívalas en el proveedor de la base de datos. Es lo
  único que no depende de la aplicación.
- **Dominio propio**: se agrega en el panel de Vercel; el sistema no requiere
  configuración adicional.
- **Actualizaciones**: cada `git push` a la rama conectada despliega de nuevo y
  aplica las migraciones pendientes.
- **Cambiar el nombre del hotel**: Administración → Parámetros.

## Si algo falla

| Síntoma | Causa habitual |
| --- | --- |
| El despliegue falla en `migrate deploy` | `DIRECT_DATABASE_URL` apunta al *pooler*; debe ser la conexión directa |
| «Configuración de entorno inválida» | Falta `AUTH_SECRET` o tiene menos de 32 caracteres |
| Sesiones que se cierran al instante | `AUTH_SECRET` cambia entre despliegues; fíjalo como variable de entorno |
| La pantalla de instalación no aparece | Ya existe una cuenta: entra por `/login` |
