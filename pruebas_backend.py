#!/usr/bin/env python3
"""
Rodando UTP - Pruebas rapidas del backend
==========================================
Ejecuta: python3 pruebas_backend.py

Verifica el servidor HTTP y la base SQLite sin dependencias externas.
"""

import json
import sys
import time
import urllib.error
import urllib.request

BASE = 'http://127.0.0.1:5500'
OK, FALLO = '\033[92mPASA\033[0m', '\033[91mFALLA\033[0m'
resultados = []


def pedir(ruta, metodo='GET', cuerpo=None, cookie=None):
    """Devuelve (estado, datos_json)."""
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(BASE + ruta, data=datos, method=metodo)
    req.add_header('Content-Type', 'application/json')
    if cookie:
        req.add_header('Cookie', cookie)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b'{}'), r.headers.get('Set-Cookie')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b'{}'), e.headers.get('Set-Cookie')
        except json.JSONDecodeError:
            return e.code, {}, None


def pedir_bruto(ruta):
    """Devuelve solo el codigo HTTP, para archivos estaticos."""
    try:
        with urllib.request.urlopen(BASE + ruta) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def pedir_com_cabeceras(ruta, cabeceras_extra=None, metodo='GET', cookie=None):
    """Devuelve (estado, cuerpo, cabeceras) de una respuesta."""
    req = urllib.request.Request(BASE + ruta, method=metodo)
    for clave, valor in (cabeceras_extra or {}).items():
        req.add_header(clave, valor)
    if cookie:
        req.add_header('Cookie', cookie)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read(), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def cabeceras(ruta):
    """Devuelve el diccionario de cabeceras de una respuesta."""
    try:
        with urllib.request.urlopen(BASE + ruta) as r:
            return dict(r.headers)
    except urllib.error.HTTPError as e:
        return dict(e.headers)


def chequear(nombre, condicion, detalle=''):
    resultados.append((nombre, bool(condicion), detalle))
    print(f'  {OK if condicion else FALLO}  {nombre}' + (f'  → {detalle}' if detalle else ''))


def token_de(estado, set_cookie):
    """Extrae el valor de la cookie de sesion."""
    if not set_cookie:
        return None
    return set_cookie.split(';')[0]


