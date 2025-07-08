const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const xml2js = require('xml2js');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const puppeteer = require('puppeteer');
const cors = require('cors');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configurar multer para subida de archivos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './uploads';
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, uuidv4() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB límite
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xml', '.csv', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos XML, CSV y TXT'));
    }
  }
});

// Configurar base de datos SQLite
const db = new sqlite3.Database(':memory:');

// Crear tabla de comprobantes
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS comprobantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo_comprobante TEXT NOT NULL,
    numero_comprobante TEXT,
    fecha_emision TEXT,
    ruc_emisor TEXT,
    razon_social_emisor TEXT,
    ruc_receptor TEXT,
    razon_social_receptor TEXT,
    subtotal REAL,
    iva REAL,
    total REAL,
    estado TEXT,
    archivo_origen TEXT,
    fecha_procesamiento TEXT,
    datos_adicionales TEXT
  )`);
});

// Funciones para procesar archivos
class SRIProcessor {
  static async processXML(filePath) {
    try {
      const xmlData = fs.readFileSync(filePath, 'utf8');
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(xmlData);
      
      // Detectar tipo de comprobante por estructura XML
      let tipoComprobante = 'factura';
      let datos = {};
      
      if (result.factura) {
        tipoComprobante = 'factura';
        const factura = result.factura;
        datos = {
          numero_comprobante: factura.infoTributaria?.[0]?.secuencial?.[0] || '',
          fecha_emision: factura.infoFactura?.[0]?.fechaEmision?.[0] || '',
          ruc_emisor: factura.infoTributaria?.[0]?.ruc?.[0] || '',
          razon_social_emisor: factura.infoTributaria?.[0]?.razonSocial?.[0] || '',
          ruc_receptor: factura.infoFactura?.[0]?.identificacionComprador?.[0] || '',
          razon_social_receptor: factura.infoFactura?.[0]?.razonSocialComprador?.[0] || '',
          subtotal: parseFloat(factura.infoFactura?.[0]?.totalSinImpuestos?.[0] || 0),
          iva: parseFloat(factura.infoFactura?.[0]?.totalConImpuestos?.[0]?.totalImpuesto?.[0]?.valor?.[0] || 0),
          total: parseFloat(factura.infoFactura?.[0]?.importeTotal?.[0] || 0)
        };
      } else if (result.notaCredito) {
        tipoComprobante = 'nota_credito';
        const nota = result.notaCredito;
        datos = {
          numero_comprobante: nota.infoTributaria?.[0]?.secuencial?.[0] || '',
          fecha_emision: nota.infoNotaCredito?.[0]?.fechaEmision?.[0] || '',
          ruc_emisor: nota.infoTributaria?.[0]?.ruc?.[0] || '',
          razon_social_emisor: nota.infoTributaria?.[0]?.razonSocial?.[0] || '',
          total: parseFloat(nota.infoNotaCredito?.[0]?.valorModificacion?.[0] || 0)
        };
      } else if (result.comprobanteRetencion) {
        tipoComprobante = 'retencion';
        const retencion = result.comprobanteRetencion;
        datos = {
          numero_comprobante: retencion.infoTributaria?.[0]?.secuencial?.[0] || '',
          fecha_emision: retencion.infoCompRetencion?.[0]?.fechaEmision?.[0] || '',
          ruc_emisor: retencion.infoTributaria?.[0]?.ruc?.[0] || '',
          razon_social_emisor: retencion.infoTributaria?.[0]?.razonSocial?.[0] || '',
          total: parseFloat(retencion.infoCompRetencion?.[0]?.valorRetIva?.[0] || 0)
        };
      }
      
      return {
        tipo_comprobante: tipoComprobante,
        ...datos,
        estado: 'procesado',
        datos_adicionales: JSON.stringify(result)
      };
    } catch (error) {
      console.error('Error procesando XML:', error);
      return null;
    }
  }
  
  static async processCSV(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          // Mapear campos comunes del CSV del SRI
          const comprobante = {
            tipo_comprobante: data['TIPO_COMPROBANTE'] || data['Tipo'] || 'factura',
            numero_comprobante: data['NUMERO'] || data['Numero'] || '',
            fecha_emision: data['FECHA_EMISION'] || data['Fecha'] || '',
            ruc_emisor: data['RUC_EMISOR'] || data['RUC'] || '',
            razon_social_emisor: data['RAZON_SOCIAL'] || data['Razon Social'] || '',
            ruc_receptor: data['RUC_RECEPTOR'] || data['RUC Cliente'] || '',
            razon_social_receptor: data['CLIENTE'] || data['Cliente'] || '',
            subtotal: parseFloat(data['SUBTOTAL'] || data['Subtotal'] || 0),
            iva: parseFloat(data['IVA'] || data['Iva'] || 0),
            total: parseFloat(data['TOTAL'] || data['Total'] || 0),
            estado: 'procesado',
            datos_adicionales: JSON.stringify(data)
          };
          results.push(comprobante);
        })
        .on('end', () => {
          resolve(results);
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  }
  
  static async processTXT(filePath) {
    try {
      const txtData = fs.readFileSync(filePath, 'utf8');
      const lines = txtData.split('\n').filter(line => line.trim());
      const results = [];
      
      for (const line of lines) {
        const fields = line.split('|'); // Formato típico del SRI separado por |
        if (fields.length >= 8) {
          const comprobante = {
            tipo_comprobante: fields[0] || 'factura',
            numero_comprobante: fields[1] || '',
            fecha_emision: fields[2] || '',
            ruc_emisor: fields[3] || '',
            razon_social_emisor: fields[4] || '',
            ruc_receptor: fields[5] || '',
            razon_social_receptor: fields[6] || '',
            total: parseFloat(fields[7] || 0),
            subtotal: parseFloat(fields[8] || 0),
            iva: parseFloat(fields[9] || 0),
            estado: 'procesado',
            datos_adicionales: JSON.stringify({ raw_line: line })
          };
          results.push(comprobante);
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error procesando TXT:', error);
      return [];
    }
  }
}

// Rutas de la API
app.post('/api/upload', upload.array('files'), async (req, res) => {
  try {
    const files = req.files;
    const processedData = [];
    
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      let data = null;
      
      if (ext === '.xml') {
        data = await SRIProcessor.processXML(file.path);
        if (data) processedData.push(data);
      } else if (ext === '.csv') {
        data = await SRIProcessor.processCSV(file.path);
        processedData.push(...data);
      } else if (ext === '.txt') {
        data = await SRIProcessor.processTXT(file.path);
        processedData.push(...data);
      }
      
      // Limpiar archivo temporal
      fs.unlinkSync(file.path);
    }
    
    // Guardar en base de datos
    const stmt = db.prepare(`INSERT INTO comprobantes 
      (tipo_comprobante, numero_comprobante, fecha_emision, ruc_emisor, razon_social_emisor, 
       ruc_receptor, razon_social_receptor, subtotal, iva, total, estado, archivo_origen, 
       fecha_procesamiento, datos_adicionales) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    
    for (const item of processedData) {
      stmt.run(
        item.tipo_comprobante,
        item.numero_comprobante,
        item.fecha_emision,
        item.ruc_emisor,
        item.razon_social_emisor,
        item.ruc_receptor,
        item.razon_social_receptor,
        item.subtotal,
        item.iva,
        item.total,
        item.estado,
        'archivo_subido',
        new Date().toISOString(),
        item.datos_adicionales
      );
    }
    stmt.finalize();
    
    res.json({ 
      success: true, 
      message: `${processedData.length} comprobantes procesados exitosamente`,
      data: processedData 
    });
  } catch (error) {
    console.error('Error en upload:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/comprobantes', (req, res) => {
  const { tipo, fechaDesde, fechaHasta, ruc, limit = 1000 } = req.query;
  
  let query = 'SELECT * FROM comprobantes WHERE 1=1';
  const params = [];
  
  if (tipo) {
    query += ' AND tipo_comprobante = ?';
    params.push(tipo);
  }
  
  if (fechaDesde) {
    query += ' AND fecha_emision >= ?';
    params.push(fechaDesde);
  }
  
  if (fechaHasta) {
    query += ' AND fecha_emision <= ?';
    params.push(fechaHasta);
  }
  
  if (ruc) {
    query += ' AND (ruc_emisor = ? OR ruc_receptor = ?)';
    params.push(ruc, ruc);
  }
  
  query += ' ORDER BY fecha_emision DESC LIMIT ?';
  params.push(parseInt(limit));
  
  db.all(query, params, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows);
    }
  });
});

