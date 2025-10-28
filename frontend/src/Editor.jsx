import React, { useState } from 'react';
import axios from 'axios';
import WavyBackground from './WavyBackground';
import './Editor.css';

const API_URL = 'http://localhost:3001';

function Editor() {
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [layout, setLayout] = useState('dual');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleFileChange = (event) => {
        setSelectedFiles(Array.from(event.target.files));
        setError('');
    };

    const handleUpload = async () => {
        if (selectedFiles.length === 0) { return setError('Please select files first.'); }
        setIsLoading(true);
        setError('');
        const formData = new FormData();
        selectedFiles.forEach(file => formData.append('files', file));
        try {
            // ✅ THE FIX IS HERE: Correct URL and pass formData
            const response = await axios.post(`${API_URL}/api/upload`, formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
                timeout: 60000,
            });
            const menuData = { imageUrls: response.data.imageUrls, layout: layout };
            sessionStorage.setItem('menuData', JSON.stringify(menuData));
            window.open('/viewer', '_blank');
        } catch (err) {
            setError('An error occurred during upload. Please check the console.');
            console.error("Upload Error:", err);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="editor-container">
            <WavyBackground />
            <div className="glass-box">
                <h1>Menu Maker</h1>
                <p>Upload your files and choose a layout to begin.</p>
                
                <div className="file-uploader">
                    <label htmlFor="file-upload" className="custom-file-upload">
                        {selectedFiles.length > 0 ? `${selectedFiles.length} file(s) chosen` : 'Choose Files'}
                    </label>
                    <input id="file-upload" type="file" accept="application/pdf,image/png,image/jpeg" onChange={handleFileChange} multiple />
                </div>

                <div className="layout-selector">
                    <label className={layout === 'single' ? 'active' : ''}>
                        <input type="radio" name="layout" value="single" checked={layout === 'single'} onChange={(e) => setLayout(e.target.value)} />
                        Single Page
                    </label>
                    <label className={layout === 'dual' ? 'active' : ''}>
                        <input type="radio" name="layout" value="dual" checked={layout === 'dual'} onChange={(e) => setLayout(e.target.value)} />
                        Dual Page (Book)
                    </label>
                </div>

                <button onClick={handleUpload} disabled={isLoading || selectedFiles.length === 0}>
                    {isLoading ? 'Processing...' : 'Create Menu'}
                </button>

                {error && <p className="error-message">{error}</p>}
            </div>
        </div>
    );
}
export default Editor;