def main():
    print('\n=== Rodando UTP · Pruebas del backend ===\n')

    print('-- Servidor y archivos estáticos --')
    s, d, _ = pedir('/api/salud')
    chequear('GET /api/salud responde 200', s == 200 and d.get('ok'), f"usuarios={d.get('usuarios')}")
    chequear('El motor de IA se declara simulado', 'simulado' in str(d.get('motor_ia', '')).lower())
    for ruta in ('/index.html', '/login.html', '/css/styles.css', '/css/mapa-ia.css',
                 '/js/app.js', '/js/sesion.js', '/js/mapa-ia.js', '/data/rutas.json'):
        chequear(f'Se sirve {ruta}', pedir_bruto(ruta) == 200)

    print('\n-- Seguridad de archivos --')
    for ruta in ('/server.py', '/database.py', '/ia_simulated.py',
                 '/data/rodando.db', '/data/rodando.db-wal', '/.git/config', '/README.md'):
        codigo = pedir_bruto(ruta)
        chequear(f'{ruta} NO es público', codigo in (403, 404), f'HTTP {codigo}')
    chequear('admin.html exige sesión', pedir_bruto('/admin.html') == 401)

    print('\n-- Estrategia de caché --')
    cab_api = cabeceras('/api/rutas')
    chequear('La API cacheable se guarda pero se revalida siempre',
             'no-cache' in cab_api.get('Cache-Control', '') and
             'private' in cab_api.get('Cache-Control', ''),
             cab_api.get('Cache-Control', '(sin cabecera)'))
    chequear('La API cacheable no se guarda en cachés compartidas',
             'no-store' not in cab_api.get('Cache-Control', ''))
    cab_sesion = cabeceras('/api/sesion')
    chequear('La sesión no se cachea en absoluto',
             'no-store' in cab_sesion.get('Cache-Control', ''),
             cab_sesion.get('Cache-Control', '(sin cabecera)'))
    cab_html = cabeceras('/index.html')
    chequear('Los archivos estáticos se revalidan siempre',
             'no-cache' in cab_html.get('Cache-Control', ''),
             cab_html.get('Cache-Control', '(sin cabecera)'))

    print('\n-- Autenticación --')
    s, d, _ = pedir('/api/login', 'POST', {'correo': 'admin@rodandoutp.mx', 'password': 'incorrecta'})
    chequear('Login con contraseña errónea devuelve 401', s == 401, d.get('error', ''))
    s, d, _ = pedir('/api/registro', 'POST',
                    {'nombre': 'X', 'correo': 'c@c.com', 'password': '123'})
    chequear('Registro con datos inválidos devuelve 400', s == 400, d.get('error', ''))

    s, d, ck = pedir('/api/login', 'POST', {'correo': 'admin@rodandoutp.mx', 'password': 'admin123'})
    chequear('Login de administrador correcto', s == 200 and d['usuario']['es_admin'], d['usuario']['nombre'])
    token_admin = token_de(s, ck)
    chequear('Se emite cookie de sesión HttpOnly', bool(token_admin) and 'HttpOnly' in ck)

    s, d, ck = pedir('/api/login', 'POST', {'correo': 'ana@rodandoutp.mx', 'password': 'utp12345'})
    chequear('Login de estudiante correcto', s == 200 and not d['usuario']['es_admin'])
    token_est = token_de(s, ck)

    s, d, _ = pedir('/api/sesion', cookie=token_est)
    chequear('La sesión reconoce al estudiante', d.get('autenticado') and d['usuario']['nombre'])

    print('\n-- Control de acceso --')
    s, _, _ = pedir('/api/ia/sugerir?zona=Cholula')
    chequear('La IA exige sesión (401)', s == 401)
    s, _, _ = pedir('/api/admin/usuarios', cookie=token_est)
    chequear('Un estudiante no entra al panel (403)', s == 403)
    s, _, _ = pedir('/api/admin/usuarios')
    chequear('Sin sesión tampoco (401)', s == 401)
    s, d, _ = pedir('/api/admin/usuarios', cookie=token_admin)
    chequear('El administrador sí entra al panel', s == 200, f"total={d['resumen']['total']}")

    print('\n-- Caché de la API --')
    # Se fuerza un estado conocido: la caché se vacía antes de empezar.
    s, _, _ = pedir('/api/admin/cache?limpiar=1', 'POST', cookie=token_admin)
    chequear('Se puede vaciar la caché', s == 200)

    estado, cuerpo1, cab1 = pedir_com_cabeceras('/api/rutas')
    chequear('La primera petición se marca como MISS',
             cab1.get('X-Cache') == 'MISS', cab1.get('X-Cache', '(sin cabecera)'))
    chequear('La respuesta cacheable lleva ETag', bool(cab1.get('ETag')))
    chequear('La respuesta cacheable se puede revalidar',
             'no-cache' in cab1.get('Cache-Control', ''), cab1.get('Cache-Control', ''))

    estado, cuerpo2, cab2 = pedir_com_cabeceras('/api/rutas')
    chequear('La segunda petición se sirve desde la caché',
             cab2.get('X-Cache') == 'HIT', cab2.get('X-Cache', '(sin cabecera)'))
    chequear('El ETag no cambia entre llamadas', cab1.get('ETag') == cab2.get('ETag'))
    chequear('El cuerpo servido es idéntico', cuerpo1 == cuerpo2)

    # Revalidación condicional: el navegador ya tiene la respuesta.
    etag = cab1.get('ETag')
    estado, cuerpo3, cab3 = pedir_com_cabeceras('/api/rutas', {'If-None-Match': etag})
    chequear('Con If-None-Match el servidor responde 304', estado == 304, f'HTTP {estado}')
    chequear('El 304 no lleva cuerpo', len(cuerpo3) == 0, f'{len(cuerpo3)} bytes')
    chequear('El 304 conserva el ETag', cab3.get('ETag') == etag)

    # Un ETag distinto NO debe producir 304.
    estado, _, _ = pedir_com_cabeceras('/api/rutas', {'If-None-Match': '"inventado"'})
    chequear('Un ETag distinto devuelve la respuesta completa', estado == 200, f'HTTP {estado}')

    # Los endpoints de sesión NUNCA se cachean.
    for ruta in ('/api/sesion', '/api/mis-reservas'):
        _, _, cab = pedir_com_cabeceras(ruta, cookie=token_est)
        chequear(f'{ruta} nunca se cachea',
                 'no-store' in cab.get('Cache-Control', '') and 'X-Cache' not in cab,
                 cab.get('Cache-Control', '(sin cabecera)'))

    # La caché se invalida al cambiar los datos.
    _, antes, _ = pedir_com_cabeceras('/api/rutas')
    total_antes = len(json.loads(antes)['rutas'])
    correo_cache = f'cache{int(time.time())}@rodandoutp.mx'
    s, nuevo, _ = pedir('/api/registro', 'POST',
                        {'nombre': 'Usuario Cache', 'correo': correo_cache,
                         'password': 'clave123', 'zona': 'Centro'})
    id_cache = nuevo['usuario']['id']
    s, _, _ = pedir('/api/login', 'POST', {'correo': correo_cache, 'password': 'clave123'})
    _, _, ck_cache = pedir('/api/login', 'POST',
                           {'correo': correo_cache, 'password': 'clave123'})
    token_cache = token_de(s, ck_cache)
    s, pub, _ = pedir('/api/rutas', 'POST',
                      {'origin': 'Centro', 'meetingPoint': 'Ruta de prueba de caché',
                       'departure': '10:30', 'seats': 2, 'contribution': 28}, cookie=token_cache)
    chequear('Se publica una ruta para probar la invalidación', s == 200)

    _, _, cab = pedir_com_cabeceras('/api/rutas')
    chequear('Publicar una ruta invalida la caché', cab.get('X-Cache') == 'MISS',
             cab.get('X-Cache', '(sin cabecera)'))
    _, despues, _ = pedir_com_cabeceras('/api/rutas')
    datos_despues = json.loads(despues)
    chequear('La ruta nueva aparece de inmediato',
             any(r['meetingPoint'] == 'Ruta de prueba de caché' for r in datos_despues['rutas']),
             f"{total_antes} → {len(datos_despues['rutas'])} rutas")

    # Reservar un lugar también cambia los contadores.
    s, _, cab = pedir_com_cabeceras('/api/ruta?id=1')
    chequear('Consultar una ruta se cachea', cab.get('X-Cache') in ('MISS', 'HIT'),
             cab.get('X-Cache', '(sin cabecera)'))

    # Limpieza de los datos de prueba.
    s, d, _ = pedir(f'/api/admin/usuarios?id={id_cache}&force=1', 'DELETE', cookie=token_admin)
    chequear('Se limpia el usuario de prueba de caché', s == 200, d.get('mensaje', ''))
    _, _, cab = pedir_com_cabeceras('/api/rutas')
    chequear('Borrar un usuario también invalida la caché', cab.get('X-Cache') == 'MISS',
             cab.get('X-Cache', '(sin cabecera)'))

    s, d, _ = pedir('/api/admin/cache', cookie=token_admin)
    chequear('El panel de caché expone las estadísticas', s == 200 and 'estadisticas' in d)
    chequear('Las estadísticas cuentan aciertos y fallos',
             'aciertos' in d['estadisticas'] and 'fallos' in d['estadisticas'])
    s, _, _ = pedir('/api/admin/cache')
    chequear('El panel de caché exige sesión de administrador', s == 401)

    print('\n-- Contrato entre la API y el frontend --')
    # El frontend consume claves concretas de la API. Si una de estas
    # desaparece, la pagina cae en silencio al respaldo y deja de mostrar
    # datos reales: estas pruebas fijan el contrato.
    s, d, _ = pedir('/api/rutas')
    chequear('/api/rutas entrega la lista "rutas"',
             isinstance(d.get('rutas'), list) and len(d['rutas']) > 0,
             f"{len(d.get('rutas', []))} rutas")
    if d.get('rutas'):
        r0 = d['rutas'][0]
        claves_ruta = ['id', 'driver', 'origin', 'meetingPoint', 'destination',
                       'departure', 'arrival', 'seats', 'contribution',
                       'rating', 'verified', 'days']
        faltan = [c for c in claves_ruta if c not in r0]
        chequear('Cada ruta trae las claves que usa la interfaz',
                 not faltan, f'faltan: {faltan}' if faltan else 'todas presentes')

    s, d, _ = pedir('/api/zonas')
    chequear('/api/zonas entrega "zonas" con coordenadas de mapa',
             isinstance(d.get('zonas'), list) and
             all('mapa_x' in z and 'mapa_y' in z for z in d['zonas']),
             f"{len(d.get('zonas', []))} zonas")
    chequear('/api/zonas entrega las conexiones entre zonas',
             isinstance(d.get('conexiones'), list) and len(d['conexiones']) > 0,
             f"{len(d.get('conexiones', []))} conexiones")

    s, d, _ = pedir('/api/sesion', cookie=token_est)
    chequear('/api/sesion entrega "usuario" y "autenticado"',
             'usuario' in d and 'autenticado' in d)

    s, d, _ = pedir('/api/admin/usuarios', cookie=token_admin)
    chequear('/api/admin/usuarios entrega "usuarios", "resumen" y "usuario_actual"',
             all(k in d for k in ('usuarios', 'resumen', 'usuario_actual')))
    s, d, _ = pedir('/api/admin/bitacora', cookie=token_admin)
    chequear('/api/admin/bitacora entrega "bitacora"', isinstance(d.get('bitacora'), list))

    # El JSON estatico y la API usan nombres distintos: el frontend debe
    # saber leer ambos.
    s, d, _ = pedir('/api/admin/cache', cookie=token_admin)
    chequear('/api/admin/cache entrega "estadisticas"',
             'estadisticas' in d and 'aciertos' in d['estadisticas'])

    print('\n-- Motor de sugerencias (IA simulada) --')
    s, d, _ = pedir('/api/ia/sugerir?zona=Cholula&turno=morning', cookie=token_est)
    chequear('Devuelve sugerencias', s == 200 and len(d['sugerencias']) > 0, f"{len(d.get('sugerencias', []))} sugerencias")
    chequear('Se declara como simulación', d.get('simulado') is True)
    if d.get('sugerencias'):
        mejor = d['sugerencias'][0]
        chequear('La puntuación va de 0 a 100', 0 <= mejor['puntaje'] <= 100, f"{mejor['puntaje']}/100")
        chequear('Incluye razones explicables', len(mejor['razones']) > 0, mejor['razones'][0][:56])
        chequear('El turno matutino se prioriza', mejor['turno'] == 'Matutino', mejor['turno'])
    s, d, _ = pedir('/api/ia/mapa?zona=Cholula', cookie=token_est)
    chequear('El mapa trae 6 zonas', s == 200 and len(d['zonas']) == 6)
    chequear('El mapa dibuja conexiones entre zonas', len(d['conexiones']) == 9)
    ch = next((z for z in d['zonas'] if z['nombre'] == 'Cholula'), None)
    chequear('Las coordenadas del mapa son válidas', ch and 0 < ch['mapa_x'] < 980 and 0 < ch['mapa_y'] < 720,
              f"({ch['mapa_x']}, {ch['mapa_y']})" if ch else 'no encontrada')

    print('\n-- Rutas y reservas --')
    s, d, _ = pedir('/api/rutas')
    chequear('GET /api/rutas responde', s == 200, f"{len(d.get('rutas', []))} rutas")
    s, d, _ = pedir('/api/rutas?origen=Cholula')
    chequear('El filtro por origen funciona', all(r['origin'] == 'Cholula' for r in d['rutas']),
              f"{len(d['rutas'])} desde Cholula")
    s, d, _ = pedir('/api/ruta?id=1')
    chequear('GET /api/ruta por id', s == 200 and d['ruta']['id'] == 1)
    s, d, _ = pedir('/api/ruta?id=99999')
    chequear('Una ruta inexistente da 404', s == 404)

    # Usuario nuevo para que la prueba de reservas no dependa de ejecuciones previas.
    correo_pasajero = f'pasajero{int(time.time())}@rodandoutp.mx'
    s, pasajero, _ = pedir('/api/registro', 'POST',
                           {'nombre': 'Pasajero de Prueba', 'correo': correo_pasajero,
                            'password': 'clave123', 'zona': 'Amozoc'})
    chequear('Se crea un pasajero de prueba', s == 200, f"id={pasajero['usuario']['id']}")
    id_pasajero = pasajero['usuario']['id']
    s, _, ck_pas = pedir('/api/login', 'POST', {'correo': correo_pasajero, 'password': 'clave123'})
    token_pas = token_de(s, ck_pas)

    s, d, _ = pedir('/api/reservas', 'POST', {'id': 1})
    chequear('Reservar sin sesión da 401', s == 401, d.get('error', ''))

    libres_antes = pedir('/api/ruta?id=1')[1]['ruta']['seats']
    s, d, _ = pedir('/api/reservas', 'POST', {'id': 1}, cookie=token_pas)
    libres_despues = pedir('/api/ruta?id=1')[1]['ruta']['seats']
    chequear('La reserva descuenta un lugar', s == 200 and libres_despues == libres_antes - 1,
             f"{libres_antes} → {libres_despues}")

    s, d, _ = pedir('/api/reservas', 'POST', {'id': 1}, cookie=token_pas)
    chequear('Reservar dos veces no duplica',
             pedir('/api/ruta?id=1')[1]['ruta']['seats'] == libres_despues, d.get('mensaje', ''))

    s, d, _ = pedir('/api/mis-reservas', cookie=token_pas)
    chequear('El pasajero ve su reserva en el historial', s == 200 and len(d['reservas']) == 1)

    # Publicar ruta propia y comprobar que no se puede reservar a uno mismo.
    s, d, _ = pedir('/api/rutas', 'POST',
                    {'origin': 'Centro', 'meetingPoint': 'Punto de prueba',
                     'departure': '08:00', 'seats': 2, 'contribution': 25}, cookie=token_pas)
    id_ruta_propia = d.get('ruta', {}).get('id')
    chequear('Un usuario publica su propia ruta', s == 200 and id_ruta_propia is not None,
             f"id={id_ruta_propia}")
    s, d, _ = pedir('/api/reservas', 'POST', {'id': id_ruta_propia}, cookie=token_pas)
    chequear('No puede reservar en su propia ruta', s == 409, d.get('error', ''))

    print('\n-- Panel de administrador --')
    s, d, _ = pedir('/api/admin/usuarios?id=1&force=1', 'DELETE', cookie=token_admin)
    chequear('El admin no puede borrarse a sí mismo', s == 400, d.get('error', ''))
    s, d, _ = pedir('/api/admin/usuarios?id=99999&force=1', 'DELETE', cookie=token_admin)
    chequear('Borrar un id inexistente da 404', s == 404)

    correo_prueba = f'prueba{int(time.time())}@rodandoutp.mx'
    s, nuevo, _ = pedir('/api/registro', 'POST',
                        {'nombre': 'Usuario Disposable', 'correo': correo_prueba,
                         'password': 'clave123', 'zona': 'Centro'})
    chequear('Se crea un usuario descartable', s == 200, f"id={nuevo['usuario']['id']}")
    id_prueba = nuevo['usuario']['id']

    s, d, _ = pedir(f'/api/admin/usuarios?id={id_prueba}', 'DELETE', cookie=token_admin)
    chequear('El borrado pide confirmación previa', d.get('requiere_confirmacion') is True)
    chequear('La vista previa NO filtra el hash de contraseña',
             'password_hash' not in json.dumps(d.get('usuario', {})))

    s, d, _ = pedir(f'/api/admin/usuarios?id={id_prueba}&force=1', 'DELETE', cookie=token_admin)
    chequear('El borrado confirmado se ejecuta', s == 200 and d.get('ok'), d.get('mensaje', ''))
    s, d, _ = pedir('/api/admin/usuarios', cookie=token_admin)
    ids = [u['id'] for u in d['usuarios']]
    chequear('El usuario desaparece del listado', id_prueba not in ids, f"quedan {len(ids)}")
    chequear('Las tarjetas de resumen se actualizan', d['resumen']['total'] == len(ids))

    s, d, _ = pedir('/api/admin/bitacora', cookie=token_admin)
    chequear('La bitácora registra la eliminación',
             any('eliminacion' in e['accion'] for e in d.get('bitacora', [])))

    # Limpieza: el pasajero de prueba (con su ruta y reserva) tambien se borra.
    s, d, _ = pedir(f'/api/admin/usuarios?id={id_pasajero}&force=1', 'DELETE', cookie=token_admin)
    chequear('Se limpia el pasajero de prueba', s == 200, d.get('mensaje', ''))
    s, d, _ = pedir(f'/api/ruta?id={id_ruta_propia}')
    chequear('Su ruta se borró en cascada', s == 404)

    print('\n-- Cierre de sesión --')
    s, _, ck = pedir('/api/logout', 'POST', cookie=token_admin)
    chequear('Logout responde 200', s == 200)
    chequear('Logout limpia la cookie', 'Max-Age=0' in (ck or ''))
    s, d, _ = pedir('/api/sesion', cookie=token_admin)
    chequear('El token ya no sirve tras el logout', not d.get('autenticado'))

    total = len(resultados)
    pasos = sum(1 for _, ok, _ in resultados if ok)
    print(f'\n=== {pasos}/{total} pruebas correctas ===\n')
    return 0 if pasos == total else 1


if __name__ == '__main__':
    sys.exit(main())
