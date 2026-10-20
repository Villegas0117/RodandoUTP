#!/usr/bin/env python3
"""
Rodando UTP - Servidor de la PWA
=================================
Servidor HTTP minimo construido SOLO con la biblioteca estandar de Python 3.
No requiere `pip install` ni `npm install`: basta con `python3 server.py`.

Responsabilidades:
  * Servir los archivos estaticos del proyecto (index.html, css/, js/, img/).
  * Exponer una API JSON sobre /api/* con usuarios, sesiones, rutas y el
    motor de sugerencias simuladas.
  * Proteger con cookie de sesion las areas privadas (panel de administrador).

Uso:
    python3 server.py            # http://localhost:5500
    python3 server.py --puerto 8000
    python3 server.py --reset    # borra y vuelve a sembrar la base de datos
"""

import argparse
import json
import mimetypes
import os
import posixpath
import secrets
import sys
import traceback
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import database
import cache
import ia_simulada

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
COOKIE_SESION = 'rodando_sesion'
LIMITE_CUERPO = 64 * 1024  # 64 KB

RUTAS_PROTEGIDAS = ('/admin',)

# ------------------------------------------------------------------
# Configuración de la caché de la API
# ------------------------------------------------------------------

# Tiempo de vida de las respuestas cacheadas, en segundos.
CACHE_TTL = int(os.environ.get('RODANDO_CACHE_TTL', '30'))
CACHE_MAX_ENTRADAS = 500

CACHE = cache.CacheAPI(ttl=CACHE_TTL, max_entradas=CACHE_MAX_ENTRADAS)

# Nivel de acceso de cada endpoint. Se comprueba ANTES de consultar la caché,
# para que un usuario sin sesión nunca reciba una respuesta cacheada.
NIVEL_ACCESO = {
    '/api/salud': 'libre',
    '/api/registro': 'libre',
    '/api/login': 'libre',
    '/api/logout': 'libre',
    '/api/sesion': 'libre',
    '/api/zonas': 'libre',
    '/api/rutas': 'libre',
    '/api/ruta': 'libre',
    '/api/mis-reservas': 'sesion',
    '/api/ia/sugerir': 'sesion',
    '/api/ia/mapa': 'sesion',
    '/api/admin/usuarios': 'admin',
    '/api/admin/bitacora': 'admin',
    '/api/admin/cache': 'admin',
}

# Endpoints de lectura que se pueden cachear.
# Los que dependen del usuario NO se incluyen: /api/sesion y /api/mis-reservas
# nunca se cachean, se responden siempre con 'no-store'.
CACHE_PERMITIDOS = {
    '/api/salud',
    '/api/zonas',
    '/api/rutas',
    '/api/ruta',
    '/api/ia/sugerir',
    '/api/ia/mapa',
    '/api/admin/usuarios',
    '/api/admin/bitacora',
}

# Endpoints cuya respuesta incluye datos del usuario que la pide.
# Para estos, la clave de caché incluye su id: de lo contrario un
# administrador vería el 'usuario_actual' de otro.
CACHE_POR_USUARIO = {'/api/admin/usuarios'}

# A qué grupo de invalidación pertenece cada endpoint cacheable.
GRUPO_DE_CACHE = {
    '/api/salud': cache.GRUPO_USUARIOS,
    '/api/zonas': cache.GRUPO_RUTAS,
    '/api/rutas': cache.GRUPO_RUTAS,
    '/api/ruta': cache.GRUPO_RUTAS,
    '/api/ia/sugerir': cache.GRUPO_IA,
    '/api/ia/mapa': cache.GRUPO_IA,
    '/api/admin/usuarios': cache.GRUPO_USUARIOS,
    '/api/admin/bitacora': cache.GRUPO_USUARIOS,
}

# Extensiones y archivos que nunca deben salir por HTTP: codigo fuente del
# backend, base de datos SQLite y metadatos de Git.
EXTENSIONES_BLOQUEADAS = ('.py', '.pyc', '.db', '.db-wal', '.db-shm', '.sqlite',
                          '.sqlite3', '.env', '.pem', '.key', '.log', '.bak', '.md')
ARCHIVOS_BLOQUEADOS = ('server.py', 'database.py', 'ia_simulated.py', '.gitignore')


def esta_bloqueado(destino, limpio):
    """True si el archivo no debe servirse nunca por HTTP."""
    nombre = os.path.basename(destino)
    if any(parte.startswith('.') for parte in limpio.split('/') if parte):
        return True
    if nombre in ARCHIVOS_BLOQUEADOS:
        return True
    if any(nombre.endswith(ext) for ext in EXTENSIONES_BLOQUEADAS):
        return True
    return '__pycache__' in destino

