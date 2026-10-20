"""
Rodando UTP - Cache de la API
=============================
Implementa dos mecanismos complementarios:

1. CACHE EN EL SERVIDOR (clase `CacheAPI`)
   Guarda en memoria las respuestas JSON de los endpoints de lectura mas
   consultadas, con un tiempo de vida (TTL) y con INVALIDACION POR GENERACION.
   Cuando cambia un dato (se publica una ruta, se reserva un lugar, se borra
   un usuario) se incrementa la generacion de su grupo: las entradas viejas
   dejan de ser alcanzables de inmediato, sin tener que recorrerlas.
   Es O(1) y no puede dejar datos obsoletos en juego.

2. CACHE EN EL NAVEGADOR (ETag / If-None-Match)
   Cada respuesta cacheada lleva un ETag (huella del cuerpo). Si el cliente
   vuelve a pedirla con `If-None-Match`, el servidor contesta `304 Not Modified`
   sin cuerpo. El navegador conserva la respuesta y el servidor sigue siendo
   quien decide si es valida: nunca hay datos obsoletos, solo se ahorra
   ancho de banda y consultas.

Que la API se sirva desde la cache NO significa que el cliente pueda ver
datos viejos: el TTL y la invalidacion garantizan que la siguiente lectura
ya refleje el estado real de la base de datos.
"""

import hashlib
import threading
import time

# Grupo de cache. Cada grupo tiene su propia generacion; al invalidar uno,
# todas las entradas de ese grupo dejan de ser alcanzables.
GRUPO_RUTAS = 'rutas'
GRUPO_USUARIOS = 'usuarios'
GRUPO_IA = 'ia'


def calcular_etag(cuerpo):
    """
    Huella ETag (fuerte) del cuerpo de la respuesta.
    Se usa el SHA-256 recortado: suficiente para detectar cualquier cambio
    y lo bastante corto para traveling por cabeceras.
    """
    if isinstance(cuerpo, str):
        cuerpo = cuerpo.encode('utf-8')
    return '"' + hashlib.sha256(cuerpo).hexdigest()[:32] + '"'


class CacheAPI:
    """Caché en memoria con TTL, invalidación por generación y estadísticas."""

    def __init__(self, ttl=30, max_entradas=500):
        self.ttl = ttl
        self.max_entradas = max_entradas
        self._entradas = {}          # clave -> dict(cuerpo, etag, expira, creado)
        self._generaciones = {}      # grupo -> numero de generacion
        self._lock = threading.RLock()
        self._hits = 0
        self._fallos = 0
        self._invalidaciones = 0
        self._expulsiones = 0
        self._aciertos_304 = 0

    # ------------------------------------------------------------ claves

    def clave(self, grupo, recurso, parametros=''):
        """
        Construye la clave de una entrada.
        La generacion forma parte de la clave, por lo que invalidar un grupo
        invalida de golpe todas sus entradas sin recorrerlas.
        """
        generacion = self._generaciones.get(grupo, 0)
        return f'{grupo}#{generacion}::{recurso}?{parametros}'

    # ------------------------------------------------------------- acceso

    def obtener(self, clave):
        """Devuelve (cuerpo, etag) si la entrada sigue viva; (None, None) si no."""
        with self._lock:
            entrada = self._entradas.get(clave)
            if entrada is None:
                self._fallos += 1
                return None, None
            if entrada['expira'] <= time.monotonic():
                del self._entradas[clave]
                self._fallos += 1
                return None, None
            self._hits += 1
            return entrada['cuerpo'], entrada['etag']

    def guardar(self, clave, cuerpo, etag, ttl=None):
        """Almacena una respuesta. Devuelve la etiqueta usada."""
        with self._lock:
            if clave in self._entradas:
                # Reusa la entrada: no hay que recalcular nada.
                self._entradas[clave].update({
                    'cuerpo': cuerpo, 'etag': etag,
                    'expira': time.monotonic() + (ttl or self.ttl),
                })
                return etag
            self._entradas[clave] = {
                'cuerpo': cuerpo,
                'etag': etag,
                'expira': time.monotonic() + (ttl or self.ttl),
                'creado': time.monotonic(),
            }
            self._expulsar_si_hace_falta()
            return etag

    def _expulsar_si_hace_falta(self):
        """Descarta las entradas más antiguas si se supera el máximo."""
        while len(self._entradas) > self.max_entradas:
            mas_antigua = min(self._entradas, key=lambda k: self._entradas[k]['creado'])
            del self._entradas[mas_antigua]
            self._expulsiones += 1

    # -------------------------------------------------------- invalidación

    def invalidar(self, *grupos):
        """
        Invalida uno o varios grupos.
        Basta con subir su generación: las claves viejas dejan de existir
        para el futuro y las entradas huérfanas se descartan por sí solas.
        """
        with self._lock:
            for grupo in grupos:
                self._generaciones[grupo] = self._generaciones.get(grupo, 0) + 1
            self._invalidaciones += len(grupos)

    def limpiar(self):
        """Vacía la caché por completo."""
        with self._lock:
            self._entradas.clear()
            for grupo in list(self._generaciones):
                self._generaciones[grupo] += 1
            self._invalidaciones += 1

    # ---------------------------------------------------------- métricas

    def estadisticas(self):
        with self._lock:
            total = self._hits + self._fallos
            return {
                'entradas': len(self._entradas),
                'max_entradas': self.max_entradas,
                'ttl_segundos': self.ttl,
                'aciertos': self._hits,
                'fallos': self._fallos,
                'tasa_aciertos': round(self._hits / total * 100, 1) if total else 0.0,
                'invalidaciones': self._invalidaciones,
                'expulsiones': self._expulsiones,
                'respuestas_304': self._aciertos_304,
                'generaciones': dict(self._generaciones),
            }

    def registrar_304(self):
        with self._lock:
            self._aciertos_304 += 1
