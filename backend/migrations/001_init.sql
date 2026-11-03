-- Migración 001: Esquema inicial de Rodando UTP
-- Reutiliza el modelo del backend original (SQLite) adaptado a PostgreSQL.

PRAGMA foreign_keys = ON;  -- solo SQLite, se ignora en PostgreSQL

CREATE TABLE IF NOT EXISTS zonas (
    id       SERIAL PRIMARY KEY,
    nombre   VARCHAR(100) NOT NULL UNIQUE,
    lat      REAL NOT NULL,
    lng      REAL NOT NULL,
    mapa_x   REAL NOT NULL DEFAULT 0,
    mapa_y   REAL NOT NULL DEFAULT 0,
    activa   BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS usuarios (
    id            SERIAL PRIMARY KEY,
    nombre        VARCHAR(200) NOT NULL,
    correo        VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    salt          VARCHAR(255) NOT NULL,
    rol           VARCHAR(20) NOT NULL DEFAULT 'estudiante'
                  CHECK (rol IN ('estudiante', 'conductor', 'admin')),
    zona          VARCHAR(100),
    matricula     VARCHAR(50),
    verificado    BOOLEAN NOT NULL DEFAULT FALSE,
    activo        BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rutas (
    id             SERIAL PRIMARY KEY,
    conductor_id   INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    origen         VARCHAR(100) NOT NULL,
    punto_encuentro VARCHAR(200) NOT NULL,
    destino        VARCHAR(100) NOT NULL DEFAULT 'UTP',
    salida         TIME NOT NULL,
    llegada        TIME,
    lugares        INTEGER NOT NULL DEFAULT 1 CHECK (lugares >= 0),
    aportacion     INTEGER NOT NULL DEFAULT 0 CHECK (aportacion >= 0),
    calificacion   REAL NOT NULL DEFAULT 5.0,
    dias           TEXT NOT NULL DEFAULT 'Lun,Mar,Mié,Jue,Vie',
    activa         BOOLEAN NOT NULL DEFAULT TRUE,
    creado_en      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservas (
    id           SERIAL PRIMARY KEY,
    ruta_id      INTEGER NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
    pasajero_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    estado       VARCHAR(20) NOT NULL DEFAULT 'confirmada'
                 CHECK (estado IN ('confirmada', 'cancelada')),
    creado_en    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ruta_id, pasajero_id)
);

CREATE TABLE IF NOT EXISTS sesiones (
    token       VARCHAR(255) PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creada_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expira_en   TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS bitacora (
    id          SERIAL PRIMARY KEY,
    usuario_id  INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    actor_id    INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
    accion      VARCHAR(100) NOT NULL,
    detalle     TEXT,
    creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rutas_origen ON rutas(origen);
CREATE INDEX IF NOT EXISTS idx_rutas_activa ON rutas(activa);
CREATE INDEX IF NOT EXISTS idx_reservas_usuario ON reservas(pasajero_id);
CREATE INDEX IF NOT EXISTS idx_reservas_ruta ON reservas(ruta_id);
CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id);
CREATE INDEX IF NOT EXISTS idx_sesiones_expira ON sesiones(expira_en);
CREATE INDEX IF NOT EXISTS idx_usuarios_correo ON usuarios(correo);
CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios(rol);
CREATE INDEX IF NOT EXISTS idx_bitacora_fecha ON bitacora(creado_en DESC);