# --------------------------------------------------------------------------


class Manejador(BaseHTTPRequestHandler):
    server_version = 'RodandoUTP/1.0'
    protocol_version = 'HTTP/1.1'

    def __init__(self, *args, **kwargs):
        # Modo captura: cuando no es None, `enviar_json` guarda la respuesta
        # en lugar de escribirla, para que el despachador pueda cachearla.
        self._captura = None
        super().__init__(*args, **kwargs)

    # ---------------------------------------------------------------- utils

    def log_message(self, formato, *args):
        # Log mas sobrio: solo errores y peticiones a /api.
        if '/api/' in self.path or args and ' 4' in (args[1] if len(args) > 1 else ''):
            sys.stderr.write(f'  {self.address_string()} {formato % args}\n')

    def _cabeceras(self, tipo, longitud, extra=None):
        self.send_header('Content-Type', tipo)
        self.send_header('Content-Length', str(longitud))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'same-origin')
        if extra:
            for clave, valor in extra.items():
                self.send_header(clave, valor)
        self.end_headers()

    def enviar_json(self, datos, estado=200, cabeceras=None):
        """
        Envía una respuesta JSON.

        Si el despachador está capturando (para meter la respuesta en la
        caché), en lugar de escribirla se guarda en `self._captura`.
        """
        cuerpo = json.dumps(datos, ensure_ascii=False).encode('utf-8')
        if self._captura is not None:
            self._captura['cuerpo'] = cuerpo
            self._captura['estado'] = estado
            return
        self._responder_json(cuerpo, estado, cabeceras=cabeceras)

    def _responder_json(self, cuerpo, estado=200, cabeceras=None, etag=None,
                        estado_cache=None):
        """
        Escribe la respuesta JSON al socket.

        - `etag` y `estado_cache` solo se usan en las respuestas cacheables.
        - Las respuestas cacheables usan 'private, no-cache': el navegador
          puede guardarlas, pero SIEMPRE debe revalidarlas contra el servidor.
          Gracias al ETag, esa revalidacion responde 304 sin cuerpo.
        - El resto sigue con 'no-store' por ser datos de sesion o mutables.
        """
        self.send_response(estado)
        cabeceras = dict(cabeceras or {})
        if etag:
            cabeceras.setdefault('Cache-Control', 'private, no-cache')
            cabeceras.setdefault('ETag', etag)
        else:
            cabeceras.setdefault('Cache-Control', 'no-store')
        cabeceras.setdefault('Vary', 'Cookie')
        if estado_cache:
            cabeceras.setdefault('X-Cache', estado_cache)
        self._cabeceras('application/json; charset=utf-8', len(cuerpo), cabeceras)
        self.wfile.write(cuerpo)

    def _responder_304(self, etag):
        """Respuesta 304 Not Modified: el cliente ya tiene el contenido."""
        self.send_response(304)
        self.send_header('ETag', etag)
        self.send_header('Cache-Control', 'private, no-cache')
        self.send_header('Vary', 'Cookie')
        self.send_header('X-Cache', 'HIT')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def enviar_error_json(self, mensaje, estado=400):
        self.enviar_json({'ok': False, 'error': mensaje}, estado)

    def leer_cuerpo(self):
        largo = int(self.headers.get('Content-Length') or 0)
        if largo <= 0:
            return {}
        if largo > LIMITE_CUERPO:
            raise ValueError('Cuerpo demasiado grande')
        crudo = self.rfile.read(largo).decode('utf-8')
        if not crudo.strip():
            return {}
        try:
            datos = json.loads(crudo)
        except json.JSONDecodeError:
            return {par.split('=', 1)[0]: unquote(par.split('=', 1)[1])
                    for par in crudo.split('&') if '=' in par}
        return datos if isinstance(datos, dict) else {}

    def token_sesion(self):
        cookie = SimpleCookie(self.headers.get('Cookie', ''))
        if COOKIE_SESION in cookie:
            return cookie[COOKIE_SESION].value
        # Permite ?token=... para pruebas con curl.
        query = parse_qs(urlparse(self.path).query)
        return query.get('token', [None])[0]

    def usuario_actual(self):
        fila = database.usuario_de_sesion(self.token_sesion())
        if fila is None:
            return None
        return {
            'id': fila['id'],
            'nombre': fila['nombre'],
            'correo': fila['correo'],
            'rol': fila['rol'],
            'zona': fila['zona'],
            'matricula': fila['matricula'],
            'verificado': bool(fila['verificado']),
            'es_admin': fila['rol'] == 'admin',
        }

    # ------------------------------------------------------------- enrutado

    def do_GET(self):
        self._despachar('GET')

    def do_POST(self):
        self._despachar('POST')

    def do_PUT(self):
        self._despachar('PUT')

    def do_DELETE(self):
        self._despachar('DELETE')

    def do_HEAD(self):
        self._despachar('GET', solo_cabeceras=True)

    def _despachar(self, metodo, solo_cabeceras=False):
        ruta = urlparse(self.path).path
        try:
            if ruta.startswith('/api/'):
                self._enrutado_api(metodo, ruta, solo_cabeceras)
            else:
                self._estatico(metodo, ruta, solo_cabeceras)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:  # pragma: no cover
            traceback.print_exc()
            if not solo_cabeceras:
                self.enviar_error_json(f'Error interno del servidor: {exc}', 500)

    # --------------------------------------------------------------- estatico

    def _estatico(self, metodo, ruta, solo_cabeceras):
        if metodo != 'GET':
            return self.enviar_error_json('Metodo no permitido', 405)

        # Las paginas privadas exigen sesion con rol de administrador.
        if any(ruta.startswith(p) for p in RUTAS_PROTEGIDAS):
            usuario = self.usuario_actual()
            if usuario is None:
                return self.enviar_error_json('Debes iniciar sesion.', 401)
            if not usuario['es_admin']:
                return self.enviar_error_json('Acceso restringido a administradores.', 403)

        if ruta in ('/', ''):
            ruta = '/index.html'

        # Normaliza y bloquea cualquier intento de salir del directorio base.
        limpio = posixpath.normpath(unquote(ruta)).lstrip('/')
        destino = os.path.normpath(os.path.join(BASE_DIR, limpio))

        # 1) Nunca se sale del directorio del proyecto.
        if os.path.commonpath([destino, BASE_DIR]) != BASE_DIR:
            return self.enviar_error_json('No encontrado', 404)

        # 2) Archivos que jamas se sirven: codigo fuente, base de datos,
        #    auxiliares de SQLite y todo lo oculto de Git.
        if esta_bloqueado(destino, limpio):
            return self.enviar_error_json('Archivo no disponible', 403)

        # 3) Carpetas y rutas inexistentes.
        if os.path.isdir(destino) or not os.path.isfile(destino):
            return self.enviar_error_json('No encontrado', 404)

        tipo, _ = mimetypes.guess_type(destino)
        if tipo is None:
            tipo = 'application/octet-stream'
        if tipo.startswith('text/') or tipo in ('application/json',
                                                 'application/javascript',
                                                 'image/svg+xml',
                                                 'application/manifest+json'):
            tipo += '; charset=utf-8'

        with open(destino, 'rb') as archivo:
            contenido = archivo.read()

        self.send_response(200)
        self._cabeceras(tipo, len(contenido), {
            'Cache-Control': 'no-cache',
            # El Service Worker necesita poder registrarse desde la raiz.
            'Service-Worker-Allowed': '/',
        })
        if solo_cabeceras:
            return
        self.wfile.write(contenido)

    # ------------------------------------------------------------------- API

    def _enrutado_api(self, metodo, ruta, solo_cabeceras):
        # Cada endpoint: (metodo, patron, manejador)
        endpoints = [
            ('GET',    '/api/salud',                self.api_salud),
            ('POST',   '/api/registro',             self.api_registro),
            ('POST',   '/api/login',                self.api_login),
            ('POST',   '/api/logout',               self.api_logout),
            ('GET',    '/api/sesion',               self.api_sesion),
            ('GET',    '/api/zonas',                self.api_zonas),
            ('GET',    '/api/rutas',                self.api_rutas),
            ('GET',    '/api/ruta',                 self.api_ruta),
            ('POST',   '/api/reservas',             self.api_reservar),
            ('GET',    '/api/mis-reservas',         self.api_mis_reservas),
            ('POST',   '/api/rutas',                self.api_publicar_ruta),
            ('GET',    '/api/ia/sugerir',           self.api_ia_sugerir),
            ('GET',    '/api/ia/mapa',              self.api_ia_mapa),
            ('GET',    '/api/admin/usuarios',       self.api_admin_usuarios),
            ('DELETE', '/api/admin/usuarios',       self.api_admin_eliminar),
            ('POST',   '/api/admin/reset',          self.api_admin_reset),
            ('GET',    '/api/admin/bitacora',       self.api_admin_bitacora),
            ('GET',    '/api/admin/cache',          self.api_admin_cache),
            ('POST',   '/api/admin/cache',          self.api_admin_cache),
        ]

        consulta = parse_qs(urlparse(self.path).query)
        id_objetivo = (consulta.get('id') or [None])[0]

        for metodo_endpoint, patron, manejador in endpoints:
            if metodo != metodo_endpoint:
                continue
            if patron == ruta or (patron.endswith('/usuarios')
                                  and ruta.startswith(patron)):
                if solo_cabeceras:
                    self.send_response(204)
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                return self._atender(metodo, patron, manejador, consulta, id_objetivo)

        self.enviar_error_json(f'Endpoint no encontrado: {ruta}', 404)

    def _atender(self, metodo, patron, manejador, consulta, id_objetivo):
        """
        Aplica control de acceso y caché antes de ejecutar el handler.

        El orden importa: primero se comprueba la sesión, después se busca
        en la caché y solo al final se ejecuta la consulta a la base de datos.
        """
        nivel = NIVEL_ACCESO.get(patron, 'libre')

        # 1) Control de acceso ANTES de tocar la caché.
        if nivel == 'sesion' and self._exigir_sesion() is None:
            return
        if nivel == 'admin' and self._exigir_admin() is None:
            return

        # 2) Los endpoints de lectura se sirven desde la caché.
        if metodo == 'GET' and patron in CACHE_PERMITIDOS:
            return self._servir_desde_cache(patron, manejador, consulta, id_objetivo)

        return manejador(consulta, id_objetivo)

    def _servir_desde_cache(self, patron, manejador, consulta, id_objetivo):
        """Cachea la respuesta de un endpoint GET y admite revalidación 304."""
        parametros = '&'.join(f'{k}={v[0]}' for k, v in sorted(consulta.items()) if v)
        grupo = GRUPO_DE_CACHE.get(patron, cache.GRUPO_RUTAS)

        # Si la respuesta depende de quien pregunta, su id forma parte de la clave.
        if patron in CACHE_POR_USUARIO:
            usuario = self.usuario_actual()
            if usuario:
                parametros = f'{parametros}&usuario={usuario["id"]}'

        clave = CACHE.clave(grupo, patron, parametros)

        cuerpo, etag = CACHE.obtener(clave)

        if cuerpo is not None:
            # El cliente ya tiene esta respuesta: basta con confirmar.
            if self.headers.get('If-None-Match') == etag:
                CACHE.registrar_304()
                self._responder_304(etag)
                return
            self._responder_json(cuerpo, 200, etag=etag, estado_cache='HIT')
            return

        # No hay entrada: se ejecuta el handler capturando su respuesta.
        self._captura = {}
        try:
            manejador(consulta, id_objetivo)
        finally:
            captura = self._captura
            self._captura = None

        if not captura or captura.get('cuerpo') is None:
            # El handler ya escribió la respuesta (por ejemplo, un error).
            return

        if captura['estado'] != 200:
            self._responder_json(captura['cuerpo'], captura['estado'],
                                 estado_cache='BYPASS')
            return

        etag = cache.calcular_etag(captura['cuerpo'])
        CACHE.guardar(clave, captura['cuerpo'], etag)

        if self.headers.get('If-None-Match') == etag:
            CACHE.registrar_304()
            self._responder_304(etag)
            return

        self._responder_json(captura['cuerpo'], 200, etag=etag, estado_cache='MISS')

    # --- endpoints publicos ------------------------------------------

    def api_salud(self, consulta, _):
        total = database.usuarios_publicos()
        self.enviar_json({
            'ok': True,
            'servicio': 'Rodando UTP API',
            'version': '1.0.0',
            'base_datos': os.path.basename(database.DB_PATH),
            'usuarios': len(total),
            'motor_ia': 'simulado (sin API externa)',
        })

    def api_registro(self, consulta, _):
        datos = self.leer_cuerpo()
        nombre = (datos.get('nombre') or '').strip()
        correo = (datos.get('correo') or '').strip().lower()
        contrasena = datos.get('password') or datos.get('contrasena') or ''
        zona = (datos.get('zona') or '').strip() or None
        matricula = (datos.get('matricula') or '').strip() or None

        if len(nombre) < 3:
            return self.enviar_error_json('El nombre debe tener al menos 3 caracteres.')
        if '@' not in correo or '.' not in correo.split('@')[-1]:
            return self.enviar_error_json('El correo no parece valido.')
        if len(contrasena) < 6:
            return self.enviar_error_json('La contrasena debe tener al menos 6 caracteres.')
        if database.usuario_por_correo(correo):
            return self.enviar_error_json('Ese correo ya esta registrado.', 409)

        uid = database.crear_usuario(nombre, correo, contrasena,
                                     rol='estudiante', zona=zona, matricula=matricula)
        database.registrar_bitacora(uid, uid, 'registro', f'Alta de usuario {correo}')
        # El número de usuarios cambió: invalida el resumen de la API.
        CACHE.invalidar(cache.GRUPO_USUARIOS)

        token = database.crear_sesion(uid)
        fila = database.usuario_por_id(uid)
        self.enviar_json(
            {'ok': True,
             'mensaje': 'Cuenta creada correctamente.',
             'usuario': _usuario_publico(fila)},
            cabeceras=self._cabecera_cookie(token),
        )

    def api_login(self, consulta, _):
        datos = self.leer_cuerpo()
        correo = (datos.get('correo') or '').strip().lower()
        contrasena = datos.get('password') or datos.get('contrasena') or ''

        fila = database.usuario_por_correo(correo)
        if fila is None or not database.verificar_password(
            contrasena, fila['password_hash'], fila['salt']
        ):
            database.registrar_bitacora(None, None, 'login_fallido',
                                        f'Intento con {correo or "(vacio)"}')
            return self.enviar_error_json('Correo o contrasena incorrectos.', 401)

        token = database.crear_sesion(fila['id'])
        database.registrar_bitacora(fila['id'], fila['id'], 'login',
                                    f'Inicio de sesion de {correo}')
        self.enviar_json(
            {'ok': True, 'usuario': _usuario_publico(fila)},
            cabeceras=self._cabecera_cookie(token),
        )

    def api_logout(self, consulta, _):
        token = self.token_sesion()
        usuario = self.usuario_actual()
        database.borrar_sesion(token)
        if usuario:
            database.registrar_bitacora(usuario['id'], usuario['id'], 'logout',
                                        'Cierre de sesion')
        self.enviar_json({'ok': True},
                         cabeceras=self._cabecera_cookie('', max_age=0))

    def api_sesion(self, consulta, _):
        usuario = self.usuario_actual()
        if usuario is None:
            return self.enviar_json({'ok': True, 'usuario': None, 'autenticado': False})
        self.enviar_json({'ok': True, 'usuario': usuario, 'autenticado': True})

    # --- endpoints que exigen sesion ---------------------------------

    def _exigir_sesion(self):
        usuario = self.usuario_actual()
        if usuario is None:
            self.enviar_error_json('Debes iniciar sesion para usar esta funcion.', 401)
            return None
        return usuario

    def _exigir_admin(self):
        usuario = self._exigir_sesion()
        if usuario is None:
            return None
        if not usuario['es_admin']:
            self.enviar_error_json('Acceso restringido a administradores.', 403)
            return None
        return usuario

    def api_zonas(self, consulta, _):
        filas = database.zonas()
        mapa = {z: ia_simulada.resumen_zona(z) for z in [f['nombre'] for f in filas]}
        self.enviar_json({
            'ok': True,
            'zonas': [
                {
                    'id': f['id'], 'nombre': f['nombre'],
                    'lat': f['lat'], 'lng': f['lng'],
                    'mapa_x': f['mapa_x'], 'mapa_y': f['mapa_y'],
                    'estadisticas': mapa.get(f['nombre'], {}),
                }
                for f in filas
            ],
            'conexiones': ia_simulada.conexiones_detalladas(),
        })

    def api_rutas(self, consulta, _):
        filtros = {
            'origen': (consulta.get('origen') or [None])[0],
            'turno': (consulta.get('turno') or [None])[0],
            'lugares': (consulta.get('lugares') or [None])[0],
        }
        filas = database.rutas_disponibles(filtros)
        self.enviar_json({'ok': True, 'rutas': [_ruta_publica(f) for f in filas]})

    def api_ruta(self, consulta, _):
        rid = (consulta.get('id') or [None])[0]
        if rid is None:
            return self.enviar_error_json('Falta el parametro id.')
        fila = database.ruta_por_id(rid)
        if fila is None:
            return self.enviar_error_json('Ruta no encontrada.', 404)
        self.enviar_json({'ok': True, 'ruta': _ruta_publica(fila)})

    def api_publicar_ruta(self, consulta, _):
        usuario = self._exigir_sesion()
        if usuario is None:
            return
        datos = self.leer_cuerpo()
        origen = (datos.get('origin') or datos.get('origen') or '').strip()
        punto = (datos.get('meetingPoint') or datos.get('punto') or '').strip()
        salida = (datos.get('departure') or datos.get('salida') or '').strip()

        if not origen or not punto or not salida:
            return self.enviar_error_json('Completa origen, punto de encuentro y hora.')
        try:
            lugares = max(1, min(4, int(datos.get('seats') or datos.get('lugares') or 1)))
            aportacion = max(0, int(datos.get('contribution') or datos.get('aportacion') or 0))
        except (TypeError, ValueError):
            return self.enviar_error_json('Lugares y aportacion deben ser numericos.')

        import sqlite3
        with database._write_lock:
            conn = database.get_connection()
            cur = conn.execute(
                'INSERT INTO rutas (conductor_id, origen, punto_encuentro, destino, salida,'
                ' llegada, lugares, aportacion, calificacion, dias, creado_en)'
                ' VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                (usuario['id'], origen, punto, 'UTP', salida, datos.get('arrival'),
                 lugares, aportacion, 5.0, 'Lun,Mar,Mié,Jue,Vie', database.ahora()),
            )
            conn.commit()
            nuevo_id = cur.lastrowid
        database.registrar_bitacora(usuario['id'], usuario['id'], 'publicacion',
                                    f'Ruta creada desde {origen}')
        # Una ruta nueva cambia el listado, el mapa y las sugerencias.
        CACHE.invalidar(cache.GRUPO_RUTAS, cache.GRUPO_IA)
        fila = database.ruta_por_id(nuevo_id)
        self.enviar_json({'ok': True, 'ruta': _ruta_publica(fila),
                          'mensaje': 'Ruta publicada.'})

    def api_reservar(self, consulta, _):
        usuario = self._exigir_sesion()
        if usuario is None:
            return
        datos = self.leer_cuerpo()
        if 'id' in datos:
            ruta_id = datos['id']
        else:
            ruta_id = (consulta.get('ruta') or [None])[0]
        if ruta_id is None:
            return self.enviar_error_json('Falta el identificador de la ruta.')
        ok, mensaje = database.reservar(ruta_id, usuario['id'])
        if ok:
            database.registrar_bitacora(usuario['id'], usuario['id'], 'reserva',
                                        f'Reserva del lugar en ruta {ruta_id}')
            # Un lugar menos cambia el contador de la ruta y las sugerencias.
            CACHE.invalidar(cache.GRUPO_RUTAS, cache.GRUPO_IA)
        fila = database.ruta_por_id(ruta_id) if ok else None
        self.enviar_json({'ok': ok, 'mensaje': mensaje,
                          'ruta': _ruta_publica(fila) if fila else None},
                         200 if ok else 409)

    def api_mis_reservas(self, consulta, _):
        usuario = self._exigir_sesion()
        if usuario is None:
            return
        filas = database.reservas_de(usuario['id'])
        self.enviar_json({'ok': True, 'reservas': [dict(f) for f in filas]})

    # --- motor de sugerencias simuladas -------------------------------

    def api_ia_sugerir(self, consulta, _):
        if self.usuario_actual() is None:
            return self.enviar_error_json(
                'Las sugerencias solo estan disponibles tras iniciar sesion.', 401)
        zona = (consulta.get('zona') or [None])[0]
        turno = (consulta.get('turno') or [None])[0]
        try:
            limite = max(1, min(10, int((consulta.get('limite') or ['5'])[0])))
        except ValueError:
            limite = 5

        sugerencias = ia_simulada.sugerir(zona, turno, limite)
        self.enviar_json({
            'ok': True,
            'simulado': True,
            'aviso': 'Motor de sugerencias SIMULADO. No utiliza ninguna API de IA externa.',
            'zona_consultada': zona,
            'turno_consultado': turno,
            'sugerencias': sugerencias,
        })

    def api_ia_mapa(self, consulta, _):
        if self.usuario_actual() is None:
            return self.enviar_error_json(
                'El mapa inteligente solo esta disponible tras iniciar sesion.', 401)
        zona = (consulta.get('zona') or [None])[0]
        turno = (consulta.get('turno') or [None])[0]
        filas = database.zonas()
        zonas = []
        for f in filas:
            sugeridas = ia_simulada.sugerir(f['nombre'], turno, 3)
            zonas.append({
                'nombre': f['nombre'],
                'lat': f['lat'],
                'lng': f['lng'],
                'mapa_x': f['mapa_x'],
                'mapa_y': f['mapa_y'],
                'estadisticas': ia_simulada.resumen_zona(f['nombre']),
                'destacado': f['nombre'] == zona,
                'mejores': sugeridas[:1],
            })
        self.enviar_json({
            'ok': True,
            'simulado': True,
            'origen': zona,
            'turno': turno,
            'zonas': zonas,
            'conexiones': ia_simulada.conexiones_detalladas(),
            # Sin zona indicada se usa la UTP como origen por defecto, para que
            # el mapa nunca llegue vacio a la interfaz.
            'sugerencias': ia_simulada.sugerir(zona or 'UTP', turno, 5),
        })


    # --- panel de administrador ---------------------------------------

    def api_admin_usuarios(self, consulta, _):
        admin = self._exigir_admin()
        if admin is None:
            return
        filas = database.usuarios_publicos()
        total = len(filas)
        with_admin = sum(1 for f in filas if f['rol'] == 'admin')
        activos = sum(1 for f in filas if f['activo'])
        self.enviar_json({
            'ok': True,
            'resumen': {
                'total': total,
                'administradores': with_admin,
                'estudiantes': sum(1 for f in filas if f['rol'] == 'estudiante'),
                'conductores': sum(1 for f in filas if f['rol'] == 'conductor'),
                'activos': activos,
            },
            'usuarios': [dict(f) for f in filas],
            'usuario_actual': admin['id'],
        })

    def api_admin_eliminar(self, consulta, id_objetivo):
        admin = self._exigir_admin()
        if admin is None:
            return
        if id_objetivo is None:
            return self.enviar_error_json('Falta el parametro id.')

        # Desborde deliberado del panel para confirmar el borrado.
        if (consulta.get('confirmar') or ['1'])[0] == '1' and \
                (consulta.get('force') or [None])[0] != '1':
            # Se usa la vista publica: nunca se devuelve hash ni sal.
            objetivo = next(
                (f for f in database.usuarios_publicos()
                 if str(f['id']) == str(id_objetivo)), None
            )
            if objetivo is None:
                return self.enviar_error_json('Usuario no encontrado.', 404)
            return self.enviar_json({
                'ok': True,
                'requiere_confirmacion': True,
                'usuario': dict(objetivo),
                'mensaje': f'Se eliminara a {objetivo["nombre"]} y sus rutas.',
            }, 200)

        try:
            objetivo_id = int(id_objetivo)
        except ValueError:
            return self.enviar_error_json('Identificador invalido.')

        if objetivo_id == admin['id']:
            return self.enviar_error_json(
                'No puedes eliminar tu propia cuenta desde el panel.', 400)

        objetivo = database.usuario_por_id(objetivo_id)
        if objetivo is None:
            return self.enviar_error_json('Usuario no encontrado.', 404)

        eliminated = database.eliminar_usuario(objetivo_id)
        if not eliminated:
            return self.enviar_error_json('No se pudo eliminar al usuario.', 400)

        database.registrar_bitacora(
            None, admin['id'], 'eliminacion',
            f'{admin["nombre"]} elimino a {objetivo["nombre"]} ({objetivo["correo"]})',
        )
        # El usuario arrastra sus rutas y reservas: se invalidan todos los grupos.
        CACHE.limpiar()
        self.enviar_json({'ok': True,
                          'mensaje': f'Usuario {objetivo["nombre"]} eliminado.',
                          'id': objetivo_id})

    def api_admin_bitacora(self, consulta, _):
        admin = self._exigir_admin()
        if admin is None:
            return
        try:
            limite = max(1, min(200, int((consulta.get('limite') or ['40'])[0])))
        except ValueError:
            limite = 40
        filas = database.ultimas_acciones(limite)
        self.enviar_json({'ok': True, 'bitacora': [dict(f) for f in filas]})

    def api_admin_cache(self, consulta, _):
        """
        Panel de la caché de la API.
        GET  → estadísticas. POST con ?limpiar=1 → vacía la caché.
        """
        admin = self._exigir_admin()
        if admin is None:
            return

        if (consulta.get('limpiar') or ['0'])[0] == '1':
            CACHE.limpiar()
            self.enviar_json({'ok': True, 'mensaje': 'Caché vaciada.',
                              'estadisticas': CACHE.estadisticas()})
            return

        self.enviar_json({
            'ok': True,
            'ttl_segundos': CACHE_TTL,
            'estadisticas': CACHE.estadisticas(),
            'endpoints_cacheables': sorted(CACHE_PERMITIDOS),
            'nota': ('Las respuestas se sirven desde la caché del servidor y '
                    'llevan ETag: el navegador revalida y recibe 304 sin cuerpo. '
                    'La caché se invalida al publicar rutas, reservar lugares o '
                    'eliminar usuarios.'),
        })

    def api_admin_reset(self, consulta, _):
        admin = self._exigir_admin()
        if admin is None:
            return
        if (consulta.get('confirmar') or ['0'])[0] != '1':
            return self.enviar_error_json('Debes confirmar con ?confirmar=1.')
        # Tras el reset se cierra la sesion del administrador.
        database.borrar_sesion(self.token_sesion())
        database.reiniciar()
        CACHE.limpiar()
        self.enviar_json({'ok': True, 'mensaje': 'Base de datos reiniciada.',
                          'mensaje_sesion': 'Vuelve a iniciar sesion.'},
                         cabeceras=self._cabecera_cookie('', max_age=0))

    # --- cookie --------------------------------------------------------

    def _cabecera_cookie(self, token, max_age=None):
        partes = [f'{COOKIE_SESION}={token}', 'Path=/', 'HttpOnly', 'SameSite=Lax']
        if max_age is not None:
            partes.append(f'Max-Age={max_age}')
        return {'Set-Cookie': '; '.join(partes)}


