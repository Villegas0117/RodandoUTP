/* =============================================================
   Rodando UTP - Pagina de acceso (login.html)
   ============================================================= */

const toast = document.querySelector('#toast');
const backendNote = document.querySelector('#backendNote');

const tabLogin = document.querySelector('#tabLogin');
const tabRegister = document.querySelector('#tabRegister');
const loginForm = document.querySelector('#loginForm');
const registerForm = document.querySelector('#registerForm');
const loginError = document.querySelector('#loginError');
const registerError = document.querySelector('#registerError');

function mostrarToast(mensaje) {
  toast.textContent = mensaje;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function mostrarError(elemento, mensaje) {
  elemento.textContent = mensaje;
  elemento.hidden = false;
}

function ocultarError(elemento) {
  elemento.hidden = true;
}

/** Cambia entre las pestanas de acceso y registro. */
function cambiarPestana(panel) {
  const esLogin = panel === 'login';
  tabLogin.classList.toggle('active', esLogin);
  tabRegister.classList.toggle('active', !esLogin);
  tabLogin.setAttribute('aria-selected', String(esLogin));
  tabRegister.setAttribute('aria-selected', String(!esLogin));
  loginForm.hidden = !esLogin;
  registerForm.hidden = esLogin;
  ocultarError(loginError);
  ocultarError(registerError);
}

tabLogin.addEventListener('click', () => cambiarPestana('login'));
tabRegister.addEventListener('click', () => cambiarPestana('registro'));

/** Comprueba que el backend este levantado para avisar al usuario. */
async function revisarBackend() {
  try {
    const respuesta = await fetch('/api/salud');
    if (!respuesta.ok) throw new Error();
    backendNote.textContent = 'Servidor conectado · base de datos SQLite activa';
    backendNote.classList.add('ok');
    backendNote.classList.remove('error');
  } catch {
    backendNote.textContent = 'Sin servidor: ejecuta "python3 server.py" para usar el acceso';
    backendNote.classList.add('error');
  }
}

/** Si ya hay sesion activa, entra directo a la app. */
async function revisarSesionActiva() {
  try {
    const datos = await obtenerSesion();
    if (datos.autenticado && datos.usuario) {
      window.location.replace('index.html');
      return true;
    }
  } catch { /* se queda en la pagina de acceso */ }
  return false;
}

loginForm.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  ocultarError(loginError);

  const boton = loginForm.querySelector('button[type="submit"]');
  boton.disabled = true;
  boton.textContent = 'Entrando…';

  try {
    await api('/login', {
      method: 'POST',
      cuerpo: {
        correo: document.querySelector('#loginCorreo').value.trim(),
        password: document.querySelector('#loginPassword').value,
      },
    });
    mostrarToast('Sesión iniciada correctamente.');
    window.location.href = 'index.html';
  } catch (error) {
    mostrarError(loginError, error.message);
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});

registerForm.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  ocultarError(registerError);

  const boton = registerForm.querySelector('button[type="submit"]');
  boton.disabled = true;
  boton.textContent = 'Creando cuenta…';

  try {
    await api('/registro', {
      method: 'POST',
      cuerpo: {
        nombre: document.querySelector('#regNombre').value.trim(),
        correo: document.querySelector('#regCorreo').value.trim(),
        password: document.querySelector('#regPassword').value,
        zona: document.querySelector('#regZona').value,
        matricula: document.querySelector('#regMatricula').value.trim(),
      },
    });
    mostrarToast('¡Cuenta creada! Bienvenido a Rodando UTP.');
    window.location.href = 'index.html';
  } catch (error) {
    mostrarError(registerError, error.message);
    boton.disabled = false;
    boton.textContent = 'Crear mi cuenta';
  }
});

// Botones de las cuentas de demostracion.
document.querySelectorAll('.demo-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelector('#loginCorreo').value = chip.dataset.correo;
    document.querySelector('#loginPassword').value = chip.dataset.clave;
    cambiarPestana('login');
    document.querySelector('#loginPassword').focus();
  });
});

revisarBackend();
revisarSesionActiva();
