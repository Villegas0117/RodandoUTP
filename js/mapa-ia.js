/* =============================================================
   Rodando UTP - Mapa inteligente por zonas (IA SIMULADA)
   -------------------------------------------------------------
   IMPORTANTE: este modulo es una SIMULACION. No consume ninguna
   API de inteligencia artificial. Las sugerencias llegan calculadas
   por el motor determinista de ia_simulada.py, que pondera cercania,
   horario, reputacion y disponibilidad sobre un grafo de zonas.

   El mapa usa Leaflet con mosaicos de OpenStreetMap (codigo abierto,
   sin clave de API). Las zonas se colocan con sus coordenadas WGS84
   reales y las aristas del grafo se dibujan sobre el territorio.
   ============================================================= */

const mapaBox = document.querySelector('#mapaBox');
const mapaZonas = document.querySelector('#mapaZonas');
const mapaConexiones = document.querySelector('#mapaConexiones');
const sugerenciasBox = document.querySelector('#sugerenciasBox');
const zonaSelect = document.querySelector('#iaZona');
const turnoSelect = document.querySelector('#iaTurno');
const iaResumen = document.querySelector('#iaResumen');
const iaAviso = document.querySelector('#iaAviso');

let datosMapa = { zonas: [], conexiones: [], sugerencias: [] };
let usuarioActual = null;
let zonasCargadas = false;
let mapaLeaflet = null;
let capaZonas = null;
let capaConexiones = null;
const marcadores = new Map();

/* ----------------------------------------------------------- utilerias */