# --------------------------------------------------------------------------
# Serializadores
# --------------------------------------------------------------------------

def _usuario_publico(fila):
    if fila is None:
        return None
    return {
        'id': fila['id'],
        'nombre': fila['nombre'],
        'correo': fila['correo'],
        'rol': fila['rol'],
        'zona': fila['zona'],
        'matricula': fila['matricula'],
        'verificado': bool(fila['verificado']),
        'es_admin': fila['rol'] == 'admin',
    }


def _campo(fila, clave, por_defecto=None):
    """Lee una clave de un sqlite3.Row sin lanzar excepcion si falta."""
    try:
        return fila[clave]
    except (KeyError, IndexError):
        return por_defecto


def _ruta_publica(fila):
    if fila is None:
        return None
    dias = [d.strip() for d in (fila['dias'] or '').split(',') if d.strip()]
    libres = _campo(fila, 'lugares_libres')
    if libres is None:
        libres = int(fila['lugares'])
    return {
        'id': fila['id'],
        'driver': fila['conductor'],
        'origin': fila['origen'],
        'meetingPoint': fila['punto_encuentro'],
        'destination': fila['destino'],
        'departure': fila['salida'],
        'arrival': fila['llegada'] or 'Por confirmar',
        'seats': int(libres),
        'lugares_totales': int(fila['lugares']),
        'contribution': int(fila['aportacion']),
        'rating': float(fila['calificacion']),
        'verified': bool(_campo(fila, 'conductor_verificado', 0)),
        'days': dias,
    }


