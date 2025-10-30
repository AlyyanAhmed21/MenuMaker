const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs/promises');

// pdfjs/canvas imports unchanged...
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { createCanvas } = require('canvas');
pdfjsLib.GlobalWorkerOptions.workerSrc = `pdfjs-dist/legacy/build/pdf.worker.js`;

const app = express();
const port = 3001;

app.use(cors());

// IMPORTANT: add setHeaders here so images served from /public include CORS header
app.use('/public', express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Allow the frontend at any origin to request these images for canvas drawing.
    // In production you can restrict this to your frontend origin.
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

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
// Change from upload.single to upload.array to accept multiple files
app.post('/api/upload', upload.array('files'), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).send('No files uploaded.');
    }

    try {
        let imageUrls = [];
        const uploadedFiles = req.files;

        // Check if the upload is a single PDF
        if (uploadedFiles.length === 1 && uploadedFiles[0].mimetype === 'application/pdf') {
            const pdfFile = uploadedFiles[0];
            const pdfFilePath = pdfFile.path;
            const outputDir = path.join(__dirname, 'public', 'output', `${Date.now()}`);
            
            console.log(`Converting PDF: ${pdfFilePath}...`);
            imageUrls = await convertPdfToImages(pdfFilePath, outputDir);
            await fs.unlink(pdfFilePath); // Clean up the uploaded PDF

        } else { // Otherwise, treat them as images
            console.log(`Processing ${uploadedFiles.length} image(s)...`);
            for (const imageFile of uploadedFiles) {
                // For images, we just need to move them to the public directory
                const outputDir = path.join(__dirname, 'public', 'output', 'images');
                await fs.mkdir(outputDir, { recursive: true });
                
                const finalPath = path.join(outputDir, imageFile.filename);
                await fs.rename(imageFile.path, finalPath); // Move from /uploads to /public

                const relativePath = path.relative(path.join(__dirname, 'public'), finalPath);
                imageUrls.push(`/public/${relativePath.replace(/\\/g, '/')}`);
            }
        }

        console.log('✅ Processing successful. Image URLs:', imageUrls);
        res.json({ imageUrls });

    } catch (error) {
        console.error('Error during file processing:', error);
        res.status(500).send('Failed to process files.');
    }
});


// --- Server Start ---
app.listen(port, () => {
    console.log(`Backend server listening at http://localhost:${port}`);
});




