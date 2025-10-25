import React, { useState } from 'react';
import axios from 'axios';
import HTMLFlipBook from 'react-pageflip';
import './App.css';

const API_URL = 'http://localhost:3001'; // Our backend URL

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [imageUrls, setImageUrls] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files[0]);
    setImageUrls([]); // Reset on new file selection
    setError('');
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a PDF file first.');
      return;
    }

    setIsLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('pdfFile', selectedFile);

    try {
      const response = await axios.post(`${API_URL}/api/upload`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      // Prepend the base URL to the image paths returned from the backend
      const fullImageUrls = response.data.imageUrls.map(url => `${API_URL}${url}`);
      setImageUrls(fullImageUrls);
    } catch (err) {
      setError('An error occurred during upload. Please try again.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Menu Maker MVP (Phase 1)</h1>
        <p>Upload a PDF to convert it into an interactive flipbook.</p>
      </header>
      
      <div className="uploader-section">
        <input type="file" accept="application/pdf" onChange={handleFileChange} />
        <button onClick={handleUpload} disabled={isLoading || !selectedFile}>
          {isLoading ? 'Processing...' : 'Create Flipbook'}
        </button>
        {error && <p className="error-message">{error}</p>}
      </div>

      <div className="flipbook-container">
        {imageUrls.length > 0 && (
          <HTMLFlipBook width={500} height={700} showCover={true}>
            {imageUrls.map((url, index) => (
              <div className="demoPage" key={index}>
                <img src={url} alt={`Page ${index + 1}`} style={{ width: '100%', height: '100%' }} />
              </div>
            ))}
          </HTMLFlipBook>
        )}
      </div>
    </div>
  );
}

export default App;