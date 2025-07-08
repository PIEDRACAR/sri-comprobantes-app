
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

// Middleware
app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Base de datos en memoria
const db = new sqlite3.Database(':memory:');

db.serialize(() => {
    db.run(`CREATE TABLE comprobantes (
        id TEXT PRIMARY KEY,
        tipo TEXT,
        numero TEXT,
        ruc TEXT,
        razon_social TEXT,
        fecha TEXT,
        monto REAL
    )`);
});

// Procesar XML, CSV, TXT
const storage = multer({ dest: 'uploads/' });
app.post('/api/upload', storage.array('files'), async (req, res) => {
    try {
        for (const file of req.files) {
            const ext = path.extname(file.originalname).toLowerCase();
            if (ext === '.xml') await procesarXML(file.path);
            else if (ext === '.csv') await procesarCSV(file.path);
            else if (ext === '.txt') await procesarTXT(file.path);
        }
        res.json({ status: 'ok' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error procesando archivos' });
    }
});

function insertarComprobante(data) {
    const stmt = db.prepare(`INSERT INTO comprobantes VALUES (?, ?, ?, ?, ?, ?, ?)`);
    stmt.run([
        uuidv4(),
        data.tipo,
        data.numero,
        data.ruc,
        data.razon_social,
        data.fecha,
        data.monto
    ]);
    stmt.finalize();
}

function procesarXML(filePath) {
    return new Promise((resolve, reject) => {
        const parser = new xml2js.Parser({ explicitArray: false });
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) return reject(err);
            parser.parseString(data, (err, result) => {
                if (err) return reject(err);
                try {
                    const comprobante = result.comprobante || result;
                    const info = {
                        tipo: comprobante.tipo || 'factura',
                        numero: comprobante.numero || '001-001-000000001',
                        ruc: comprobante.ruc || '9999999999999',
                        razon_social: comprobante.razonSocial || 'Desconocido',
                        fecha: comprobante.fecha || new Date().toISOString().slice(0,10),
                        monto: parseFloat(comprobante.total || 0)
                    };
                    insertarComprobante(info);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    });
}

function procesarCSV(filePath) {
    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                insertarComprobante({
                    tipo: row.tipo,
                    numero: row.numero,
                    ruc: row.ruc,
                    razon_social: row.razon_social,
                    fecha: row.fecha,
                    monto: parseFloat(row.monto)
                });
            })
            .on('end', resolve)
            .on('error', reject);
    });
}

function procesarTXT(filePath) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, content) => {
            if (err) return reject(err);
            const lines = content.split('\n');
            for (const line of lines) {
                const [tipo, numero, ruc, razon_social, fecha, monto] = line.split(',');
                insertarComprobante({ tipo, numero, ruc, razon_social, fecha, monto: parseFloat(monto) });
            }
            resolve();
        });
    });
}

app.get('/api/comprobantes', (req, res) => {
    db.all('SELECT * FROM comprobantes', [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'Error al consultar DB' });
        res.json(rows);
    });
});

// Exportar a Excel
app.get('/api/export/excel', async (req, res) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Comprobantes');

    sheet.columns = [
        { header: 'Tipo', key: 'tipo' },
        { header: 'Número', key: 'numero' },
        { header: 'RUC', key: 'ruc' },
        { header: 'Razón Social', key: 'razon_social' },
        { header: 'Fecha', key: 'fecha' },
        { header: 'Monto', key: 'monto' },
    ];

    db.all('SELECT * FROM comprobantes', [], async (err, rows) => {
        if (err) return res.status(500).send('Error al generar Excel');
        sheet.addRows(rows);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=comprobantes.xlsx');
        await workbook.xlsx.write(res);
        res.end();
    });
});

// Exportar a PDF
app.get('/api/export/pdf', async (req, res) => {
    db.all('SELECT * FROM comprobantes', [], async (err, rows) => {
        if (err) return res.status(500).send('Error al generar PDF');

        let html = \`
        <html><head><style>
        body { font-family: Arial; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 8px; border: 1px solid #ccc; }
        </style></head><body>
        <h2>Reporte de Comprobantes</h2>
        <table><tr><th>Tipo</th><th>Número</th><th>RUC</th><th>Razón Social</th><th>Fecha</th><th>Monto</th></tr>\`;

        for (const row of rows) {
            html += \`<tr><td>\${row.tipo}</td><td>\${row.numero}</td><td>\${row.ruc}</td><td>\${row.razon_social}</td><td>\${row.fecha}</td><td>\${row.monto}</td></tr>\`;
        }

        html += \`</table></body></html>\`;

        const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        await page.setContent(html);
        const pdf = await page.pdf({ format: 'A4' });
        await browser.close();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=comprobantes.pdf');
        res.send(pdf);
    });
});

app.listen(PORT, () => {
    console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
