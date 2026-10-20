"""
Rodando UTP - Motor de sugerencias "IA" (SIMULADO)
===================================================
Este modulo NO llama a ninguna API de inteligencia artificial. Es un
algoritmo determinista hecho a proposito para la demostracion academica:

1. La ciudad se modela como un GRAFO DE ZONAS. Cada arista guarda los
   minutos aproximados de trayecto entre dos zonas.
2. Dijkstra calcula el tiempo real de leveled desde la zona del pasajero
   hasta la zona del conductor (no solo la distancia en linea recta).
3. Un PUNTAJE combina distancia, closeness de horario, reputacion y
   disponibilidad de lugares.
4. Cada sugerencia incluye una RAZON legible que simula el razonamiento
   del modelo, para poder explicar el resultado en la presentacion.

El objetivo es unicamente Didactico: bajo costo, sin claves de API y con
resultados reproducibles.
"""

import heapq
import math
import re

# --------------------------------------------------------------------------
# 1. Grafo de zonas de la region de Puebla
#   clave = (zona_a, zona_b) -> minutos aproximados de trayecto
#   Los minutos se derivan de la distancia real entre zonas (haversine)
#   asumiendo unos 30 km/h de trafico urbano en Puebla mas un margen.
# --------------------------------------------------------------------------

# Coordenadas de referencia de cada zona (WGS84).
COORDENADAS = {
    'Cholula':      (19.0641, -98.3035),
    'Angelópolis':  (19.0319, -98.2325),
    'Amozoc':       (19.1167, -98.3997),
    'Centro':       (19.0414, -98.2063),
    'La Margarita': (18.9580, -98.2830),
    'UTP':          (19.0490, -98.3420),
}

TIEMPOS = {
    ('UTP', 'Cholula'): 10,
    ('Cholula', 'Angelópolis'): 20,
    ('UTP', 'Angelópolis'): 20,
    ('UTP', 'La Margarita'): 30,
    ('UTP', 'Centro'): 30,
    ('UTP', 'Amozoc'): 30,
    ('Angelópolis', 'Centro'): 10,
    ('Centro', 'La Margarita'): 30,
    ('La Margarita', 'Amozoc'): 45,
}

# Peso "socioeconomico" de la zona para la prioridad (0.0 - 1.0).
# Zonas con mas estudiantes y mejor conectividad pesan mas alto.
PESO_ZONA = {
    'Cholula': 0.95,
    'Angelópolis': 0.80,
    'UTP': 1.00,
    'Centro': 0.65,
    'La Margarita': 0.45,
    'Amozoc': 0.40,
}

VECINOS = {}
for (a, b), minutos in TIEMPOS.items():
    VECINOS.setdefault(a, {})[b] = minutos
    VECINOS.setdefault(b, {})[a] = minutos


def minutos_entre(zona_a, zona_b):
    """Trayecto directo o 0 si no hay arista directa."""
    return VECINOS.get(zona_a, {}).get(zona_b, 0)


def distancia_km(zona_a, zona_b):
    """
    Distancia en linea recta entre dos zonas, en kilometros (haversine).
    Se usa para mostrar la distancia real en el mapa y para comprobar que
    los tiempos del grafo son proporcionales al territorio.
    """
    if zona_a not in COORDENADAS or zona_b not in COORDENADAS:
        return None
    lat1, lon1 = COORDENADAS[zona_a]
    lat2, lon2 = COORDENADAS[zona_b]
    radio = 6371.0
    f1, f2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(f1) * math.cos(f2) * math.sin(dlon / 2) ** 2
    return round(2 * radio * math.asin(math.sqrt(a)), 1)


def conexiones_detalladas():
    """Aristas del grafo con minutos y distancia real, para dibujar el mapa."""
    return [
        {'de': a, 'a': b, 'minutos': m, 'km': distancia_km(a, b)}
        for (a, b), m in TIEMPOS.items()
    ]


def ruta_mas_corta(origen, destino):
    """
    Dijkstra sobre el grafo de zonas.
    Devuelve (minutos, [trayecto]) o (None, []) si no hay conexion.
    """
    if origen == destino:
        return 0, [origen]
    if origen not in VECINOS or destino not in VECINOS:
        return None, []

    distancias = {origen: 0}
    previo = {}
    visitados = set()
    cola = [(0, origen)]

    while cola:
        costo, actual = heapq.heappop(cola)
        if actual in visitados:
            continue
        visitados.add(actual)
        if actual == destino:
            break
        for vecino, peso in VECINOS.get(actual, {}).items():
            nuevo = costo + peso
            if nuevo < distancias.get(vecino, math.inf):
                distancias[vecino] = nuevo
                previo[vecino] = actual
                heapq.heappush(cola, (nuevo, vecino))

    if destino not in distancias:
        return None, []

    trayecto = [destino]
    nodo = destino
    while nodo in previo:
        nodo = previo[nodo]
        trayecto.append(nodo)
    trayecto.reverse()
    return distancias[destino], trayecto


