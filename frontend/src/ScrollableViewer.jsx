import React, { useRef } from 'react';
import './ScrollableViewer.css';

const API_URL = 'http://localhost:3001';

function ScrollableViewer({ imageUrls }) {
    const pageRefs = useRef([]);
    pageRefs.current = []; // Reset refs on each render

    const addToRefs = (el) => {
        if (el && !pageRefs.current.includes(el)) {
            pageRefs.current.push(el);
        }
    };

    const scrollToPage = (direction) => {
        const container = document.querySelector('.scroll-container');
        if (!container) return;

        const currentPageY = container.scrollTop;
        let targetPage = null;

        if (direction === 'next') {
            // Find the first page that is below the current view
            targetPage = pageRefs.current.find(page => page.offsetTop > currentPageY);
        } else { // 'prev'
            // Find the last page that is above the current view
            const pagesAbove = pageRefs.current.filter(page => page.offsetTop < currentPageY);
            targetPage = pagesAbove[pagesAbove.length - 1];
        }

        if (targetPage) {
            targetPage.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    };

    return (
        <div className="scroll-viewer-container">
            <div className="scroll-container">
                {imageUrls.map((url, index) => (
                    <div className="scroll-page" key={index} ref={addToRefs}>
                        <img src={`${API_URL}${url}`} alt={`Page ${index + 1}`} />
                    </div>
                ))}
            </div>
            {/* --- Fixed Controls for Scroll View --- */}
            <div className="fixed-controls">
                <button onClick={() => scrollToPage('prev')} className="control-btn">↑</button>
                <div className="page-counter">Scroll</div>
                <button onClick={() => scrollToPage('next')} className="control-btn">↓</button>
            </div>
        </div>
    );
}

export default ScrollableViewer;