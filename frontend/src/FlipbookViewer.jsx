import React, { useState, useRef } from 'react';
import HTMLFlipBook from 'react-pageflip';
import './FlipbookViewer.css';

const API_URL = 'http://localhost:3001';

const Page = React.forwardRef((props, ref) => {
    return (
        <div className="flipbook-page" ref={ref}>
            <img src={props.src} alt="" className="flipbook-page-image" />
        </div>
    );
});

function FlipbookViewer({ menuData }) {
    const [currentPage, setCurrentPage] = useState(0);
    const flipBookRef = useRef(null);
    const wrapperRef = useRef(null); // Ref for the container div
    const totalPages = menuData.imageUrls.length;

    const handleFlip = (e) => {
        const newPage = e.data;
        setCurrentPage(newPage);
        
        // --- JAVASCRIPT-DRIVEN CENTERING LOGIC ---
        const wrapper = wrapperRef.current;
        if (wrapper) {
            if (newPage === 0) {
                // If on the cover page, add the centering class
                wrapper.classList.add('center-cover');
            } else {
                // For all other pages, remove it
                wrapper.classList.remove('center-cover');
            }
        }
    };

    const goToNextPage = () => flipBookRef.current?.pageFlip().flipNext();
    const goToPrevPage = () => flipBookRef.current?.pageFlip().flipPrev();

    const formatPageNumber = () => {
        if (currentPage === 0) return `1 / ${totalPages}`;
        const lastPage = Math.ceil(totalPages / 2);
        if (currentPage >= lastPage) return `${totalPages} / ${totalPages}`;
        const start = currentPage * 2;
        const end = start + 1 > totalPages ? totalPages : start + 1;
        return `${start}-${end} / ${totalPages}`;
    };

    return (
        <div className="flipbook-viewer-container">
            {/* This is now the "Safe Area Box" */}
            <div className="safe-area-box" ref={wrapperRef}> 
                <HTMLFlipBook
                    ref={flipBookRef}
                    width={550}
                    height={800}
                    size="stretch"
                    minWidth={315} maxWidth={1100}
                    minHeight={400} maxHeight={1533}
                    maxShadowOpacity={0.5}
                    showCover={true}
                    mobileScrollSupport={true}
                    onFlip={handleFlip}
                    className="menu-book"
                >
                    {menuData.imageUrls.map((url, index) => (
                        <Page key={index} src={`${API_URL}${url}`} />
                    ))}
                </HTMLFlipBook>
            </div>

            <div className="fixed-controls">
                <button onClick={goToPrevPage} className="control-btn">←</button>
                <div className="page-counter">{formatPageNumber()}</div>
                <button onClick={goToNextPage} className="control-btn">→</button>
            </div>
        </div>
    );
}

export default FlipbookViewer;