const SPREADSHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

function doGet(e) {
  const action = e.parameter.action;
  
  if (action === 'GET_MASTERS') {
    return buildJsonResponse({
      maestros: getSheetData('Maestros', ['placa', 'ruta']),
      personal: getSheetData('Personal', ['dni', 'nombre'])
    });
  }
  
  return buildJsonResponse({ error: 'Acción GET no válida' }, 400);
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    if (data.action === 'SYNC_AUSENTISMOS') {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Ausentismos');
      const records = data.records;
      
      records.forEach(r => {
        sheet.appendRow([
          r.fechaRegistro,
          r.placa,
          r.ruta,
          "'" + r.dni, // Preservar ceros a la izquierda
          r.nombre,
          r.fechaFalta,
          r.motivo,
          r.observaciones,
          r.vasARegresar,
          r.fechaRetorno,
          r.id,
          'SINCRONIZADO'
        ]);
      });
      
      return buildJsonResponse({ status: 'SUCCESS', count: records.length });
    }
  } catch (err) {
    return buildJsonResponse({ status: 'ERROR', message: err.toString() }, 500);
  }
}

// Helpers
function getSheetData(sheetName, keys) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  values.shift(); // Remover encabezados
  
  return values.map(row => {
    let obj = {};
    keys.forEach((key, index) => {
      // Forzar conversión a String para preservar ceros en DNI
      obj[key] = row[index] !== undefined ? String(row[index]).trim() : '';
    });
    return obj;
  });
}

function buildJsonResponse(data, statusCode = 200) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}