# --------------------------------------------------------------------------
# 2. Utilidades de tiempo
# --------------------------------------------------------------------------

def a_minutos(hora):
    """'07:20' -> 440"""
    try:
        h, m = hora.split(':')
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError):
        return 0


def a_hora(minutos):
    minutos = int(minutos) % (24 * 60)
    return f'{minutos // 60:02d}:{minutos % 60:02d}'


TURNOS = {'morning': 'Matutino', 'afternoon': 'Vespertino',
          'matutino': 'Matutino', 'vespertino': 'Vespertino'}


def turno_de(hora):
    return 'Matutino' if a_minutos(hora) < 12 * 60 else 'Vespertino'


def normalizar_turno(valor):
    """Acepta 'morning'/'afternoon' o 'Matutino'/'Vespertino' y unifica."""
    if not valor:
        return None
    return TURNOS.get(str(valor).strip().lower())


def _leer(fila, clave, por_defecto=None):
    """Lee una clave tanto de un dict como de una fila sqlite3.Row."""
    try:
        return fila[clave]
    except (KeyError, IndexError):
        return por_defecto


# --------------------------------------------------------------------------
# 3. Puntuacion
# --------------------------------------------------------------------------

def puntuar(origen_pasajero, ruta, turno_objetivo=None):
    """
    Devuelve un diccionario con el desglose de la puntuacion.
    Cada componente esta normalizada a 100 para poder explicarla.
    """
    zona_conductor = _leer(ruta, 'origen')
    minutos, trayecto = ruta_mas_corta(origen_pasajero, zona_conductor)

    if minutos is None:
        return None

    # --- Componente 1: cercania (max 40 puntos) --------------------------
    # 0 min = 40 pts, 60 min = 0 pts (decae lineal).
    cercania = max(0.0, (60 - minutos) / 60 * 40)

    # --- Componente 2: horario (max 20 puntos) --------------------------
    salida = _leer(ruta, 'salida')
    turno_ruta = turno_de(salida)
    if turno_objetivo is None:
        # Sin preferencia declarada: se privilegia una salida temprana
        # (las 07:00 son la franja mas demandada en la UTP).
        penalidad = abs(a_minutos(salida) - 7 * 60) / 60
        horario = max(0.0, 16.0 - penalidad * 1.6)
    elif turno_ruta == turno_objetivo:
        horario = 20.0
    else:
        # Turnos distintos (Matutino <-> Vespertino) valen la mitad.
        horario = 8.0

    # --- Componente 3: reputacion (max 20 puntos) -----------------------
    reputacion = (float(_leer(ruta, 'calificacion', 5.0)) / 5.0) * 20

    # --- Componente 4: disponibilidad (max 10 puntos) -------------------
    libres = int(_leer(ruta, 'lugares_libres', 0) or 0)
    disponibilidad = min(10.0, (libres / 4) * 10) if libres > 0 else 0.0

    # --- Componente 5: peso de la zona (max 10 puntos) ------------------
    peso = PESO_ZONA.get(zona_conductor, 0.5) * 10

    # Escala maxima de la suma: 40 + 20 + 20 + 10 + 10 = 100.
    total = cercania + horario + reputacion + disponibilidad + peso

    return {
        'ruta_id': _leer(ruta, 'id'),
        'conductor': _leer(ruta, 'conductor'),
        'origen': zona_conductor,
        'punto_encuentro': _leer(ruta, 'punto_encuentro'),
        'salida': salida,
        'llegada': _leer(ruta, 'llegada'),
        'turno': turno_ruta,
        'lugares_libres': libres,
        'aportacion': int(_leer(ruta, 'aportacion', 0) or 0),
        'calificacion': float(_leer(ruta, 'calificacion', 5.0)),
        'verificado': bool(_leer(ruta, 'conductor_verificado', 0)),
        'minutos_estimados': minutos,
        'trayecto': trayecto,
        'hora_llegada_estimada': a_hora(a_minutos(salida) + minutos),
        'puntaje': round(total, 1),
        'confianza': max(12, min(98, round(total))),
        'componentes': {
            'cercania': round(cercania, 1),
            'horario': round(horario, 1),
            'reputacion': round(reputacion, 1),
            'disponibilidad': round(disponibilidad, 1),
            'zona': round(peso, 1),
        },
        'razones': _razones(origen_pasajero, zona_conductor, minutos, trayecto,
                             ruta, turno_objetivo, libres),
    }