const escapar = (valor) => String(valor ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const iniciales = (nombre) => String(nombre).split(' ').map(p => p[0])
  .join('').slice(0, 2).toUpperCase();

/* ------------------------------------------------------------- Leaflet */

// Proveedores de mosaicos. OSM es el principal (codigo abierto, sin clave);
// CartoDB es el respaldo automatico si OSM bloquea la peticion.
const PROVEEDORES = {
  osm: {
    nombre: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdominios: '',
    atribucion: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  carto: {
    nombre: 'CartoDB (respaldo)',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdominios: 'abcd',
    atribucion: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
};

let proveedorActual = 'osm';
let capaMosaicos = null;
let bloqueosDetectados = 0;

/**
 * Crea el mapa de Leaflet con los mosaicos de OpenStreetMap.
 * OpenStreetMap es la alternativa libre y abierta: no necesita clave
 * de API ni cuenta, a diferencia de los mapas proprietary.
 */
function crearMapa() {
  if (mapaLeaflet || !mapaBox || typeof L === 'undefined') return mapaLeaflet;

  mapaLeaflet = L.map(mapaBox, {
    center: [19.0450, -98.2900],
    zoom: 12,
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: false,   // evita que el scroll de la pagina mueva el mapa
    tap: true,
  });

  aplicarProveedor('osm');

  // El zoom con la rueda se activa solo al hacer clic en el mapa.
  mapaLeaflet.on('click', () => mapaLeaflet.scrollWheelZoom.enable());
  mapaLeaflet.on('mouseout', () => mapaLeaflet.scrollWheelZoom.disable());

  capaConexiones = L.layerGroup().addTo(mapaLeaflet);
  capaZonas = L.layerGroup().addTo(mapaLeaflet);

  return mapaLeaflet;
}

/** Cambia la capa de mosaicos al proveedor indicado. */
function aplicarProveedor(clave) {
  if (!mapaLeaflet) return;
  const proveedor = PROVEEDORES[clave];
  if (!proveedor) return;

  if (capaMosaicos) mapaLeaflet.removeLayer(capaMosaicos);

  capaMosaicos = L.tileLayer(proveedor.url, {
    maxZoom: 19,
    subdomains: proveedor.subdominios || 'abc',
    attribution: proveedor.atribucion,
  });

  // OSM responde 403 con un mosaico de "Access blocked" cuando su politica
  // de uso se activa. Se detectan esos errores y se cambia al respaldo.
  capaMosaicos.on('tileerror', (evento) => {
    const codigo = evento.error && evento.error.status;
    bloqueosDetectados += 1;
    if (proveedorActual === 'osm' && bloqueosDetectados >= 3) {
      cambiarProveedorAutomatico();
    } else if (codigo === 403) {
      avisarMosaicos('El servidor de mapas rechazó la petición (HTTP 403).');
    }
  });

  capaMosaicos.addTo(mapaLeaflet);
  proveedorActual = clave;

  // El filtro de tema oscuro solo se aplica a los mosaicos claros de OSM.
  // CartoDB dark ya viene en oscuro: invertirlo lo dejaria ilegible.
  if (mapaBox) mapaBox.classList.toggle('mapa-fondo-natural', clave === 'carto');

  actualizarSelectorProveedor();
}

/** Cambia al proveedor de respaldo y lo avisa. */
function cambiarProveedorAutomatico() {
  if (proveedorActual === 'carto') return;
  aplicarProveedor('carto');
  avisarMosaicos(
    'OpenStreetMap bloqueó temporalmente las peticiones (política de uso). ' +
    'Se cambió al fondo alternativo automáticamente; el mapa sigue funcionando.',
    true
  );
}

/** Muestra el aviso sobre el estado de los mosaicos. */
function avisarMosaicos(mensaje, esAviso = false) {
  const caja = document.querySelector('#mapaOffline');
  if (!caja) return;
  caja.textContent = mensaje;
  caja.hidden = false;
  caja.classList.toggle('es-aviso', esAviso);
}

/** Refleja el proveedor activo en el selector de la interfaz. */
function actualizarSelectorProveedor() {
  const selector = document.querySelector('#mapaProveedor');
  if (selector) selector.value = proveedorActual;
}

/** Dibuja las aristas del grafo de zonas sobre el mapa. */
function pintarConexiones() {
  if (!mapaLeaflet) return;
  capaConexiones.clearLayers();

  datosMapa.conexiones.forEach((c) => {
    const a = datosMapa.zonas.find(z => z.nombre === c.de);
    const b = datosMapa.zonas.find(z => z.nombre === c.a);
    if (!a || !b) return;

    const rapida = c.minutos <= 15;
    const linea = L.polyline(
      [[a.lat, a.lng], [b.lat, b.lng]],
      {
        color: rapida ? '#45e58d' : '#9dc4b4',
        weight: rapida ? 3.5 : 2.5,
        opacity: rapida ? 0.95 : 0.6,
        dashArray: rapida ? '8 6' : '4 8',
        lineCap: 'round',
      }
    ).addTo(capaConexiones);

    const km = c.km != null ? ` · ${c.km} km` : '';
    linea.bindTooltip(
      `<strong>${escapar(c.de)} ↔ ${escapar(c.a)}</strong><br>${c.minutos} min estimados${km}`,
      { sticky: true, direction: 'top' }
    );
  });
}

/** Coloca los marcadores de cada zona. */
function pintarZonas() {
  if (!mapaLeaflet) return;
  capaZonas.clearLayers();
  marcadores.clear();

  datosMapa.zonas.forEach((zona) => {
    const esOrigen = zona.destacado;
    const esUtp = zona.nombre === 'UTP';
    const conRutas = (zona.estadisticas?.rutas || 0) > 0;

    let color = '#2f6b52';
    let peso = 2;
    if (esUtp) { color = '#b4ff66'; peso = 4; }
    else if (esOrigen) { color = '#45e58d'; peso = 4; }
    else if (!conRutas) { color = '#3a4f46'; peso = 1.5; }

    const circulo = L.circleMarker([zona.lat, zona.lng], {
      radius: esUtp || esOrigen ? 15 : 11,
      color: color,
      weight: peso,
      opacity: 0.95,
      fillColor: color,
      fillOpacity: esUtp || esOrigen ? 0.32 : 0.18,
      className: esOrigen ? 'zona-origen' : (esUtp ? 'zona-utp' : ''),
    }).addTo(capaZonas);

    const e = zona.estadisticas || {};
    const titulo = esUtp ? 'Universidad Tecnológica de Puebla'
      : (esOrigen ? `Zona ${zona.nombre} (tu zona)` : zona.nombre);
    const mejor = zona.mejores?.[0];
    const conductores = e.conductores || 0;

    circulo.bindPopup(`
      <div class="zona-popup">
        <strong>${escapar(titulo)}</strong>
        <div class="popup-stats">
          <span><b>${e.rutas || 0}</b> ${e.rutas === 1 ? 'ruta' : 'rutas'}</span>
          <span><b>${e.lugares || 0}</b> lugares</span>
          <span><b>$${e.promedio || 0}</b> prom.</span>
        </div>
        ${mejor ? `<div class="popup-best">★ Mejor opción: ${escapar(mejor.conductor)} (${mejor.confianza}%)</div>` : ''}
        <div class="popup-hint">${conductores} ${conductores === 1 ? 'conductor' : 'conductores'} en esta zona</div>
      </div>`);

    circulo.bindTooltip(`${escapar(zona.nombre)} · ${e.rutas || 0} rutas`, {
      direction: 'top', offset: [0, -6],
    });

    circulo.on('click', () => {
      zonaSelect.value = zona.nombre;
      pedirSugerencias();
    });

    marcadores.set(zona.nombre, circulo);
  });
}

/* ------------------------------------------------------------ pintado */

function pintarMapa() {
  if (!mapaLeaflet) crearMapa();
  if (!mapaLeaflet) return;

  pintarConexiones();
  pintarZonas();

  // Ajusta el encuadre a las zonas con rutas, dejando la UTP a la vista.
  const conActividad = datosMapa.zonas.filter(z => (z.estadisticas?.rutas || 0) > 0);
  if (conActividad.length) {
    const limites = L.latLngBounds(conActividad.map(z => [z.lat, z.lng]));
    limites.extend([19.0490, -98.3420]);
    mapaLeaflet.fitBounds(limites.pad(0.18), { animate: false });
  }
}

function pintarSugerencias(lista, zona) {
  if (!sugerenciasBox) return;

  if (!lista?.length) {
    sugerenciasBox.innerHTML = `<div class="empty-state"><strong>Sin conductores disponibles en esa zona.</strong><br>Prueba con otra zona del mapa o revisa las rutas totales.</div>`;
    return;
  }

  sugerenciasBox.innerHTML = lista.map((s, indice) => {
    const barra = Math.min(100, Math.round(s.puntaje));
    const chips = Object.entries(s.componentes)
      .map(([clave, valor]) => `<span class="comp"><em>${escapar(clave)}</em>${valor}</span>`)
      .join('');

    return `
      <article class="sugerencia${indice === 0 ? ' sugerencia-top' : ''}">
        <div class="sug-head">
          <div class="driver">
            <span class="avatar">${escapar(iniciales(s.conductor))}</span>
            <div>
              <strong>${indice === 0 ? '★ ' : ''}${escapar(s.conductor)}</strong>
              <small>${s.verificado ? '✓ Verificado' : 'Estudiante'} · ${escapar(s.origen)}</small>
            </div>
          </div>
          <div class="confianza">
            <strong>${s.confianza}%</strong>
            <small>confianza</small>
          </div>
        </div>

        <div class="sug-metrics">
          <div><small>Salida</small><strong>${escapar(s.salida)}</strong></div>
          <div><small>Llegada est.</small><strong>${escapar(s.hora_llegada_estimada)}</strong></div>
          <div><small>Trayecto</small><strong>${s.minutos_estimados} min</strong></div>
          <div><small>Aportación</small><strong>$${s.aportacion}</strong></div>
        </div>

        <div class="score-bar" title="Puntaje ${s.puntaje} de 100">
          <div class="score-fill" style="width:${barra}%"></div>
          <span>${s.puntaje}/100</span>
        </div>

        <ul class="razones">
          ${s.razones.map(r => `<li>${escapar(r)}</li>`).join('')}
        </ul>

        <div class="sug-foot">
          <div class="chips">${chips}</div>
          <button class="btn btn-primary reserve-btn" data-ai-reserve="${s.ruta_id}">Reservar lugar</button>
        </div>
      </article>`;
  }).join('');

  sugerenciasBox.querySelectorAll('[data-ai-reserve]').forEach((boton) => {
    boton.addEventListener('click', async () => {
      const idRuta = boton.dataset.aiReserve;
      boton.disabled = true;
      boton.textContent = 'Reservando…';
      try {
        const respuesta = await api('/reservas', { method: 'POST', cuerpo: { id: Number(idRuta) } });
        notificar(respuesta.mensaje || 'Lugar reservado.');
        pedirSugerencias();
      } catch (error) {
        notificar(error.message);
        boton.disabled = false;
        boton.textContent = 'Reservar lugar';
      }
    });
  });

  if (iaResumen) {
    iaResumen.innerHTML = `
      <div><strong>${lista.length}</strong><span>sugerencias</span></div>
      <div><strong>${escapar(zona || 'todas')}</strong><span>zona consultada</span></div>
      <div><strong>${lista[0]?.confianza || 0}%</strong><span>mejor confianza</span></div>
      <div><strong>${lista.reduce((t, s) => t + s.minutos_estimados, 0)} min</strong><span>suma de trayectos</span></div>`;
  }

  // Resalta en el mapa la zona de la sugerencia principal.
  if (mapaLeaflet && lista[0]) {
    const mejor = marcadores.get(lista[0].origen);
    if (mejor) mejor.setStyle({ weight: 5, fillOpacity: 0.45 });
  }
}

/* --------------------------------------------------------- peticiones */

async function pedirSugerencias() {
  const zona = zonaSelect?.value || '';
  const turno = turnoSelect?.value || '';

  if (sugerenciasBox) sugerenciasBox.innerHTML = '<p class="ia-loading">Analizando zonas cercanas…</p>';

  try {
    const datos = await api(`/ia/mapa?zona=${encodeURIComponent(zona)}&turno=${encodeURIComponent(turno)}`);
    datosMapa = datos;
    pintarMapa();
    pintarSugerencias(datos.sugerencias || [], datos.origen);
    if (iaAviso) {
      iaAviso.textContent = datos.aviso ||
        'Motor simulado: heurística sobre grafo de zonas, sin llamada a servicios de IA.';
    }
  } catch (error) {
    if (sugerenciasBox) {
      sugerenciasBox.innerHTML = `<div class="empty-state"><strong>${escapar(error.message)}</strong><br>Inicia sesión para usar el mapa inteligente.</div>`;
    }
  }
}

/** Las sugerencias del mapa exigen sesión: se pide al cargar. */
async function iniciarMapa() {
  const sesion = await obtenerSesion();
  if (!sesion.autenticado) return;

  usuarioActual = sesion.usuario;

  // Carga las zonas como opciones del selector. El select ya trae una opción
  // placeholder, así que se usa una bandera en lugar de contar las opciones.
  if (zonaSelect && !zonasCargadas) {
    try {
      const datos = await api('/zonas');
      datos.zonas
        .filter(z => z.nombre !== 'UTP')
        .forEach((z) => {
          const opcion = document.createElement('option');
          opcion.value = z.nombre;
          opcion.textContent = z.nombre;
          zonaSelect.appendChild(opcion);
        });
      zonasCargadas = true;
    } catch { /* el mapa queda vacio si falla */ }
  }

  // Se precarga la zona del usuario para que las sugerencias salgan de inmediato.
  if (zonaSelect && usuarioActual.zona) zonaSelect.value = usuarioActual.zona;

  zonaSelect?.addEventListener('change', pedirSugerencias);
  turnoSelect?.addEventListener('change', pedirSugerencias);

  // Selector manual del fondo del mapa, por si el servidor principal falla.
  document.querySelector('#mapaProveedor')?.addEventListener('change', (evento) => {
    aplicarProveedor(evento.target.value);
    avisarMosaicos(
      evento.target.value === 'carto'
        ? 'Fondo alternativo activo (CartoDB). Los datos siguen siendo de OpenStreetMap.'
        : 'Fondo OpenStreetMap activo.',
      true
    );
  });

  // Leaflet se carga con 'defer': puede no estar listo todavia.
  if (typeof L !== 'undefined') {
    crearMapa();
  } else {
    window.addEventListener('load', crearMapa, { once: true });
  }

  await pedirSugerencias();
}
