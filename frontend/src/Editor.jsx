import React, { useState } from 'react';
import axios from 'axios';
import './Editor.css'; // We'll create this CSS file

const API_URL = 'http://localhost:3001';

function Editor() {
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [layout, setLayout] = useState('dual'); // 'dual' or 'single'
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = (event) => {
    setSelectedFiles(Array.from(event.target.files));
    setError('');
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) {
      setError('Please select files first.');
      return;
    }

    setIsLoading(true);
    setError('');

    const formData = new FormData();
    selectedFiles.forEach(file => {
      formData.append('files', file);
    });

    try {
      const response = await axios.post(`${API_URL}/api/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      // Store the results in session storage for the new tab to access
      const menuData = {
        imageUrls: response.data.imageUrls,
        layout: layout,
      };
      sessionStorage.setItem('menuData', JSON.stringify(menuData));

      // Open the viewer in a new tab
      window.open('/viewer', '_blank');

    } catch (err) {
      setError('An error occurred during upload. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="Editor">
      <header className="Editor-header">
        <h1>Menu Maker MVP (Phase 1)</h1>
        <p>Upload a PDF or multiple images to create your interactive menu.</p>
      </header>
      
      <div className="controls-section">
        <div className="file-uploader">
          <label htmlFor="file-upload" className="custom-file-upload">
            {selectedFiles.length > 0 ? `${selectedFiles.length} file(s) chosen` : 'Choose Files'}
          </label>
          <input 
            id="file-upload"
            type="file" 
            accept="application/pdf,image/png,image/jpeg" 
            onChange={handleFileChange} 
            multiple 
          />
        </div>

        <div className="layout-selector">
          <label>
            <input type="radio" value="single" checked={layout === 'single'} onChange={(e) => setLayout(e.target.value)} />
            Single Page
          </label>
          <label>
            <input type="radio" value="dual" checked={layout === 'dual'} onChange={(e) => setLayout(e.target.value)} />
            Dual Page (Book)
          </label>
        </div>

        <button onClick={handleUpload} disabled={isLoading || selectedFiles.length === 0}>
          {isLoading ? 'Processing...' : 'Create Menu'}
        </button>
      </div>
      {error && <p className="error-message">{error}</p>}
    </div>
  );
}

export default Editor;