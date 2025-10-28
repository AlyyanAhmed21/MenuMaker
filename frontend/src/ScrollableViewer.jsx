import React, { useState, useEffect, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowLeft, faArrowRight } from '@fortawesome/free-solid-svg-icons';
import './ScrollableViewer.css';

const API_URL = 'http://localhost:3001';

function ScrollableViewer({ imageUrls }) {
    const [currentPage, setCurrentPage] = useState(0);

    const goToNextPage = () => setCurrentPage(c => Math.min(c + 1, imageUrls.length - 1));
    const goToPrevPage = () => setCurrentPage(c => Math.max(c - 1, 0));

    // --- MOUSE WHEEL AND TOUCH SCROLL LOGIC ---
    const touchStartY = useRef(0);
    useEffect(() => {
        const handleWheel = (e) => {
            if (e.deltaY > 0) goToNextPage();
            else if (e.deltaY < 0) goToPrevPage();
        };
        
        const handleTouchStart = (e) => {
            touchStartY.current = e.touches[0].clientY;
        };

        const handleTouchEnd = (e) => {
            const touchEndY = e.changedTouches[0].clientY;
            if (touchStartY.current - touchEndY > 50) { // Swiped up
                goToNextPage();
            } else if (touchEndY - touchStartY.current > 50) { // Swiped down
                goToPrevPage();
            }
        };

        window.addEventListener('wheel', handleWheel);
        window.addEventListener('touchstart', handleTouchStart);
        window.addEventListener('touchend', handleTouchEnd);

        return () => {
            window.removeEventListener('wheel', handleWheel);
            window.removeEventListener('touchstart', handleTouchStart);
            window.removeEventListener('touchend', handleTouchEnd);
        };
    }, []); // Empty dependency array means this runs only once

    return (
        <div className="viewer-layout">
            <div className="top-bar"></div>
            <div className="safe-area-box single-page-view">
                {/* Add a transition for a smooth page change effect */}
                <div className="page-display" style={{ transform: `translateY(-${currentPage * 100}%)` }}>
                    {imageUrls.map((url, index) => (
                        <div className="single-page-wrapper" key={index}>
                            <img src={`${API_URL}${url}`} alt={`Page ${index + 1}`} />
                        </div>
                    ))}
                </div>
            </div>
            <div className="bottom-bar">
                {/* ... your existing controls ... */}
                 <div className="controls-center">
                    <button onClick={goToPrevPage} title="Previous Page" disabled={currentPage === 0}>
                        <FontAwesomeIcon icon={faArrowLeft} />
                    </button>
                    <span className="page-counter">{`${currentPage + 1} / ${imageUrls.length}`}</span>
                    <button onClick={goToNextPage} title="Next Page" disabled={currentPage === imageUrls.length - 1}>
                        <FontAwesomeIcon icon={faArrowRight} />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ScrollableViewer;