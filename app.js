// REEMPLAZA CON TU URL REAL DE GOOGLE APPS SCRIPT (Web App desplegada como "Cualquiera")
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzmruzHnwsBTUQosKgAGLZbwX39cd1Q-jRBIF-66HK_EYvoZt1UUG8fLlJNOnQqUC5lAA/exec';

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
});

async function initApp() {
  registerServiceWorker();
  updateOnlineStatus();
  
  // 1. Cargar lo que esté guardado localmente en IndexedDB
  await loadDropdowns();
  await refreshRecordsList();
  
  // 2. Intentar actualizar con los datos más recientes de Google Sheets
  if (navigator.onLine) {
    await syncMasterData();
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .catch(err => console.error('Error al registrar SW:', err));
  }
}

// Interfaz y Navegación
function setupEventListeners() {
  window.addEventListener('online', () => {
    updateOnlineStatus();
    syncMasterData();
  });
  window.addEventListener('offline', updateOnlineStatus);

  // Navegación Tabs
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      
      const target = e.currentTarget;
      target.classList.add('active');
      document.getElementById(target.dataset.view).classList.add('active');
    });
  });

  // Autocompletado de Ruta según Placa elegida
  const placaSelect = document.getElementById('placa');
  placaSelect.addEventListener('change', async (e) => {
    const val = e.target.value;
    if (val) {
      const ruta = await DB.getRutaByPlaca(val);
      document.getElementById('ruta').value = ruta || '';
    } else {
      document.getElementById('ruta').value = '';
    }
  });

  // Búsqueda en tiempo real por DNI
  const dniInput = document.getElementById('dni');
  dniInput.addEventListener('input', async (e) => {
    const dni = e.target.value.trim();
    const alertEl = document.getElementById('dni-alert');
    const nombreEl = document.getElementById('nombre');

    if (dni.length === 8) {
      alertEl.textContent = 'Buscando...';
      const persona = await DB.getPersonalByDNI(dni);
      if (persona && persona.nombre) {
        nombreEl.value = persona.nombre;
        alertEl.textContent = '';
      } else {
        nombreEl.value = '';
        alertEl.textContent = 'DNI no encontrado en el padrón local.';
      }
    } else {
      nombreEl.value = '';
      alertEl.textContent = '';
    }
  });

  // Lógica condicional: Motivo -> Observaciones
  const motivoSelect = document.getElementById('motivo');
  const obsGroup = document.getElementById('group-observaciones');
  const obsInput = document.getElementById('observaciones');
  const motivosObligatorios = ['Transporte', 'Otro trabajo', 'Renuncia', 'Problemas con el caporal', 'No desea continuar'];

  motivoSelect.addEventListener('change', (e) => {
    if (motivosObligatorios.includes(e.target.value)) {
      obsGroup.style.display = 'block';
      obsInput.required = true;
    } else {
      obsGroup.style.display = 'block';
      obsInput.required = false;
    }
  });

  // Lógica condicional: ¿Vas a regresar? -> Ocultar/Mostrar Retorno
  const vasARegresarSelect = document.getElementById('vasARegresar');
  const retornoGroup = document.getElementById('group-retorno');
  const retornoSelect = document.getElementById('tipoRetorno');
  const retornoFechaGroup = document.getElementById('group-fechaRetorno');

  function toggleRetornoVisibility() {
    const valor = vasARegresarSelect.value;
    if (valor === 'NO') {
      retornoGroup.style.display = 'none';
      retornoFechaGroup.style.display = 'none';
    } else {
      retornoGroup.style.display = 'block';
      retornoFechaGroup.style.display = retornoSelect.value === 'Específica' ? 'block' : 'none';
    }
  }

  vasARegresarSelect.addEventListener('change', toggleRetornoVisibility);

  retornoSelect.addEventListener('change', (e) => {
    if (vasARegresarSelect.value !== 'NO') {
      retornoFechaGroup.style.display = e.target.value === 'Específica' ? 'block' : 'none';
    }
  });

  toggleRetornoVisibility();

  // Envío del formulario
  document.getElementById('ausentismo-form').addEventListener('submit', handleFormSubmit);

  // Sincronización Manual
  document.getElementById('btn-sync').addEventListener('click', async () => {
    await syncMasterData();
    await triggerSync();
  });
}

// Estado de conexión
function updateOnlineStatus() {
  const banner = document.getElementById('network-banner');
  if (navigator.onLine) {
    banner.textContent = 'En línea - Listo para sincronizar';
    banner.className = 'online';
  } else {
    banner.textContent = 'Modo Offline - Datos guardados localmente';
    banner.className = 'offline';
  }
}

