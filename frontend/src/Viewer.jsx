import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import FlipbookViewer from './FlipbookViewer';
import ScrollableViewer from './ScrollableViewer';

function Viewer() {
    const [menuData, setMenuData] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        const data = sessionStorage.getItem('menuData');
        if (data) {
            setMenuData(JSON.parse(data));
        } else {
            navigate('/');
        }
    }, [navigate]);

    if (!menuData) {
        return <div className="loading-screen">Preparing Menu...</div>;
    }

    // --- Conditional Rendering Logic ---
    if (menuData.layout === 'single') {
        return <ScrollableViewer imageUrls={menuData.imageUrls} />;
    } else {
        return <FlipbookViewer menuData={menuData} />;
    }
}

export default Viewer;