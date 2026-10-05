const db = new Dexie('HuarmeyDB');
db.version(1).stores({
  maestros: 'placa',
  personal: 'dni',
  ausentismos: 'id, estado, fechaRegistro'
});

const normDni = d => {
  const s = String(d == null ? '' : d).replace(/\D/g, '');
  return s && s.length < 8 ? s.padStart(8, '0') : s;
};

const DB = {
  async setMaestros(data) {
    const rows = (data || []).filter(r => r.placa);
    if (!rows.length) return; // nunca vaciar el caché local con datos vacíos
    await db.transaction('rw', db.maestros, async () => { await db.maestros.clear(); await db.maestros.bulkPut(rows); });
  },
  async setPersonal(data) {
    const rows = (data || []).map(r => ({ dni: normDni(r.dni), nombre: r.nombre })).filter(r => r.dni);
    if (!rows.length) return;
    await db.transaction('rw', db.personal, async () => { await db.personal.clear(); await db.personal.bulkPut(rows); });
  },
  async getRutaByPlaca(placa) { const r = await db.maestros.get(placa); return r ? r.ruta : ''; },
  async getAllPlacas() { return (await db.maestros.orderBy('placa').keys()); },
  async getPersonalByDNI(dni) { return db.personal.get(normDni(dni)); },
  async getAllPersonal() { return db.personal.toArray(); },
  async countPersonal() { return db.personal.count(); },

  async saveAusentismo(record) { return db.ausentismos.put(record); },
  async getPendingRecords() { return db.ausentismos.where('estado').equals('PENDIENTE').toArray(); },
  async getAllRecords() { return db.ausentismos.orderBy('fechaRegistro').reverse().limit(300).toArray(); },
  async updateRecordStatus(id, estado, errorDetail = '') { await db.ausentismos.update(id, { estado, errorDetail }); },
  async markSynced(ids) {
    await db.transaction('rw', db.ausentismos, async () => {
      for (const id of ids) await db.ausentismos.update(id, { estado: 'SINCRONIZADO', errorDetail: '' });
    });
  },
  async retryErrors() { await db.ausentismos.where('estado').equals('ERROR').modify({ estado: 'PENDIENTE' }); },
  async counts() {
    const [p, e, s] = await Promise.all(['PENDIENTE', 'ERROR', 'SINCRONIZADO'].map(x => db.ausentismos.where('estado').equals(x).count()));
    return { pendientes: p, errores: e, sincronizados: s };
  }
};
