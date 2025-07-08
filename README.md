# 📄 Procesador de Comprobantes SRI Ecuador

Una aplicación web completa para importar, visualizar y exportar comprobantes electrónicos del SRI Ecuador.  
Permite subir archivos XML, CSV y TXT, procesarlos automáticamente y generar reportes interactivos en Excel y PDF.

---

## 🚀 Características principales

- ✅ **Carga de archivos**: XML, CSV, TXT desde navegador web o móvil
- ✅ **Procesamiento automático**: Identifica y clasifica comprobantes:
  - Facturas
  - Notas de crédito y débito
  - Retenciones
- ✅ **Extracción de datos**: RUC, razón social, fechas, montos, etc.
- ✅ **Visualización interactiva**:
  - Tabla con filtros y búsqueda
  - Dashboard con gráficos dinámicos (Chart.js)
- ✅ **Exportación**:
  - Excel (`.xlsx`) con [ExcelJS](https://github.com/exceljs/exceljs)
  - PDF con [Puppeteer](https://pptr.dev/)
- ✅ **Responsive**: Funciona perfectamente en móviles y escritorio

---

## 🛠 Tecnologías

| Categoría    | Tecnología            |
|--------------|------------------------|
| Backend      | Node.js + Express      |
| Frontend     | HTML5, JavaScript ES6  |
| Estilos      | Tailwind CSS           |
| Base de datos| SQLite (en memoria)    |
| Gráficos     | Chart.js               |
| Exportación  | ExcelJS, Puppeteer     |

---

## 📦 Instalación local

### Requisitos

- Node.js 16 o superior
- npm

### Pasos

```bash
git clone https://github.com/PIEDRACAR/sri-comprobantes-app.git
cd sri-comprobantes-app
npm install
node server.js
```

Luego abre tu navegador en:

```
http://localhost:3000
```

---

## 🌐 Deploy en Render.com (opcional)

1. Crea una cuenta en [https://render.com](https://render.com)
2. Conecta tu repositorio de GitHub
3. Selecciona "New Web Service"
4. Configura:

| Campo           | Valor                 |
|------------------|------------------------|
| Build Command    | `npm install`          |
| Start Command    | `node server.js`       |
| Root Directory   | (vacío o `.`)          |
| Environment      | Node                   |

---

## 📸 Capturas (opcional)

Agrega aquí capturas de pantalla si deseas mostrar la interfaz o resultados.

---

## 👨‍💻 Autor

Repositorio creado por [@PIEDRACAR](https://github.com/PIEDRACAR)  
Aplicación desarrollada como herramienta para automatizar el procesamiento de comprobantes electrónicos del SRI Ecuador.

