require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const AWS = require('aws-sdk'); // Import AWS SDK

// Your proven pdfjs/canvas imports remain unchanged
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const { createCanvas } = require('canvas');
pdfjsLib.GlobalWorkerOptions.workerSrc = `pdfjs-dist/legacy/build/pdf.worker.js`;

const app = express();
const port = process.env.PORT || 3001; // Important for Render deployment

// --- ✅ AWS S3 Configuration ---
const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_BUCKET_REGION,
});

app.use(cors());
// We no longer need to serve a local /public folder for user assets
// app.use('/public', express.static(...));

// --- ✅ Multer now holds files in memory ---
const upload = multer({ storage: multer.memoryStorage() });

// --- ✅ Helper function to upload a file buffer to S3 ---
const uploadToS3 = (buffer, filename, mimetype) => {
    const uniqueFilename = `${Date.now()}-${filename}`;
    const params = {
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: `output/${uniqueFilename}`, // File name in S3, inside an 'output' folder
        Body: buffer,
        ContentType: mimetype,
        ACL: 'public-read' // Make the file publicly accessible
    };
    return s3.upload(params).promise();
};

// --- ✅ PDF to Image Conversion - Now returns an array of Buffers ---
async function convertPdfToImages(pdfBuffer) {
    const data = new Uint8Array(pdfBuffer);
    const loadingTask = pdfjsLib.getDocument(data);
    const pdf = await loadingTask.promise;
    const imageBuffers = []; // We will store raw image data (buffers)

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
        
        // Push the image data buffer directly into our array
        imageBuffers.push(canvas.toBuffer('image/png'));
    }
    return imageBuffers;
}


// --- ✅ API Endpoint - Updated for S3 ---
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
            console.log(`Converting PDF: ${pdfFile.originalname}...`);
            
            // 1. Convert PDF to an array of image buffers
            const imageBuffers = await convertPdfToImages(pdfFile.buffer);

            // 2. Upload each buffer to S3
            for (let i = 0; i < imageBuffers.length; i++) {
                const buffer = imageBuffers[i];
                const filename = `page_${i + 1}.png`;
                const uploadResult = await uploadToS3(buffer, filename, 'image/png');
                imageUrls.push(uploadResult.Location); // The public URL from S3
            }

        } else { // Otherwise, treat them as images
            console.log(`Processing ${uploadedFiles.length} image(s)...`);
            for (const imageFile of uploadedFiles) {
                // Upload each image buffer directly to S3
                const uploadResult = await uploadToS3(imageFile.buffer, imageFile.originalname, imageFile.mimetype);
                imageUrls.push(uploadResult.Location);
            }
        }

        console.log('✅ Upload to S3 successful. Image URLs:', imageUrls);
        res.json({ imageUrls });

    } catch (error) {
        console.error('Error during S3 upload/processing:', error);
        res.status(500).send('Failed to process files.');
    }
});


// --- Server Start ---
app.listen(port, () => {
    console.log(`Backend server listening on port ${port}`);
});