app.get('/api/dashboard', (req, res) => {
  const queries = {
    totales: `SELECT 
      tipo_comprobante, 
      COUNT(*) as cantidad,
      SUM(total) as monto_total,
      AVG(total) as promedio
      FROM comprobantes 
      GROUP BY tipo_comprobante`,
    
    mensuales: `SELECT 
      strftime('%Y-%m', fecha_emision) as mes,
      tipo_comprobante,
      COUNT(*) as cantidad,
      SUM(total) as monto
      FROM comprobantes 
      WHERE fecha_emision != ''
      GROUP BY mes, tipo_comprobante
      ORDER BY mes DESC`,
    
    topProveedores: `SELECT 
      ruc_emisor,
      razon_social_emisor,
      COUNT(*) as cantidad_documentos,
      SUM(total) as monto_total
      FROM comprobantes 
      WHERE ruc_emisor != ''
      GROUP BY ruc_emisor, razon_social_emisor
      ORDER BY monto_total DESC
      LIMIT 10`
  };
  
  const results = {};
  let completed = 0;
  
  Object.keys(queries).forEach(key => {
    db.all(queries[key], [], (err, rows) => {
      if (err) {
        console.error(`Error en query ${key}:`, err);
        results[key] = [];
      } else {
        results[key] = rows;
      }
      
      completed++;
      if (completed === Object.keys(queries).length) {
        res.json(results);
      }
    });
  });
});

