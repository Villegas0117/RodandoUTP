"""
Rodando UTP - Capa de datos (SQLite)
=====================================
Usa únicamente la biblioteca estandar de Python 3 (sqlite3), por lo que
no requiere instalar nada: `python3 server.py` es suficiente.

Contiene el esquema de la base de datos, la apertura de conexiones y los
datos iniciales de demostracion (usuarios, zonas, rutas y reservas).
"""

import hashlib
import os
import secrets
import sqlite3
import threading
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'data', 'rodando.db')

# Coste de iteraciones de PBKDF2. Suficiente para una demostracion academica
# sin volver el arranque lento.
PBKDF2_ITERATIONS = 120_000

_local = threading.local()
_write_lock = threading.RLock()


# --------------------------------------------------------------------------
# Esquema
# --------------------------------------------------------------------------

SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS zonas (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre   TEXT    NOT NULL UNIQUE,
    lat      REAL    NOT NULL,
    lng      REAL    NOT NULL,
    mapa_x   REAL    NOT NULL,
    mapa_y   REAL    NOT NULL,
    activa   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS usuarios (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre        TEXT    NOT NULL,
    correo        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    salt          TEXT    NOT NULL,
    rol           TEXT    NOT NULL DEFAULT 'estudiante'
                  CHECK (rol IN ('estudiante', 'conductor', 'admin')),
    zona          TEXT,
    matricula     TEXT,
    verificado    INTEGER NOT NULL DEFAULT 0,
    activo        INTEGER NOT NULL DEFAULT 1,
    creado_en     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS rutas (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    conductor_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    origen         TEXT    NOT NULL,
    punto_encuentro TEXT   NOT NULL,
    destino        TEXT    NOT NULL DEFAULT 'UTP',
    salida         TEXT    NOT NULL,
    llegada        TEXT,
    lugares        INTEGER NOT NULL DEFAULT 1 CHECK (lugares >= 0),
    aportacion     INTEGER NOT NULL DEFAULT 0 CHECK (aportacion >= 0),
    calificacion   REAL    NOT NULL DEFAULT 5.0,
    dias           TEXT    NOT NULL DEFAULT 'Lun,Mar,Mié,Jue,Vie',
    activa         INTEGER NOT NULL DEFAULT 1,
    creado_en      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS reservas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ruta_id      INTEGER NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
    pasajero_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    estado       TEXT    NOT NULL DEFAULT 'confirmada'
                 CHECK (estado IN ('confirmada', 'cancelada')),
    creado_en    TEXT    NOT NULL,
    UNIQUE (ruta_id, pasajero_id)
);

CREATE TABLE IF NOT EXISTS sesiones (
    token       TEXT    PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creada_en   TEXT    NOT NULL,
    expira_en   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS bitacora (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    actor_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    accion      TEXT    NOT NULL,
    detalle     TEXT,
    creado_en   TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rutas_origen  ON rutas(origen);
CREATE INDEX IF NOT EXISTS idx_reservas_usuario ON reservas(pasajero_id);
CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_bitacora_fecha ON bitacora(creado_en DESC);
"""


# --------------------------------------------------------------------------
# Conexion
# --------------------------------------------------------------------------

def get_connection():
    """Devuelve una conexion por hilo, reutilizada entre peticiones."""
    conn = getattr(_local, 'conn', None)
    if conn is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys = ON')
        conn.execute('PRAGMA journal_mode = WAL')
        _local.conn = conn
    return conn


def init_db():
    """Crea las tablas si no existen. Es idempotente."""
    with _write_lock:
        get_connection().executescript(SCHEMA)
        get_connection().commit()


# --------------------------------------------------------------------------
# Utilidades de fecha y contrasena
# --------------------------------------------------------------------------

def ahora():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def ahora_mas(minutos):
    return (datetime.now(timezone.utc)
            + __import__('datetime').timedelta(minutes=minutos)
            ).isoformat(timespec='seconds')


def hash_password(password, salt=None):
    """PBKDF2-HMAC-SHA256. Devuelve (hash_hex, salt_hex)."""
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        'sha256', password.encode('utf-8'), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return digest.hex(), salt


def verificar_password(password, hash_hex, salt_hex):
    calculado, _ = hash_password(password, salt_hex)
    return secrets.compare_digest(calculado, hash_hex)


# --------------------------------------------------------------------------
# Semilla de datos de demostracion
# --------------------------------------------------------------------------

# id, nombre, latitud, longitud, coordenada X del mapa, coordenada Y del mapa
ZONAS_SEMILLA = [
    (1, 'Cholula',      19.2210, -98.3060, 430, 118),
    (2, 'Angelópolis',  19.0150, -98.2780, 572, 430),
    (3, 'Amozoc',       19.1180, -98.4000, 238, 512),
    (4, 'Centro',       18.9700, -98.2500, 742, 322),
    (5, 'La Margarita', 18.9400, -98.3200, 512, 604),
    (6, 'UTP',          19.0500, -98.3400, 408, 300),
]

# nombre, correo, contrasena, rol, zona, matricula, verificado
USUARIOS_SEMILLA = [
    ('Eber Omar Villegas', 'admin@rodandoutp.mx', 'admin123', 'admin', 'Cholula', 'VIFE0109012G4', 1),
    ('Mariana Ghosh',      'mariana@rodandoutp.mx', 'utp12345', 'conductor', 'Cholula', 'VIFE0203114A2', 1),
    ('Diego Ramirez',      'diego@rodandoutp.mx', 'utp12345', 'conductor', 'Angelópolis', 'VIFE0211883C7', 1),
    ('Sofía Turnbull',     'sofia@rodandoutp.mx', 'utp12345', 'conductor', 'Amozoc', 'VIFE0209455B1', 1),
    ('Carlos Valencia',    'carlos@rodandoutp.mx', 'utp12345', 'conductor', 'Centro', 'VIFE0210772D9', 1),
    ('Valeria Paredes',    'valeria@rodandoutp.mx', 'utp12345', 'conductor', 'La Margarita', 'VIFE0206619F4', 1),
    ('Héctor Navarro',     'hector@rodandoutp.mx', 'utp12345', 'conductor', 'Cholula', 'VIFE0212330E8', 1),
    ('Ana Karen Bautista', 'ana@rodandoutp.mx', 'utp12345', 'estudiante', 'Cholula', 'VIFE0213991K6', 0),
    ('Luis Fernando Gómez', 'luis@rodandoutp.mx', 'utp12345', 'estudiante', 'Angelópolis', 'VIFE0209982M3', 0),
    ('Paola Mendoza',      'paola@rodandoutp.mx', 'utp12345', 'estudiante', 'Centro', 'VIFE0211507R8', 0),
    ('Jorge Iván Castro',  'jorge@rodandoutp.mx', 'utp12345', 'estudiante', 'Amozoc', 'VIFE0208874T5', 0),
    ('Renata Alcántara',    'renata@rodandoutp.mx', 'utp12345', 'estudiante', 'La Margarita', 'VIFE0212339L2', 0),
    ('Brandon Sánchez',    'brandon@rodandoutp.mx', 'utp12345', 'estudiante', 'Cholula', 'VIFE0207510Q9', 0),
    ('Daniela Ortiz',      'daniela@rodandoutp.mx', 'utp12345', 'estudiante', 'Angelópolis', 'VIFE0210663W1', 0),
]

# correo_conductor, origen, punto, salida, llegada, lugares, aportacion, calificacion, dias
# Solo se referencian usuarios con rol 'conductor'; el id se resuelve por correo.
RUTAS_SEMILLA = [
    ('mariana@rodandoutp.mx', 'Cholula',      'Plaza San Diego',    '06:55', '07:45', 3, 35, 4.9, 'Lun,Mar,Mié,Jue,Vie'),
    ('mariana@rodandoutp.mx', 'Cholula',      'Camino a la UTP',     '12:45', '13:30', 2, 30, 4.8, 'Mar,Jue'),
    ('diego@rodandoutp.mx',   'Angelópolis',  'Parque del Arte',     '07:20', '08:05', 2, 30, 4.8, 'Lun,Mié,Vie'),
    ('diego@rodandoutp.mx',   'Angelópolis',  'Plaza Sofía',         '06:40', '07:25', 2, 28, 4.7, 'Lun,Mar,Mié,Vie'),
    ('sofia@rodandoutp.mx',   'Amozoc',       'Zócalo de Amozoc',   '12:35', '13:05', 3, 22, 5.0, 'Mar,Jue'),
    ('sofia@rodandoutp.mx',   'Amozoc',       'Entrada a Amozoc',    '06:30', '07:35', 2, 38, 4.4, 'Lun,Vie'),
    ('carlos@rodandoutp.mx',  'Centro',       'Parque de Analco',    '13:10', '13:45', 1, 20, 4.7, 'Lun,Mar,Mié,Jue'),
    ('carlos@rodandoutp.mx',  'Centro',       'Parque 5 de Mayo',    '07:00', '07:50', 3, 26, 4.5, 'Mar,Jue,Vie'),
    ('valeria@rodandoutp.mx', 'La Margarita', 'Plaza Dorada',        '06:45', '07:25', 2, 24, 4.9, 'Lun,Mar,Mié,Vie'),
    ('valeria@rodandoutp.mx', 'La Margarita', 'Colonia 15 de Mayo',  '12:50', '13:30', 3, 21, 4.8, 'Lun,Mié'),
    ('hector@rodandoutp.mx',  'Cholula',      'Recta a Cholula',     '13:00', '13:55', 4, 32, 4.6, 'Lun,Mié,Jue'),
]


def sembrar():
    """Inserta datos iniciales. Solo funciona si la base esta vacia."""
    init_db()
    conn = get_connection()
    with _write_lock:
        existe = conn.execute('SELECT COUNT(*) AS n FROM usuarios').fetchone()['n']
        if existe:
            return False

        cur = conn.cursor()
        marca = ahora()

        for _id, nombre, lat, lng, mapa_x, mapa_y in ZONAS_SEMILLA:
            cur.execute(
                'INSERT INTO zonas (nombre, lat, lng, mapa_x, mapa_y) VALUES (?,?,?,?,?)',
                (nombre, lat, lng, mapa_x, mapa_y),
            )

        for nombre, correo, clave, rol, zona, matricula, verif in USUARIOS_SEMILLA:
            digest, salt = hash_password(clave)
            cur.execute(
                'INSERT INTO usuarios (nombre, correo, password_hash, salt, rol, zona,'
                ' matricula, verificado, creado_en) VALUES (?,?,?,?,?,?,?,?,?)',
                (nombre, correo, digest, salt, rol, zona, matricula, verif, marca),
            )

        # Se resuelven los ids por correo para no depender del orden de AUTOINCREMENT.
        ids_por_correo = {
            f['correo']: f['id'] for f in
            conn.execute('SELECT id, correo FROM usuarios').fetchall()
        }

        for correo, origen, punto, salida, llegada, lugares, aport, calif, dias in RUTAS_SEMILLA:
            uid = ids_por_correo.get(correo)
            if uid is None:
                raise RuntimeError(
                    f'No se encontro el conductor {correo} en la semilla de usuarios.'
                )
            cur.execute(
                'INSERT INTO rutas (conductor_id, origen, punto_encuentro, destino, salida,'
                ' llegada, lugares, aportacion, calificacion, dias, creado_en)'
                ' VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                (uid, origen, punto, 'UTP', salida, llegada, lugares, aport, calif, dias, marca),
            )

        admin_id = ids_por_correo.get('admin@rodandoutp.mx')
        cur.execute(
            'INSERT INTO bitacora (usuario_id, actor_id, accion, detalle, creado_en)'
            ' VALUES (?, ?, ?, ?, ?)',
            (admin_id, admin_id, 'sistema',
             'Base de datos inicializada con datos de demostracion', marca),
        )
        conn.commit()
    return True


def reiniciar():
    """Borra el archivo de la base de datos (util para volver a sembrar)."""
    import datetime as _dt
    with _write_lock:
        conn = getattr(_local, 'conn', None)
        if conn is not None:
            conn.close()
            _local.conn = None
    for sufijo in ('', '-wal', '-shm'):
        ruta = DB_PATH + sufijo
        if os.path.exists(ruta):
            os.remove(ruta)
    init_db()
    return sembrar()


# --------------------------------------------------------------------------
# Consultas usadas por el servidor
# --------------------------------------------------------------------------

def usuario_por_correo(correo):
    return get_connection().execute(
        'SELECT * FROM usuarios WHERE correo = ? AND activo = 1', (correo,)
    ).fetchone()


def usuario_por_id(uid):
    return get_connection().execute(
        'SELECT * FROM usuarios WHERE id = ? AND activo = 1', (uid,)
    ).fetchone()


def usuarios_publicos():
    return get_connection().execute(
        'SELECT id, nombre, correo, rol, zona, matricula, verificado, activo, creado_en'
        ' FROM usuarios ORDER BY id'
    ).fetchall()


def zonas():
    return get_connection().execute(
        'SELECT id, nombre, lat, lng, mapa_x, mapa_y FROM zonas WHERE activa = 1 ORDER BY id'
    ).fetchall()


def crear_usuario(nombre, correo, contrasena, rol='estudiante', zona=None, matricula=None):
    digest, salt = hash_password(contrasena)
    with _write_lock:
        cur = get_connection().execute(
            'INSERT INTO usuarios (nombre, correo, password_hash, salt, rol, zona,'
            ' matricula, creado_en) VALUES (?,?,?,?,?,?,?,?)',
            (nombre, correo, digest, salt, rol, zona, matricula, ahora()),
        )
        get_connection().commit()
    return cur.lastrowid


def eliminar_usuario(uid):
    """Borra un usuario. Sus rutas y reservas caen en cascada."""
    with _write_lock:
        cur = get_connection().execute('DELETE FROM usuarios WHERE id = ?', (uid,))
        get_connection().execute('DELETE FROM sesiones WHERE usuario_id = ?', (uid,))
        get_connection().commit()
    return cur.rowcount > 0


def registrar_bitacora(usuario_id, actor_id, accion, detalle=None):
    with _write_lock:
        get_connection().execute(
            'INSERT INTO bitacora (usuario_id, actor_id, accion, detalle, creado_en)'
            ' VALUES (?,?,?,?,?)',
            (usuario_id, actor_id, accion, detalle, ahora()),
        )
        get_connection().commit()


def ultimas_acciones(limite=25):
    return get_connection().execute(
        'SELECT b.accion, b.detalle, b.creado_en, u.nombre AS actor'
        ' FROM bitacora b LEFT JOIN usuarios u ON u.id = b.actor_id'
        ' ORDER BY b.id DESC LIMIT ?', (limite,)
    ).fetchall()


def crear_sesion(uid):
    token = secrets.token_urlsafe(32)
    with _write_lock:
        get_connection().execute(
            'INSERT INTO sesiones (token, usuario_id, creada_en, expira_en) VALUES (?,?,?,?)',
            (token, uid, ahora(), ahora_mas(60 * 8)),
        )
        get_connection().commit()
    return token


def borrar_sesion(token):
    if not token:
        return
    with _write_lock:
        get_connection().execute('DELETE FROM sesiones WHERE token = ?', (token,))
        get_connection().commit()


def usuario_de_sesion(token):
    if not token:
        return None
    return get_connection().execute(
        'SELECT u.* FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id'
        ' WHERE s.token = ? AND s.expira_en > ? AND u.activo = 1',
        (token, ahora()),
    ).fetchone()


def rutas_disponibles(filtros=None):
    """Devuelve las rutas activas con el nombre del conductor y lugares libres."""
    filtros = filtros or {}
    sql = ['SELECT r.*, u.nombre AS conductor, u.zona AS zona_conductor,'
           ' u.verificado AS conductor_verificado,',
           ' (r.lugares - (SELECT COUNT(*) FROM reservas rs WHERE rs.ruta_id = r.id AND rs.estado = \'confirmada\')) AS lugares_libres',
           ' FROM rutas r JOIN usuarios u ON u.id = r.conductor_id',
           ' WHERE r.activa = 1 AND u.activo = 1']
    params = []
    if filtros.get('origen'):
        sql.append(' AND r.origen = ?')
        params.append(filtros['origen'])
    if filtros.get('turno'):
        sql.append(" AND CAST(substr(r.salida,1,2) AS INTEGER) < 12 = ?")
        params.append(1 if filtros['turno'] == 'morning' else 0)
    if filtros.get('lugares'):
        sql.append(" AND (r.lugares - (SELECT COUNT(*) FROM reservas rs WHERE rs.ruta_id = r.id AND rs.estado = 'confirmada')) >= ?")
        params.append(int(filtros['lugares']))
    sql.append(' ORDER BY r.salida')
    return get_connection().execute(' '.join(sql), params).fetchall()


def ruta_por_id(rid):
    return get_connection().execute(
        'SELECT r.*, u.nombre AS conductor, u.zona AS zona_conductor,'
        ' u.verificado AS conductor_verificado, u.matricula AS matricula_conductor,'
        ' (r.lugares - (SELECT COUNT(*) FROM reservas rs'
        '   WHERE rs.ruta_id = r.id AND rs.estado = \'confirmada\')) AS lugares_libres'
        ' FROM rutas r JOIN usuarios u ON u.id = r.conductor_id WHERE r.id = ?', (rid,)
    ).fetchone()


def reservar(ruta_id, pasajero_id):
    """Reserva un lugar. Devuelve (ok, mensaje)."""
    with _write_lock:
        conn = get_connection()
        ruta = conn.execute('SELECT * FROM rutas WHERE id = ?', (ruta_id,)).fetchone()
        if ruta is None:
            return False, 'La ruta ya no existe.'
        if ruta['conductor_id'] == pasajero_id:
            return False, 'No puedes reservar un lugar en tu propia ruta.'
        ocupadas = conn.execute(
            "SELECT COUNT(*) AS n FROM reservas WHERE ruta_id = ? AND estado = 'confirmada'",
            (ruta_id,),
        ).fetchone()['n']
        if ocupadas >= ruta['lugares']:
            return False, 'Esta ruta ya no tiene lugares disponibles.'
        existe = conn.execute(
            'SELECT id FROM reservas WHERE ruta_id = ? AND pasajero_id = ?', (ruta_id, pasajero_id)
        ).fetchone()
        if existe:
            conn.execute("UPDATE reservas SET estado = 'confirmada' WHERE id = ?", (existe['id'],))
            mensaje = 'Tu reserva anterior fue reactivada.'
        else:
            conn.execute(
                "INSERT INTO reservas (ruta_id, pasajero_id, estado, creado_en)"
                " VALUES (?,?, 'confirmada', ?)", (ruta_id, pasajero_id, ahora()),
            )
            mensaje = 'Lugar reservado con exito.'
        conn.commit()
    return True, mensaje


def reservas_de(uid):
    return get_connection().execute(
        'SELECT rs.id, rs.estado, rs.creado_en, r.origen, r.punto_encuentro, r.salida,'
        ' r.aportacion, u.nombre AS conductor'
        ' FROM reservas rs JOIN rutas r ON r.id = rs.ruta_id'
        ' JOIN usuarios u ON u.id = r.conductor_id'
        ' WHERE rs.pasajero_id = ? ORDER BY rs.id DESC', (uid,)
    ).fetchall()