// Cargar las opciones del Selector de Placas
async function loadDropdowns() {
  const placas = await DB.getAllPlacas();
  const select = document.getElementById('placa');
  
  const selectedValue = select.value;
  select.innerHTML = '<option value="">Seleccione Placa...</option>';
  
  if (placas && placas.length > 0) {
    placas.forEach(p => {
      if (p) {
        const option = document.createElement('option');
        option.value = p;
        option.textContent = p;
        select.appendChild(option);
      }
    });
    if (selectedValue) select.value = selectedValue;
  }
  
  // Establecer fecha actual por defecto
  const fechaFaltaInput = document.getElementById('fechaFalta');
  if (!fechaFaltaInput.value) {
    fechaFaltaInput.value = new Date().toISOString().split('T')[0];
  }
}

// Guardar registro local
async function handleFormSubmit(e) {
  e.preventDefault();

  const id = 'REG-' + crypto.randomUUID();
  const vasARegresar = document.getElementById('vasARegresar').value;
  const tipoRetorno = document.getElementById('tipoRetorno').value;
  const fechaRetornoVal = document.getElementById('fechaRetorno').value;

  let fechaRetornoFinal = '';
  if (vasARegresar !== 'NO') {
    fechaRetornoFinal = tipoRetorno === 'Inmediato' ? 'Inmediato' : fechaRetornoVal;
  } else {
    fechaRetornoFinal = 'No aplica';
  }

  const record = {
    id: id,
    fechaRegistro: new Date().toISOString(),
    placa: document.getElementById('placa').value,
    ruta: document.getElementById('ruta').value,
    dni: document.getElementById('dni').value,
    nombre: document.getElementById('nombre').value,
    fechaFalta: document.getElementById('fechaFalta').value,
    motivo: document.getElementById('motivo').value,
    observaciones: document.getElementById('observaciones').value,
    vasARegresar: vasARegresar,
    fechaRetorno: fechaRetornoFinal,
    estado: 'PENDIENTE',
    errorDetail: ''
  };

  await DB.saveAusentismo(record);
  alert('Registro guardado localmente exitosamente.');
  e.target.reset();
  await loadDropdowns();
  
  document.getElementById('vasARegresar').dispatchEvent(new Event('change'));
  await refreshRecordsList();

  if (navigator.onLine) triggerSync();
}

// Sincronizar registros pendientes hacia Google Sheets
async function triggerSync() {
  if (!navigator.onLine) return;
  if (GAS_ENDPOINT.includes('TU_SCRIPT_ID_AQUI')) return;

  const banner = document.getElementById('network-banner');
  banner.textContent = 'Sincronizando registros...';
  banner.className = 'syncing';

  const pending = await DB.getPendingRecords();

  if (pending.length > 0) {
    try {
      const response = await fetch(GAS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'SYNC_AUSENTISMOS', records: pending })
      });
      
      const res = await response.json();
      if (res.status === 'SUCCESS') {
        for (const item of pending) {
          await DB.updateRecordStatus(item.id, 'SINCRONIZADO');
        }
      }
    } catch (err) {
      console.error('Error al sincronizar pendientes:', err);
    }
  }

  banner.textContent = 'En línea - Sincronizado';
  banner.className = 'online';
  await refreshRecordsList();
}

// Obtener Tablas Maestras (Placas y Personal) desde Google Sheets
async function syncMasterData() {
  if (!navigator.onLine || GAS_ENDPOINT.includes('TU_SCRIPT_ID_AQUI')) return;
  
  try {
    const res = await fetch(`${GAS_ENDPOINT}?action=GET_MASTERS`);
    const data = await res.json();
    
    if (data.maestros && Array.isArray(data.maestros)) {
      await DB.setMaestros(data.maestros);
    }
    if (data.personal && Array.isArray(data.personal)) {
      await DB.setPersonal(data.personal);
    }
    
    // Recargar el desplegable de placas una vez sincronizado
    await loadDropdowns();
  } catch (err) {
    console.warn('Error al obtener datos maestros de Google Sheets:', err);
  }
}

// Actualizar lista en pantalla
async function refreshRecordsList() {
  const records = await DB.getAllRecords();
  const container = document.getElementById('records-list');
  container.innerHTML = '';

  if (records.length === 0) {
    container.innerHTML = '<p style="text-align:center; color: #757575;">No hay registros locales.</p>';
    return;
  }

  records.forEach(r => {
    container.innerHTML += `
      <div class="record-item">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <strong>${r.nombre || 'DNI: ' + r.dni}</strong>
          <span class="badge ${r.estado}">${r.estado}</span>
        </div>
        <div style="font-size:0.85rem; color: var(--text-secondary);">
          Placa: ${r.placa} | Motivo: ${r.motivo}<br>
          Falta: ${r.fechaFalta}
        </div>
      </div>
    `;
  });
}