app.get('/api/export/excel', async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Comprobantes');
    
    // Definir columnas
    worksheet.columns = [
      { header: 'Tipo', key: 'tipo_comprobante', width: 15 },
      { header: 'Número', key: 'numero_comprobante', width: 20 },
      { header: 'Fecha', key: 'fecha_emision', width: 15 },
      { header: 'RUC Emisor', key: 'ruc_emisor', width: 15 },
      { header: 'Razón Social Emisor', key: 'razon_social_emisor', width: 30 },
      { header: 'RUC Receptor', key: 'ruc_receptor', width: 15 },
      { header: 'Razón Social Receptor', key: 'razon_social_receptor', width: 30 },
      { header: 'Subtotal', key: 'subtotal', width: 12 },
      { header: 'IVA', key: 'iva', width: 12 },
      { header: 'Total', key: 'total', width: 12 }
    ];
    
    // Obtener datos
    db.all('SELECT * FROM comprobantes ORDER BY fecha_emision DESC', [], (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      
      // Agregar datos al worksheet
      rows.forEach(row => {
        worksheet.addRow(row);
      });
      
      // Estilo del header
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' }
      };
      
      // Configurar respuesta
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=comprobantes.xlsx');
      
      workbook.xlsx.write(res).then(() => {
        res.end();
      });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/export/pdf', async (req, res) => {
  try {
    // Generar HTML para PDF
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Reporte de Comprobantes</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          .header { text-align: center; margin-bottom: 30px; }
          .table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          .table th, .table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          .table th { background-color: #f2f2f2; font-weight: bold; }
          .table tr:nth-child(even) { background-color: #f9f9f9; }
          .summary { margin-top: 20px; padding: 10px; background-color: #f0f0f0; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>Reporte de Comprobantes Electrónicos</h1>
          <p>Generado el: ${new Date().toLocaleDateString('es-EC')}</p>
        </div>
        <div id="content"></div>
      </body>
      </html>
    `;
    
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    await page.setContent(htmlContent);
    
    const pdf = await page.pdf({
      format: 'A4',
      margin: {
        top: '20px',
        right: '20px',
        bottom: '20px',
        left: '20px'
      }
    });
    
    await browser.close();
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte_comprobantes.pdf');
    res.send(pdf);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Servir archivos estáticos
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
  console.log(`Accede a la aplicación en: http://localhost:${PORT}`);
});

// Manejo de errores
process.on('uncaughtException', (error) => {
  console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promise rechazada:', reason);
});


// ===================================
// EXPORTACIÓN DE REPORTES (Excel / PDF)
// ===================================

const ExcelJS = require("exceljs");
const puppeteer = require("puppeteer");
const fs = require("fs");

// Endpoint: Exportar a Excel
app.get("/api/export/excel", async (req, res) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Comprobantes");

    worksheet.columns = [
      { header: "Tipo", key: "tipo" },
      { header: "Número", key: "numero" },
      { header: "Fecha", key: "fecha" },
      { header: "RUC Emisor", key: "rucEmisor" },
      { header: "Razón Emisor", key: "razonEmisor" },
      { header: "RUC Receptor", key: "rucReceptor" },
      { header: "Razón Receptor", key: "razonReceptor" },
      { header: "Subtotal", key: "subtotal" },
      { header: "IVA", key: "iva" },
      { header: "Total", key: "total" }
    ];

    for (const c of comprobantes) {
      worksheet.addRow({
        tipo: c.tipo_comprobante,
        numero: c.numero_comprobante,
        fecha: c.fecha_emision,
        rucEmisor: c.ruc_emisor,
        razonEmisor: c.razon_social_emisor,
        rucReceptor: c.ruc_receptor,
        razonReceptor: c.razon_social_receptor,
        subtotal: c.subtotal,
        iva: c.iva,
        total: c.total
      });
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=comprobantes.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error exportando Excel:", err);
    res.status(500).send("Error generando Excel");
  }
});

// Endpoint: Exportar a PDF
app.get("/api/export/pdf", async (req, res) => {
  try {
    const htmlContent = `
      <html>
      <head>
        <style>
          table { width: 100%; border-collapse: collapse; font-family: Arial; font-size: 12px; }
          th, td { border: 1px solid #999; padding: 6px; text-align: left; }
          th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        <h2>Reporte de Comprobantes</h2>
        <table>
          <thead>
            <tr>
              <th>Tipo</th><th>Número</th><th>Fecha</th><th>RUC Emisor</th><th>Razón Emisor</th>
              <th>RUC Receptor</th><th>Razón Receptor</th><th>Subtotal</th><th>IVA</th><th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${comprobantes.map(c => `
              <tr>
                <td>${c.tipo_comprobante}</td><td>${c.numero_comprobante}</td><td>${c.fecha_emision}</td>
                <td>${c.ruc_emisor}</td><td>${c.razon_social_emisor}</td><td>${c.ruc_receptor}</td>
                <td>${c.razon_social_receptor}</td><td>${c.subtotal}</td><td>${c.iva}</td><td>${c.total}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </body>
      </html>
    `;

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({ format: "A4" });
    await browser.close();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=comprobantes.pdf");
    res.send(pdfBuffer);
  } catch (err) {
    console.error("Error exportando PDF:", err);
    res.status(500).send("Error generando PDF");
  }
});