def _razones(origen, destino, minutos, trayecto, ruta, turno_objetivo, libres):
    """Simula el razonamiento del modelo con frases comprensibles."""
    frases = []

    if minutos == 0:
        frases.append(f'El conductor sale de tu misma zona ({destino}), sin traslados previos.')
    elif minutos <= 15:
        frases.append(
            f'Zona cercana: {minutos} min de {origen} a {destino}'
            + (f' pasando por {" → ".join(trayecto)}.' if len(trayecto) > 2 else '.')
        )
    else:
        frases.append(
            f'Recorrido de {minutos} min desde {origen}; el trayecto pasa por '
            f'{" → ".join(trayecto)}.'
        )

    salida = _leer(ruta, 'salida')
    turno_ruta = turno_de(salida)
    if turno_objetivo and turno_ruta == turno_objetivo:
        frases.append(f'Su salida {salida} ({turno_ruta}) coincide con el turno que buscas.')
    else:
        frases.append(f'Sale a las {salida} ({turno_ruta}).')

    cal = float(_leer(ruta, 'calificacion', 5.0))
    if cal >= 4.8:
        frases.append(f'Reputación alta: {cal:.1f}/5 entre la comunidad.')
    elif cal >= 4.5:
        frases.append(f'Reputación sólida: {cal:.1f}/5.')

    if libres == 1:
        frases.append('Solo queda 1 lugar: reserva pronto.')
    elif libres > 1:
        frases.append(f'{libres} lugares disponibles ahora mismo.')

    aport = int(_leer(ruta, 'aportacion', 0) or 0)
    if aport <= 25:
        frases.append(f'Aportación baja para el trayecto: ${aport} MXN.')
    elif aport >= 40:
        frases.append(f'Aportación de ${aport} MXN, la más alta del grupo similar.')

    if _leer(ruta, 'conductor_verificado', 0):
        frases.append('Perfil verificado por la universidad.')

    return frases


# --------------------------------------------------------------------------
# 4. API del motor
# --------------------------------------------------------------------------

def sugerir(origen, turno_objetivo=None, limite=5):
    """
    Genera las sugerencias ordenadas para un pasajero situado en `origen`.
    Es la funcion que consume el endpoint /api/ia/sugerir.
    """
    import database

    origen = (origen or '').strip()
    if origen not in VECINOS and origen != 'UTP':
        # Zona desconocida: se ignora el filtro geografico pero se avisa.
        origen_valido = None
    else:
        origen_valido = origen

    turno_objetivo = normalizar_turno(turno_objetivo)

    filas = database.rutas_disponibles()

    sugerencias = []
    for ruta in filas:
        libres = int(_leer(ruta, 'lugares_libres', 0) or 0)
        if libres <= 0:
            continue
        base = origen_valido or 'UTP'
        resultado = puntuar(base, ruta, turno_objetivo)
        if resultado is None:
            continue
        if origen_valido is None:
            resultado['puntaje'] = round(resultado['puntaje'] * 0.6, 1)
            resultado['confianza'] = max(10, resultado['confianza'] - 25)
            resultado['razones'].insert(0, 'Sin zona definida: se asume salida desde la UTP.')
        sugerencias.append(resultado)

    sugerencias.sort(key=lambda s: (-s['puntaje'], s['salida']))
    return sugerencias[:limite]


def resumen_zona(zona):
    """Estadisticas por zona que se muestran en el mapa."""
    import database

    filas = database.rutas_disponibles({'origen': zona})
    if not filas:
        return {'zona': zona, 'rutas': 0, 'lugares': 0, 'promedio': 0, 'conductores': 0}
    total_lugares = sum(int(r['lugares_libres']) for r in filas)
    promedio = sum(int(r['aportacion']) for r in filas) / len(filas)
    conductores = len({r['conductor_id'] for r in filas})
    return {
        'zona': zona,
        'rutas': len(filas),
        'lugares': total_lugares,
        'promedio': round(promedio, 1),
        'conductores': conductores,
    }
