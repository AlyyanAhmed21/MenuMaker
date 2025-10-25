import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Editor from './Editor';
import Viewer from './Viewer';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Editor />} />
        <Route path="/viewer" element={<Viewer />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);