/* =============================================================
   Rodando UTP - Mapa inteligente por zonas (IA SIMULADA)
   -------------------------------------------------------------
   IMPORTANTE: este modulo es una SIMULACION. No consume ninguna
   API de inteligencia artificial. Las sugerencias llegan calculadas
   por el motor determinista de ia_simulada.py, que pondera cercania,
   horario, reputacion y disponibilidad sobre un grafo de zonas.
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

/* ----------------------------------------------------------- utilerias */

const escapar = (valor) => String(valor ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

/* ------------------------------------------------------------- pintado */

function pintarMapa() {
  if (!mapaZonas) return;
  // ViewBox ajustado al area ocupada por las zonas: hace que el mapa y sus
  // etiquetas se vean legibles tambien en pantallas pequenas.
  const viewBox = '150 20 690 680';

  mapaZonas.innerHTML = datosMapa.zonas.map((zona) => {
    const x = zona.mapa_x;
    const y = zona.mapa_y;
    const esOrigen = zona.destacado;
    const esUtp = zona.nombre === 'UTP';
    const clases = ['zone', esOrigen && 'zone-origen', esUtp && 'zone-utp',
      zona.estadisticas.rutas ? 'zone-activa' : 'zone-vacia'].filter(Boolean).join(' ');
    const radio = esUtp ? 30 : esOrigen ? 28 : 24;

    return `
      <g class="${clases}" data-zona="${escapar(zona.nombre)}" transform="translate(${x},${y})" tabindex="0" role="button"
         aria-label="Zona ${escapar(zona.nombre)}: ${zona.estadisticas.rutas} rutas disponibles">
        <circle class="zone-halo" r="${esOrigen ? 64 : 48}"></circle>
        <circle class="zone-dot" r="${radio}"></circle>
        <text class="zone-label" y="7" text-anchor="middle">${escapar(zona.nombre)}</text>
        <text class="zone-count" y="${radio + 26}" text-anchor="middle">${zona.estadisticas.rutas || 0} rutas</text>
      </g>`;
  }).join('');

  mapaConexiones.innerHTML = datosMapa.conexiones.map((c) => {
    const a = datosMapa.zonas.find(z => z.nombre === c.de);
    const b = datosMapa.zonas.find(z => z.nombre === c.a);
    if (!a || !b) return '';
    const activa = c.minutos <= 15 ? 'edge-fast' : 'edge-slow';
    return `<line class="edge ${activa}" x1="${a.mapa_x}" y1="${a.mapa_y}" x2="${b.mapa_x}" y2="${b.mapa_y}">
              <title>${escapar(c.de)} ↔ ${escapar(c.a)} · ${c.minutos} min</title>
            </line>`;
  }).join('');

  mapaBox?.setAttribute('viewBox', viewBox);

  mapaZonas.querySelectorAll('.zone').forEach((nodo) => {
    const activar = () => {
      const nombre = nodo.dataset.zona;
      zonaSelect.value = nombre;
      pedirSugerencias();
    };
    nodo.addEventListener('click', activar);
    nodo.addEventListener('keydown', (evento) => {
      if (evento.key === 'Enter' || evento.key === ' ') { evento.preventDefault(); activar(); }
    });
  });
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
            <span class="avatar">${escapar(s.conductor.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase())}</span>
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

  await pedirSugerencias();
}
