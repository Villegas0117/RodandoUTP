# BACKEND_NEON.md — Rodando UTP

Documentación técnica del backend desplegado en Neon Functions.

---

## 1. Resumen

El backend de Rodando UTP está implementado con **Neon Functions** (Hono + TypeScript) y utiliza **PostgreSQL** como base de datos, con conexión mediante la biblioteca `pg` y un pool de conexiones reutilizable.

---

## 2. Configuración de Neon CLI

### Herramientas verificadas

| Herramienta | Versión |
|-------------|---------|
| Node.js | v24.22.2 |
| npm | 11.19.1 |
| Git | 2.53.0 |
| Neon CLI | 8.16.0 |

### Autenticación

```bash
neon auth
```
Sesión autenticada en el perfil `DEFAULT`.

### Vinculación al proyecto

El proyecto ya estaba vinculado mediante `neon link`. Estado verificado con:

```bash
neon status
```

Resultado:
- Proyecto: `my-first-project (late-wildflower-65923905)`
- Rama: `production (br-sparkling-snow-b75n6yfe)`
- Región: `aws-us-east-1`
- PostgreSQL: v18

---

## 3. Neon Functions

### Configuración (`neon.ts`)

```typescript
import { defineConfig } from '@neon/config';

export default defineConfig({
  functions: {
    api: {
      name: 'api',
      source: './functions/api.ts',
      env: {
        CORS_ORIGIN: 'https://villegas0117.github.io',
      },
    },
  },
});
```

### Despliegue

```bash
neon deploy
```

URL de la función:
```
https://br-sparkling-snow-b75n6yfe-api.compute.c-13.us-east-1.aws.neon.tech/
```

### Variables de entorno (`.env.local`, no se publica)

```
DATABASE_URL=postgresql://...
DATABASE_URL_UNPOOLED=postgresql://...
NEON_BRANCH=production
NEON_FUNCTION_API_BASE_URL=https://...
```

---

## 4. PostgreSQL

### Instancia existente (aprovechada, no creada nueva)

| Campo | Valor |
|-------|-------|
| Host | `ep-small-waterfall-b7qfdc4e-pooler.c-13.us-east-1.aws.neon.tech` |
| Puerto | `5432` |
| Base de datos | `neondb` |
| Usuario | `neondb_owner` |

### Conexión (`backend/src/db.ts`)

- Biblioteca: `pg` (v8.13.0)
- Pool: `new Pool()` con `max: 10`, `idleTimeoutMillis: 30000`
- SSL: `rejectUnauthorized: false` (requerido por Neon)
- Consulta parametrizada mediante `$1`, `$2`, etc.
- `checkConnection()` ejecuta `SELECT NOW()` para verificar

### Migración (`backend/migrations/001_init.sql`)

Tablas creadas:

| Tabla | Descripción |
|-------|-------------|
| `zonas` | Zonas geográficas (Cholula, Angelópolis, etc.) |
| `usuarios` | Usuarios con rol, contraseña hasheada, zona, matrícula |
| `rutas` | Rutas publicadas por conductores |
| `reservas` | Reservas de pasajeros (UNIQUE ruta_id + pasajero_id) |
| `sesiones` | Tokens de sesión con expiración (8 horas) |
| `bitacora` | Registro de acciones administrativas |

Índices: `idx_rutas_origen`, `idx_reservas_usuario`, `idx_sesiones_usuario`, `idx_usuarios_correo`, etc.

---

## 5. Endpoints implementados

| Método | Ruta | Acceso | Descripción |
|--------|------|--------|-------------|
| GET | `/api/health` | público | Salud del servicio y BD |
| POST | `/api/registro` | público | Registrar usuario |
| POST | `/api/login` | público | Iniciar sesión (cookie HttpOnly) |
| POST | `/api/logout` | sesión | Cerrar sesión |
| GET | `/api/sesion` | público | Sesión actual |
| GET | `/api/zonas` | público | Listar zonas |
| GET | `/api/rutas` | público | Listar rutas (filtros: origen, turno, lugares) |
| GET | `/api/ruta` | público | Detalle de ruta por id |
| POST | `/api/rutas` | sesión | Publicar ruta |
| POST | `/api/reservas` | sesión | Reservar lugar |
| GET | `/api/mis-reservas` | sesión | Historial del pasajero |
| GET | `/api/ia/sugerir` | sesión | Sugerencias de conductores (IA simulada) |
| GET | `/api/ia/mapa` | sesión | Mapa con zonas y sugerencias |
| GET | `/api/admin/usuarios` | admin | Listar usuarios |
| DELETE | `/api/admin/usuarios` | admin | Eliminar usuario |
| GET | `/api/admin/bitacora` | admin | Bitácora de actividad |
| GET/POST | `/api/admin/cache` | admin | Estadísticas y vaciado de caché |
| POST | `/api/admin/reset` | admin | Reiniciar base de datos |

---

## 6. Seguridad

- Contraseñas hasheadas con PBKDF2-HMAC-SHA256 (120,000 iteraciones, sal aleatoria)
- Cookies de sesión: `HttpOnly`, `SameSite=Lax`, expiración 8 horas
- Consultas SQL parametrizadas (prevención de SQL Injection)
- Control de acceso por rol (estudiante / conductor / admin)
- CORS restringido al dominio de GitHub Pages
- No se exponen credenciales ni `DATABASE_URL` al frontend

---

## 7. Pruebas del backend

Todas las pruebas se ejecutaron contra la URL HTTPS real de Neon Functions:

- ✅ `/api/health` responde 200 con `database: connected`
- ✅ Login/admin/estudiante con credenciales correctas
- ✅ Login con contraseña incorrecta → 401
- ✅ Registro de usuario nuevo → 201
- ✅ Registro correo duplicado → 409
- ✅ Registro datos inválidos → 400
- ✅ Sesión persistente tras login
- ✅ Acceso sin sesión a endpoints protegidos → 401/403
- ✅ Zonas (6) y rutas (11)
- ✅ Reservas, mis-reservas, no duplicar reserva
- ✅ No reservar en propia ruta → 409
- ✅ Panel de administrador (solo admin)
- ✅ IA sugerir y mapa (con sesión)
- ✅ Logout invalida sesión
- ✅ CORS: origen de GitHub Pages permitido, otros rechazados

**Resultado: 52/52 pruebas aprobadas.**

---

## 8. Procedimiento de despliegue

1. `cd backend`
2. `npm install` (instala `hono`, `pg`, `typescript`, `@neon/config`)
3. `npx tsc --noEmit` (verifica tipos)
4. `neon deploy` (despliega la función a Neon Functions)
5. Verificar `GET /api/health` en la URL desplegada

---

## 9. Usuarios de prueba

Se crearon **34 usuarios totales** en PostgreSQL:

- 14 usuarios de demostración (1 admin, 6 conductores, 7 estudiantes)
- 20 usuarios de prueba con formato institucional `utpXXXX@alumno.utpuebla.edu.mx`
  - 13 estudiantes, 7 conductores

Todas las contraseñas de prueba: `utp12345` (excepto admin: `admin123`).
