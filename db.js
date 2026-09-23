// Inicialización del almacén IndexedDB usando Dexie.js
const db = new Dexie('HuarmeyDB');

db.version(1).stores({
  maestros: 'placa',
  personal: 'dni',
  ausentismos: 'id, estado, fechaRegistro'
});

const DB = {
  // Configuración inicial de datos remotos a caché local
  async setMaestros(data) {
    await db.maestros.clear();
    await db.maestros.bulkPut(data);
  },

  async getRutaByPlaca(placa) {
    const record = await db.maestros.get(placa);
    return record ? record.ruta : '';
  },

  async getAllPlacas() {
    const list = await db.maestros.toArray();
    return list.map(item => item.placa);
  },

  async setPersonal(data) {
    await db.personal.clear();
    await db.personal.bulkPut(data);
  },

  async getPersonalByDNI(dni) {
    return await db.personal.get(dni);
  },

  // Gestión de Ausentismos
  async saveAusentismo(record) {
    return await db.ausentismos.put(record);
  },

  async getPendingRecords() {
    return await db.ausentismos.where('estado').equals('PENDIENTE').toArray();
  },

  async getAllRecords() {
    return await db.ausentismos.orderBy('fechaRegistro').reverse().toArray();
  },

  async updateRecordStatus(id, estado, errorDetail = '') {
    await db.ausentismos.update(id, { estado, errorDetail });
  }
};