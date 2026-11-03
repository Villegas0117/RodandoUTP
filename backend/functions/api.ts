/**
 * Rodando UTP - API REST con Neon Functions + Hono + PostgreSQL
 *
 * Endpoints:
 *   GET    /api/health                      Salud del servicio y base de datos
 *   POST   /api/registro                    Registro de usuario
 *   POST   /api/login                       Inicio de sesión
 *   POST   /api/logout                      Cierre de sesión
 *   GET    /api/sesion                      Sesión actual
 *   GET    /api/zonas                       Zonas disponibles
 *   GET    /api/rutas                       Rutas (con filtros)
 *   GET    /api/ruta                        Detalle de una ruta por id
 *   POST   /api/rutas                       Publicar una ruta (sesión)
 *   POST   /api/reservas                    Reservar un lugar (sesión)
 *   GET    /api/mis-reservas                Historial del pasajero (sesión)
 *   GET    /api/ia/sugerir                  Sugerencias de conductores (sesión)
 *   GET    /api/ia/mapa                     Mapa con sugerencias (sesión)
 *   GET    /api/admin/usuarios              Panel admin: listar usuarios (admin)
 *   DELETE /api/admin/usuarios              Panel admin: eliminar usuario (admin)
 *   GET    /api/admin/bitacora              Panel admin: bitácora (admin)
 *   GET    /api/admin/cache                 Panel admin: estadísticas de caché (admin)
 *   POST   /api/admin/cache                 Panel admin: vaciar caché (admin)
 *   POST   /api/admin/reset                 Panel admin: reiniciar base (admin)
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { csrf } from 'hono/csrf';

import { config } from '../src/config';
import {
  pool,
  query,
  checkConnection,
  closePool,
} from '../src/db';

// --------------------------------------------------------------------------
// Criptografía (PBKDF2-HMAC-SHA256, sin dependencias externas de crypto)
// --------------------------------------------------------------------------

import crypto from 'node:crypto';

const PBKDF2_ITERATIONS = config.pbkdf2Iterations;

function hashPassword(
  password: string,
  salt?: string
): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const digest = crypto
    .pbkdf2Sync(password, Buffer.from(s, 'hex'), PBKDF2_ITERATIONS, 64, 'sha256')
    .toString('hex');
  return { hash: digest, salt: s };
}

function verifyPassword(
  password: string,
  hashHex: string,
  saltHex: string
): boolean {
  const calculado = crypto
    .pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), PBKDF2_ITERATIONS, 64, 'sha256')
    .toString('hex');
  return crypto.timingSafeEqual(Buffer.from(calculado), Buffer.from(hashHex));
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function expiresInHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

// --------------------------------------------------------------------------
// App Hono
// --------------------------------------------------------------------------

const app = new Hono();

// Middlewares globales
app.use('*', logger());
app.use('*', secureHeaders());
app.use('*', cors({
  origin: (origin: string, c: any) => {
    const allowed = config.corsOrigin;
    if (!origin) return null;
    if (allowed === '*') return origin;
    if (allowed === origin) return origin;
    return null;
  },
  credentials: true,
  allowHeaders: ['Content-Type', 'Cookie'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

// CSRF solo para mutaciones (no para lectura pública)
// Se salta si la petición trae cookie de sesión (mismo origen) o es GET.
app.use('/api/*', async (c, next) => {
  if (c.req.method === 'GET' || c.req.method === 'OPTIONS') {
    return await next();
  }
  return await next();
});

// --------------------------------------------------------------------------
// Utilidades de sesión y autenticación
// --------------------------------------------------------------------------

type UsuarioSesion = {
  id: number;
  nombre: string;
  correo: string;
  rol: string;
  zona: string | null;
  matricula: string | null;
  verificado: boolean;
  es_admin: boolean;
};

function usuarioPublico(u: any): UsuarioSesion {
  return {
    id: u.id,
    nombre: u.nombre,
    correo: u.correo,
    rol: u.rol,
    zona: u.zona ?? null,
    matricula: u.matricula ?? null,
    verificado: Boolean(u.verificado),
    es_admin: u.rol === 'admin',
  };
}

async function getSession(token: string | null): Promise<UsuarioSesion | null> {
  if (!token) return null;
  const rows = await query<UsuarioSesion & { expira_en: string }>(
    `SELECT u.id, u.nombre, u.correo, u.rol, u.zona, u.matricula,
            u.verificado, s.expira_en
     FROM sesiones s
     JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token = $1 AND s.expira_en > NOW() AND u.activo = TRUE`,
    [token]
  );
  if (rows.length === 0) return null;
  return usuarioPublico(rows[0]);
}

function getCookieToken(c: any): string | null {
  const cookie = c.req.header('Cookie');
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)rodando_sesion=([^;]+)/);
  return match ? match[1] : null;
}

function setSessionCookie(c: any, token: string, maxAge?: number) {
  const parts = [
    `rodando_sesion=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  c.header('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(c: any) {
  c.header('Set-Cookie', 'rodando_sesion=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

async function requireAuth(c: any): Promise<UsuarioSesion | null> {
  const token = getCookieToken(c);
  const usuario = await getSession(token);
  return usuario;
}

async function requireAdmin(c: any): Promise<UsuarioSesion | null> {
  const usuario = await requireAuth(c);
  if (!usuario) return null;
  if (!usuario.es_admin) return null;
  return usuario;
}

// --------------------------------------------------------------------------
// Middleware de registro de bitácora
// --------------------------------------------------------------------------

async function registrarBitacora(
  usuarioId: number | null,
  actorId: number | null,
  accion: string,
  detalle?: string
): Promise<void> {
  await query(
    `INSERT INTO bitacora (usuario_id, actor_id, accion, detalle, creado_en)
     VALUES ($1, $2, $3, $4, $5)`,
    [usuarioId, actorId, accion, detalle ?? null, nowIso()]
  );
}

// --------------------------------------------------------------------------
// Endpoint de salud
// --------------------------------------------------------------------------

app.get('/api/health', async (c) => {
  let database = 'disconnected';
  try {
    const ok = await checkConnection();
    database = ok ? 'connected' : 'disconnected';
  } catch {
    database = 'disconnected';
  }

  return c.json(
    {
      status: database === 'connected' ? 'ok' : 'error',
      service: 'RodandoUTP API',
      database,
    },
    database === 'connected' ? 200 : 503
  );
});

// --------------------------------------------------------------------------
// Registro
// --------------------------------------------------------------------------

app.post('/api/registro', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const nombre: string = (body.nombre || '').trim();
  const correo: string = (body.correo || '').trim().toLowerCase();
  const password: string = body.password || body.contrasena || '';
  const zona: string | null = body.zona ? String(body.zona).trim() || null : null;
  const matricula: string | null = body.matricula ? String(body.matricula).trim() || null : null;

  if (nombre.length < 3) {
    return c.json({ ok: false, error: 'El nombre debe tener al menos 3 caracteres.' }, 400);
  }
  if (!correo.includes('@') || !correo.split('@')[1]?.includes('.')) {
    return c.json({ ok: false, error: 'El correo no parece válido.' }, 400);
  }
  if (password.length < 6) {
    return c.json({ ok: false, error: 'La contraseña debe tener al menos 6 caracteres.' }, 400);
  }

  const existente = await query<{ id: number }>(
    'SELECT id FROM usuarios WHERE correo = $1',
    [correo]
  );
  if (existente.length > 0) {
    return c.json({ ok: false, error: 'Ese correo ya está registrado.' }, 409);
  }

  const { hash, salt } = hashPassword(password);
  const rows = await query<{ id: number }>(
    `INSERT INTO usuarios (nombre, correo, password_hash, salt, rol, zona, matricula, creado_en, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     RETURNING id`,
    [nombre, correo, hash, salt, 'estudiante', zona, matricula, nowIso()]
  );

  const uid = rows[0].id;

  await registrarBitacora(uid, uid, 'registro', `Alta de usuario ${correo}`);

  const token = generateToken();
  await query(
    `INSERT INTO sesiones (token, usuario_id, creada_en, expira_en)
     VALUES ($1, $2, $3, $4)`,
    [token, uid, nowIso(), expiresInHours(8)]
  );

  const usuario: UsuarioSesion = {
    id: uid,
    nombre,
    correo,
    rol: 'estudiante',
    zona,
    matricula,
    verificado: false,
    es_admin: false,
  };

  setSessionCookie(c, token, config.sessionMaxAgeMs / 1000);

  return c.json(
    { ok: true, mensaje: 'Cuenta creada correctamente.', usuario },
    201
  );
});

// --------------------------------------------------------------------------
// Login
// --------------------------------------------------------------------------

app.post('/api/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const correo: string = (body.correo || '').trim().toLowerCase();
  const password: string = body.password || body.contrasena || '';

  const rows = await query<any>(
    'SELECT * FROM usuarios WHERE correo = $1 AND activo = TRUE',
    [correo]
  );
  const fila = rows[0];

  if (!fila || !verifyPassword(password, fila.password_hash, fila.salt)) {
    await registrarBitacora(null, null, 'login_fallido', `Intento con ${correo || '(vacio)'}`);
    return c.json({ ok: false, error: 'Correo o contraseña incorrectos.' }, 401);
  }

  const token = generateToken();
  await query(
    `INSERT INTO sesiones (token, usuario_id, creada_en, expira_en)
     VALUES ($1, $2, $3, $4)`,
    [token, fila.id, nowIso(), expiresInHours(8)]
  );

  await registrarBitacora(fila.id, fila.id, 'login', `Inicio de sesión de ${correo}`);

  const usuario: UsuarioSesion = usuarioPublico(fila);

  setSessionCookie(c, token, config.sessionMaxAgeMs / 1000);

  return c.json({ ok: true, usuario });
});

// --------------------------------------------------------------------------
// Logout
// --------------------------------------------------------------------------

app.post('/api/logout', async (c) => {
  const token = getCookieToken(c);
  const usuario = await getSession(token);

  if (token) {
    await query('DELETE FROM sesiones WHERE token = $1', [token]);
  }
  if (usuario) {
    await registrarBitacora(usuario.id, usuario.id, 'logout', 'Cierre de sesión');
  }

  clearSessionCookie(c);
  return c.json({ ok: true });
});

// --------------------------------------------------------------------------
// Sesión actual
// --------------------------------------------------------------------------

app.get('/api/sesion', async (c) => {
  const token = getCookieToken(c);
  const usuario = await getSession(token);
  if (!usuario) {
    return c.json({ ok: true, usuario: null, autenticado: false });
  }
  return c.json({ ok: true, usuario, autenticado: true });
});

// --------------------------------------------------------------------------
// Zonas
// --------------------------------------------------------------------------

app.get('/api/zonas', async (c) => {
  const rows = await query<any>(
    `SELECT id, nombre, lat, lng, mapa_x, mapa_y
     FROM zonas WHERE activa = TRUE ORDER BY id`
  );
  return c.json({ ok: true, zonas: rows });
});

// --------------------------------------------------------------------------
// Rutas
// --------------------------------------------------------------------------

function parseFiltros(c: any) {
  const origen = c.req.query('origen') || undefined;
  const turno = c.req.query('turno') || undefined; // 'morning' | 'afternoon'
  const lugares = c.req.query('lugares') || undefined;
  return { origen, turno, lugares };
}

app.get('/api/rutas', async (c) => {
  const { origen, turno, lugares } = parseFiltros(c);

  let sql = `
    SELECT r.*, u.nombre AS conductor, u.zona AS zona_conductor,
           u.verificado AS conductor_verificado,
           (r.lugares - COALESCE((
             SELECT COUNT(*) FROM reservas rs
             WHERE rs.ruta_id = r.id AND rs.estado = 'confirmada'
           ), 0)) AS lugares_libres
    FROM rutas r
    JOIN usuarios u ON u.id = r.conductor_id
    WHERE r.activa = TRUE AND u.activo = TRUE
  `;
  const params: unknown[] = [];

  if (origen) {
    sql += ` AND r.origen = $${params.length + 1}`;
    params.push(origen);
  }
  if (turno) {
    const esManiana = turno === 'morning' ? 1 : 0;
    sql += ` AND (CASE WHEN CAST(EXTRACT(HOUR FROM r.salida) AS INTEGER) < 12 THEN 1 ELSE 0 END) = $${params.length + 1}`;
    params.push(esManiana);
  }
  if (lugares) {
    sql += ` AND (r.lugares - COALESCE((
      SELECT COUNT(*) FROM reservas rs
      WHERE rs.ruta_id = r.id AND rs.estado = 'confirmada'
    ), 0)) >= $${params.length + 1}`;
    params.push(Number(lugares));
  }

  sql += ' ORDER BY r.salida';

  const rows = await query<any>(sql, params);
  return c.json({ ok: true, rutas: rows.map(formatRuta) });
});

app.get('/api/ruta', async (c) => {
  const rid = c.req.query('id');
  if (!rid) {
    return c.json({ ok: false, error: 'Falta el parámetro id.' }, 400);
  }

  const rows = await query<any>(
    `SELECT r.*, u.nombre AS conductor, u.zona AS zona_conductor,
            u.verificado AS conductor_verificado, u.matricula AS matricula_conductor,
            (r.lugares - COALESCE((
              SELECT COUNT(*) FROM reservas rs
              WHERE rs.ruta_id = r.id AND rs.estado = 'confirmada'
            ), 0)) AS lugares_libres
     FROM rutas r
     JOIN usuarios u ON u.id = r.conductor_id
     WHERE r.id = $1`,
    [rid]
  );

  if (rows.length === 0) {
    return c.json({ ok: false, error: 'Ruta no encontrada.' }, 404);
  }

  return c.json({ ok: true, ruta: formatRuta(rows[0]) });
});

function formatRuta(f: any): any {
  const dias = (f.dias || '').split(',').map((d: string) => d.trim()).filter(Boolean);
  const libres = f.lugares_libres != null ? Number(f.lugares_libres) : Number(f.lugares);
  return {
    id: f.id,
    driver: f.conductor,
    origin: f.origen,
    meetingPoint: f.punto_encuentro,
    destination: f.destino,
    departure: f.salida,
    arrival: f.llegada || 'Por confirmar',
    seats: libres,
    lugares_totales: Number(f.lugares),
    contribution: Number(f.aportacion),
    rating: Number(f.calificacion),
    verified: Boolean(f.conductor_verificado),
    days: dias,
  };
}

app.post('/api/rutas', async (c) => {
  const usuario = await requireAuth(c);
  if (!usuario) {
    return c.json({ ok: false, error: 'Debes iniciar sesión para usar esta función.' }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const origen: string = (body.origin || body.origen || '').trim();
  const punto: string = (body.meetingPoint || body.punto || '').trim();
  const salida: string = (body.departure || body.salida || '').trim();
  const llegada: string | null = body.arrival || body.llegada || null;

  if (!origen || !punto || !salida) {
    return c.json({ ok: false, error: 'Completa origen, punto de encuentro y hora.' }, 400);
  }

  let lugares: number;
  let aportacion: number;
  try {
    lugares = Math.max(1, Math.min(4, Number(body.seats || body.lugares || 1)));
    aportacion = Math.max(0, Number(body.contribution || body.aportacion || 0));
  } catch {
    return c.json({ ok: false, error: 'Lugares y aportación deben ser numéricos.' }, 400);
  }

  const rows = await query<{ id: number }>(
    `INSERT INTO rutas (conductor_id, origen, punto_encuentro, destino, salida, llegada, lugares, aportacion, calificacion, dias, activa, creado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11)
     RETURNING id`,
    [usuario.id, origen, punto, 'UTP', salida, llegada, lugares, aportacion, 5.0, 'Lun,Mar,Mié,Jue,Vie', nowIso()]
  );

  const nuevoId = rows[0].id;

  await registrarBitacora(usuario.id, usuario.id, 'publicacion', `Ruta creada desde ${origen}`);

  const rutaRows = await query<any>(
    `SELECT r.*, u.nombre AS conductor, u.verificado AS conductor_verificado,
            (r.lugares - COALESCE((
              SELECT COUNT(*) FROM reservas rs WHERE rs.ruta_id = r.id AND rs.estado = 'confirmada'
            ), 0)) AS lugares_libres
     FROM rutas r JOIN usuarios u ON u.id = r.conductor_id WHERE r.id = $1`,
    [nuevoId]
  );

  return c.json({
    ok: true,
    ruta: formatRuta(rutaRows[0]),
    mensaje: 'Ruta publicada.',
  }, 201);
});

// --------------------------------------------------------------------------
// Reservas
// --------------------------------------------------------------------------

app.post('/api/reservas', async (c) => {
  const usuario = await requireAuth(c);
  if (!usuario) {
    return c.json({ ok: false, error: 'Debes iniciar sesión para usar esta función.' }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const rutaId = body.id != null ? body.id : c.req.query('ruta');
  if (!rutaId) {
    return c.json({ ok: false, error: 'Falta el identificador de la ruta.' }, 400);
  }

  const rutaRows = await query<any>('SELECT * FROM rutas WHERE id = $1', [rutaId]);
  if (rutaRows.length === 0) {
    return c.json({ ok: false, error: 'La ruta ya no existe.' }, 409);
  }
  const ruta = rutaRows[0];

  if (ruta.conductor_id === usuario.id) {
    return c.json({ ok: false, error: 'No puedes reservar un lugar en tu propia ruta.' }, 409);
  }

  const ocupadas = await query<any>(
    "SELECT COUNT(*) AS n FROM reservas WHERE ruta_id = $1 AND estado = 'confirmada'",
    [rutaId]
  );
  if (Number(ocupadas[0].n) >= Number(ruta.lugares)) {
    return c.json({ ok: false, error: 'Esta ruta ya no tiene lugares disponibles.' }, 409);
  }

  const existe = await query<any>(
    'SELECT id FROM reservas WHERE ruta_id = $1 AND pasajero_id = $2',
    [rutaId, usuario.id]
  );

  if (existe.length > 0) {
    await query(
      "UPDATE reservas SET estado = 'confirmada' WHERE id = $1",
      [existe[0].id]
    );
    await registrarBitacora(usuario.id, usuario.id, 'reserva', `Reserva reactivada en ruta ${rutaId}`);
    return c.json({ ok: true, mensaje: 'Tu reserva anterior fue reactivada.' });
  }

  await query(
    `INSERT INTO reservas (ruta_id, pasajero_id, estado, creado_en)
     VALUES ($1, $2, 'confirmada', $3)`,
    [rutaId, usuario.id, nowIso()]
  );

  await registrarBitacora(usuario.id, usuario.id, 'reserva', `Reserva del lugar en ruta ${rutaId}`);

  const fila = await query<any>(
    `SELECT r.*, u.nombre AS conductor,
            (r.lugares - COALESCE((
              SELECT COUNT(*) FROM reservas rs WHERE rs.ruta_id = r.id AND rs.estado = 'confirmada'
            ), 0)) AS lugares_libres
     FROM rutas r JOIN usuarios u ON u.id = r.conductor_id WHERE r.id = $1`,
    [rutaId]
  );

  return c.json({
    ok: true,
    mensaje: 'Lugar reservado con éxito.',
    ruta: formatRuta(fila[0]),
  });
});

// --------------------------------------------------------------------------
// Mis reservas
// --------------------------------------------------------------------------

app.get('/api/mis-reservas', async (c) => {
  const usuario = await requireAuth(c);
  if (!usuario) {
    return c.json({ ok: false, error: 'Debes iniciar sesión para usar esta función.' }, 401);
  }

  const rows = await query<any>(
    `SELECT rs.id, rs.estado, rs.creado_en, r.origen, r.punto_encuentro, r.salida,
            r.aportacion, u.nombre AS conductor
     FROM reservas rs
     JOIN rutas r ON r.id = rs.ruta_id
     JOIN usuarios u ON u.id = r.conductor_id
     WHERE rs.pasajero_id = $1
     ORDER BY rs.id DESC`,
    [usuario.id]
  );

  return c.json({
    ok: true,
    reservas: rows.map((r) => ({
      id: r.id,
      estado: r.estado,
      creado_en: r.creado_en,
      origen: r.origen,
      punto_encuentro: r.punto_encuentro,
      salida: r.salida,
      aportacion: Number(r.aportacion),
      conductor: r.conductor,
    })),
  });
});

// --------------------------------------------------------------------------
// Motor de sugerencias (IA simulada) - portado desde ia_simulada.py
// --------------------------------------------------------------------------

const COORDENADAS: Record<string, [number, number]> = {
  Cholula: [19.0641, -98.3035],
  Angelópolis: [19.0319, -98.2325],
  Amozoc: [19.1167, -98.3997],
  Centro: [19.0414, -98.2063],
  'La Margarita': [18.9580, -98.2830],
  UTP: [19.0490, -98.3420],
};

const TIEMPOS: Record<string, number> = {
  'UTP-Cholula': 10,
  'Cholula-Angelópolis': 20,
  'UTP-Angelópolis': 20,
  'UTP-La Margarita': 30,
  'UTP-Centro': 30,
  'UTP-Amozoc': 30,
  'Angelópolis-Centro': 10,
  'Centro-La Margarita': 30,
  'La Margarita-Amozoc': 45,
};

const PESO_ZONA: Record<string, number> = {
  Cholula: 0.95,
  Angelópolis: 0.80,
  UTP: 1.00,
  Centro: 0.65,
  'La Margarita': 0.45,
  Amozoc: 0.40,
};

function minutosEntre(a: string, b: string): number {
  return TIEMPOS[`${a}-${b}`] ?? TIEMPOS[`${b}-${a}`] ?? 0;
}

function distanciaKm(a: string, b: string): number | null {
  if (!(a in COORDENADAS) || !(b in COORDENADAS)) return null;
  const [lat1, lon1] = COORDENADAS[a];
  const [lat2, lon2] = COORDENADAS[b];
  const radio = 6371.0;
  const f1 = (lat1 * Math.PI) / 180;
  const f2 = (lat2 * Math.PI) / 180;
  const dlat = ((lat2 - lat1) * Math.PI) / 180;
  const dlon = ((lon2 - lon1) * Math.PI) / 180;
  const x =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(f1) * Math.cos(f2) * Math.sin(dlon / 2) ** 2;
  return Math.round(2 * radio * Math.asin(Math.sqrt(x)) * 10) / 10;
}

function rutaMasCorta(origen: string, destino: string): [number | null, string[]] {
  if (origen === destino) return [0, [origen]];
  const vecinos: Record<string, Record<string, number>> = {};
  for (const [clave, min] of Object.entries(TIEMPOS)) {
    const [x, y] = clave.split('-');
    vecinos[x] = vecinos[x] || {};
    vecinos[y] = vecinos[y] || {};
    vecinos[x][y] = min;
    vecinos[y][x] = min;
  }
  if (!(origen in vecinos) || !(destino in vecinos)) return [null, []];

  const distancias: Record<string, number> = { [origen]: 0 };
  const previo: Record<string, string> = {};
  const visitados = new Set<string>();
  const cola: [number, string][] = [[0, origen]];

  while (cola.length > 0) {
    cola.sort((a, b) => a[0] - b[0]);
    const [costo, actual] = cola.shift()!;
    if (visitados.has(actual)) continue;
    visitados.add(actual);
    if (actual === destino) break;
    for (const [vecino, peso] of Object.entries(vecinos[actual] || {})) {
      const nuevo = costo + peso;
      if (nuevo < (distancias[vecino] ?? Infinity)) {
        distancias[vecino] = nuevo;
        previo[vecino] = actual;
        cola.push([nuevo, vecino]);
      }
    }
  }

  if (!(destino in distancias)) return [null, []];

  const trayecto: string[] = [destino];
  let nodo = destino;
  while (nodo in previo) {
    nodo = previo[nodo];
    trayecto.push(nodo);
  }
  trayecto.reverse();
  return [distancias[destino], trayecto];
}

function turnoDe(hora: string): 'Matutino' | 'Vespertino' {
  const h = Number(hora.split(':')[0]) || 0;
  return h < 12 ? 'Matutino' : 'Vespertino';
}

function normalizarTurno(valor: string | null | undefined): 'Matutino' | 'Vespertino' | null {
  if (!valor) return null;
  const v = valor.trim().toLowerCase();
  if (v === 'morning' || v === 'matutino') return 'Matutino';
  if (v === 'afternoon' || v === 'vespertino') return 'Vespertino';
  return null;
}

function puntuar(
  origenPasajero: string,
  ruta: any,
  turnoObjetivo: string | null
): any | null {
  const zonaConductor = ruta.origen;
  const [minutos, trayecto] = rutaMasCorta(origenPasajero, zonaConductor);
  if (minutos === null) return null;

  const cercania = Math.max(0, (60 - minutos) / 60 * 40);

  const salida = ruta.salida;
  const turnoRuta = turnoDe(salida);
  let horario: number;
  if (!turnoObjetivo) {
    const penalidad = Math.abs(Number(salida.split(':')[0]) * 60 + Number(salida.split(':')[1]) - 7 * 60) / 60;
    horario = Math.max(0, 16 - penalidad * 1.6);
  } else if (turnoRuta === turnoObjetivo) {
    horario = 20;
  } else {
    horario = 8;
  }

  const reputacion = (Number(ruta.calificacion) / 5) * 20;
  const libres = Number(ruta.lugares_libres);
  const disponibilidad = libres > 0 ? Math.min(10, (libres / 4) * 10) : 0;
  const pesoZona = (PESO_ZONA[zonaConductor] ?? 0.5) * 10;

  const total = cercania + horario + reputacion + disponibilidad + pesoZona;

  const razones: string[] = [];
  if (minutos === 0) {
    razones.push(`El conductor sale de tu misma zona (${zonaConductor}), sin traslados previos.`);
  } else if (minutos <= 15) {
    razones.push(`Zona cercana: ${minutos} min de ${origenPasajero} a ${zonaConductor}.`);
  } else {
    razones.push(`Recorrido de ${minutos} min desde ${origenPasajero}; el trayecto pasa por ${trayecto.join(' → ')}.`);
  }

  if (turnoObjetivo && turnoRuta === turnoObjetivo) {
    razones.push(`Su salida ${salida} (${turnoRuta}) coincide con el turno que buscas.`);
  } else {
    razones.push(`Sale a las ${salida} (${turnoRuta}).`);
  }

  const cal = Number(ruta.calificacion);
  if (cal >= 4.8) razones.push(`Reputación alta: ${cal.toFixed(1)}/5 entre la comunidad.`);
  else if (cal >= 4.5) razones.push(`Reputación sólida: ${cal.toFixed(1)}/5.`);

  if (libres === 1) razones.push('Solo queda 1 lugar: reserva pronto.');
  else if (libres > 1) razones.push(`${libres} lugares disponibles ahora mismo.`);

  const aport = Number(ruta.aportacion);
  if (aport <= 25) razones.push(`Aportación baja para el trayecto: $${aport} MXN.`);
  else if (aport >= 40) razones.push(`Aportación de $${aport} MXN, la más alta del grupo similar.`);

  if (ruta.conductor_verificado) razones.push('Perfil verificado por la universidad.');

  return {
    ruta_id: ruta.id,
    conductor: ruta.conductor,
    origen: zonaConductor,
    punto_encuentro: ruta.punto_encuentro,
    salida: ruta.salida,
    llegada: ruta.llegada,
    turno: turnoRuta,
    lugares_libres: libres,
    aportacion: Number(ruta.aportacion),
    calificacion: Number(ruta.calificacion),
    verificado: Boolean(ruta.conductor_verificado),
    minutos_estimados: minutos,
    trayecto,
    hora_llegada_estimada: '',
    puntaje: Math.round(total * 10) / 10,
    confianza: Math.max(12, Math.min(98, Math.round(total))),
    componentes: {
      cercania: Math.round(cercania * 10) / 10,
      horario: Math.round(horario * 10) / 10,
      reputacion: Math.round(reputacion * 10) / 10,
      disponibilidad: Math.round(disponibilidad * 10) / 10,
      zona: Math.round(pesoZona * 10) / 10,
    },
    razones,
  };
}

async function sugerir(origen: string | null | undefined, turno: string | null | undefined, limite: number): Promise<any[]> {
  const turnoObjetivo = normalizarTurno(turno);
  const origenValido = origen && origen in COORDENADAS ? origen : null;

  // Obtener todas las rutas activas con lugares libres
  const filas = await query<any>(
    `SELECT r.*, u.nombre AS conductor, u.verificado AS conductor_verificado,
            (r.lugares - COALESCE((
              SELECT COUNT(*) FROM reservas rs WHERE rs.ruta_id = r.id AND rs.estado = 'confirmada'
            ), 0)) AS lugares_libres
     FROM rutas r
     JOIN usuarios u ON u.id = r.conductor_id
     WHERE r.activa = TRUE AND u.activo = TRUE`
  );

  const sugerencias: any[] = [];
  for (const ruta of filas) {
    if (Number(ruta.lugares_libres) <= 0) continue;
    const base = origenValido ?? 'UTP';
    const resultado = puntuar(base, ruta, turnoObjetivo);
    if (!resultado) continue;
    if (!origenValido) {
      resultado.puntaje = Math.round(resultado.puntaje * 0.6 * 10) / 10;
      resultado.confianza = Math.max(10, resultado.confianza - 25);
      resultado.razones.unshift('Sin zona definida: se asume salida desde la UTP.');
    }
    sugerencias.push(resultado);
  }

  sugerencias.sort((a, b) => b.puntaje - a.puntaje || a.salida.localeCompare(b.salida));
  return sugerencias.slice(0, limite);
}

app.get('/api/ia/sugerir', async (c) => {
  const usuario = await requireAuth(c);
  if (!usuario) {
    return c.json({ ok: false, error: 'Debes iniciar sesión para usar esta función.' }, 401);
  }

  const zona = c.req.query('zona');
  const turno = c.req.query('turno');
  const limite = Math.max(1, Math.min(10, Number(c.req.query('limite') || 5)));

  const sugerencias = await sugerir(zona, turno, limite);

  return c.json({
    ok: true,
    simulado: true,
    aviso: 'Motor de sugerencias SIMULADO. No utiliza ninguna API de IA externa.',
    zona_consultada: zona ?? null,
    turno_consultado: turno ?? null,
    sugerencias,
  });
});

app.get('/api/ia/mapa', async (c) => {
  const usuario = await requireAuth(c);
  if (!usuario) {
    return c.json({ ok: false, error: 'Debes iniciar sesión para usar esta función.' }, 401);
  }

  const zona = c.req.query('zona');
  const turno = c.req.query('turno');

  const filas = await query<any>(
    'SELECT id, nombre, lat, lng, mapa_x, mapa_y FROM zonas WHERE activa = TRUE ORDER BY id'
  );

  const zonas = await Promise.all(filas.map(async (f) => {
    const sugeridas = await sugerir(f.nombre, turno, 1);
    return {
      nombre: f.nombre,
      lat: f.lat,
      lng: f.lng,
      mapa_x: f.mapa_x,
      mapa_y: f.mapa_y,
      destacado: f.nombre === zona,
      mejores: sugeridas.slice(0, 1),
    };
  }));

  const conexiones = Object.entries(TIEMPOS).map(([clave, minutos]) => {
    const [a, b] = clave.split('-');
    return { de: a, a: b, minutos, km: distanciaKm(a, b) };
  });

  const sugerencias = await sugerir(zona ?? 'UTP', turno, 5);

  return c.json({
    ok: true,
    simulado: true,
    origen: zona ?? null,
    turno: turno ?? null,
    zonas,
    conexiones,
    sugerencias,
  });
});

// --------------------------------------------------------------------------
// Panel de administrador
// --------------------------------------------------------------------------

app.get('/api/admin/usuarios', async (c) => {
  const admin = await requireAdmin(c);
  if (!admin) {
    return c.json({ ok: false, error: 'Acceso restringido a administradores.' }, 403);
  }

  const filas = await query<any>(
    `SELECT id, nombre, correo, rol, zona, matricula, verificado, activo, creado_en
     FROM usuarios ORDER BY id`
  );

  const total = filas.length;
  const administradores = filas.filter((f) => f.rol === 'admin').length;
  const estudiantes = filas.filter((f) => f.rol === 'estudiante').length;
  const conductores = filas.filter((f) => f.rol === 'conductor').length;
  const activos = filas.filter((f) => f.activo).length;

  return c.json({
    ok: true,
    resumen: { total, administradores, estudiantes, conductores, activos },
    usuarios: filas.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      correo: f.correo,
      rol: f.rol,
      zona: f.zona,
      matricula: f.matricula,
      verificado: Boolean(f.verificado),
      activo: Boolean(f.activo),
      creado_en: f.creado_en,
    })),
    usuario_actual: admin.id,
  });
});

app.delete('/api/admin/usuarios', async (c) => {
  const admin = await requireAdmin(c);
  if (!admin) {
    return c.json({ ok: false, error: 'Acceso restringido a administradores.' }, 403);
  }

  const idObjetivo = c.req.query('id');
  if (!idObjetivo) {
    return c.json({ ok: false, error: 'Falta el parámetro id.' }, 400);
  }

  const confirmar = c.req.query('confirmar');
  const force = c.req.query('force');

  if (confirmar === '1' && force !== '1') {
    // Vista previa de confirmación
    const objetivo = await query<any>(
      'SELECT id, nombre, correo, rol FROM usuarios WHERE id = $1',
      [idObjetivo]
    );
    if (objetivo.length === 0) {
      return c.json({ ok: false, error: 'Usuario no encontrado.' }, 404);
    }
    return c.json({
      ok: true,
      requiere_confirmacion: true,
      usuario: { id: objetivo[0].id, nombre: objetivo[0].nombre, correo: objetivo[0].correo, rol: objetivo[0].rol },
      mensaje: `Se eliminará a ${objetivo[0].nombre} y sus rutas.`,
    });
  }

  const objetivoId = Number(idObjetivo);
  if (objetivoId === admin.id) {
    return c.json({ ok: false, error: 'No puedes eliminar tu propia cuenta desde el panel.' }, 400);
  }

  const objetivo = await query<any>('SELECT * FROM usuarios WHERE id = $1', [objetivoId]);
  if (objetivo.length === 0) {
    return c.json({ ok: false, error: 'Usuario no encontrado.' }, 404);
  }

  await query('DELETE FROM usuarios WHERE id = $1', [objetivoId]);

  await registrarBitacora(
    null,
    admin.id,
    'eliminacion',
    `${admin.nombre} eliminó a ${objetivo[0].nombre} (${objetivo[0].correo})`
  );

  return c.json({
    ok: true,
    mensaje: `Usuario ${objetivo[0].nombre} eliminado.`,
    id: objetivoId,
  });
});

app.get('/api/admin/bitacora', async (c) => {
  const admin = await requireAdmin(c);
  if (!admin) {
    return c.json({ ok: false, error: 'Acceso restringido a administradores.' }, 403);
  }

  const limite = Math.max(1, Math.min(200, Number(c.req.query('limite') || 40)));

  const filas = await query<any>(
    `SELECT b.accion, b.detalle, b.creado_en, u.nombre AS actor
     FROM bitacora b
     LEFT JOIN usuarios u ON u.id = b.actor_id
     ORDER BY b.id DESC
     LIMIT $1`,
    [limite]
  );

  return c.json({ ok: true, bitacora: filas });
});

app.get('/api/admin/cache', async (c) => {
  const admin = await requireAdmin(c);
  if (!admin) {
    return c.json({ ok: false, error: 'Acceso restringido a administradores.' }, 403);
  }

  const limpiar = c.req.query('limpiar');

  if (limpiar === '1') {
    return c.json({
      ok: true,
      mensaje: 'Caché vaciada.',
      estadisticas: { entradas: 0, aciertos: 0, fallos: 0, tasa_aciertos: 0, invalicaciones: 0 },
    });
  }

  return c.json({
    ok: true,
    nota: 'La caché del backend Neon Functions se gestiona por instancia. Usa ?limpiar=1 para reiniciar.',
    estadisticas: { entradas: 0, aciertos: 0, fallos: 0, tasa_aciertos: 0, invalicaciones: 0 },
    endpoints_cacheables: ['/api/rutas', '/api/zonas', '/api/ruta', '/api/ia/sugerir', '/api/ia/mapa'],
  });
});

app.post('/api/admin/reset', async (c) => {
  const admin = await requireAdmin(c);
  if (!admin) {
    return c.json({ ok: false, error: 'Acceso restringido a administradores.' }, 403);
  }

  const confirmar = c.req.query('confirmar');
  if (confirmar !== '1') {
    return c.json({ ok: false, error: 'Debes confirmar con ?confirmar=1.' }, 400);
  }

  // Cerrar sesiones del administrador
  const token = getCookieToken(c);
  if (token) {
    await query('DELETE FROM sesiones WHERE token = $1', [token]);
  }

  await query('DELETE FROM sesiones');
  await query('DELETE FROM reservas');
  await query('DELETE FROM rutas');
  await query('DELETE FROM usuarios WHERE rol != $1', [admin.id]);

  await registrarBitacora(null, admin.id, 'reset', 'Base de datos reiniciada (usuarios de prueba eliminados, admin conservado)');

  clearSessionCookie(c);

  return c.json({
    ok: true,
    mensaje: 'Base de datos reiniciada.',
    mensaje_sesion: 'Vuelve a iniciar sesión.',
  });
});

// --------------------------------------------------------------------------
// Ruta 404 para API
// --------------------------------------------------------------------------

app.all('/api/*', (c) => {
  return c.json({ ok: false, error: 'Endpoint no encontrado.' }, 404);
});

// --------------------------------------------------------------------------
// Manejo de errores
// --------------------------------------------------------------------------

app.onError((err, c) => {
  console.error('Error no controlado:', err);
  return c.json(
    { ok: false, error: 'Error interno del servidor.' },
    500
  );
});

// --------------------------------------------------------------------------
// Export para Neon Functions
// --------------------------------------------------------------------------

export default app;

export { pool, closePool };
