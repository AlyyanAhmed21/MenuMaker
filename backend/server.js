const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs/promises');

// --- ✅ The Correct Import for the CJS-Compatible Version (v2.x) ---
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { createCanvas } = require('canvas');

// --- ✅ Set the worker source for Node.js environment (Required for v2.x) ---
pdfjsLib.GlobalWorkerOptions.workerSrc = `pdfjs-dist/legacy/build/pdf.worker.js`;

const app = express();
const port = 3001;

// --- Middlewares ---
app.use(cors());
app.use('/public', express.static(path.join(__dirname, 'public')));

// --- File Upload Setup ---
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'uploads');
        await fs.mkdir(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });


// --- PDF to Image Conversion ---
async function convertPdfToImages(pdfPath, outputDir) {
    await fs.mkdir(outputDir, { recursive: true });

    const data = new Uint8Array(await fs.readFile(pdfPath));
    const loadingTask = pdfjsLib.getDocument(data);
    const pdf = await loadingTask.promise;

    const imageUrls = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const scale = 1.5;
        const viewport = page.getViewport({ scale });
        
        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');

        const renderContext = {
            canvasContext: context,
            viewport: viewport
        };
        
        await page.render(renderContext).promise;

        const outputPath = path.join(outputDir, `page_${i}.png`);
        const buffer = canvas.toBuffer('image/png');
        await fs.writeFile(outputPath, buffer);
        
        const relativePath = path.relative(path.join(__dirname, 'public'), outputPath);
        imageUrls.push(`/public/${relativePath.replace(/\\/g, '/')}`);
    }

    return imageUrls;
}


// --- API Endpoint ---
app.post('/api/upload', upload.single('pdfFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const pdfFilePath = req.file.path;
    const outputDir = path.join(__dirname, 'public', 'output', `${Date.now()}`);

    try {
        console.log(`Converting ${pdfFilePath}...`);
        
        const imageUrls = await convertPdfToImages(pdfFilePath, outputDir);

        console.log('✅ Conversion successful. Image URLs:', imageUrls);

        await fs.unlink(pdfFilePath);
        res.json({ imageUrls });

    } catch (error) {
        console.error('Error during PDF conversion:', error);
        await fs.unlink(pdfFilePath).catch(err => console.error("Failed to cleanup file:", err));
        res.status(500).send('Failed to process PDF.');
    }
});


// --- Server Start ---
app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
});