# --------------------------------------------------------------------------

def main():
    analizador = argparse.ArgumentParser(description='Servidor de Rodando UTP')
    analizador.add_argument('--puerto', type=int, default=5500)
    analizador.add_argument('--host', default='127.0.0.1')
    analizador.add_argument('--reset', action='store_true',
                            help='Borra la base de datos y vuelve a sembrarla')
    args = analizador.parse_args()

    if args.reset:
        database.reiniciar()
        print('  Base de datos reiniciada con los datos de demostracion.')

    database.init_db()
    creado = database.sembrar()
    if creado:
        print('  Base de datos creada y sembrada en data/rodando.db')
    else:
        # Se mantienen al día las coordenadas de las zonas aunque la base
        # ya exista de una ejecución anterior.
        database.refrescar_zonas()

    servidor = ThreadingHTTPServer((args.host, args.puerto), Manejador)
    print(f'\n  Rodando UTP corriendo en http://{args.host}:{args.puerto}')
    print('  Panel de administrador: http://%s:%s/admin.html' % (args.host, args.puerto))
    print('  Admin:    admin@rodandoutp.mx / admin123')
    print('  Estudiante: ana@rodandoutp.mx / utp12345')
    print('  Ctrl+C para detener.\n')
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print('\n  Servidor detenido.')
    finally:
        servidor.server_close()


if __name__ == '__main__':
    main()
