import React, { useState, useRef, useEffect } from 'react';
import HTMLFlipBook from 'react-pageflip';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearchPlus, faSearchMinus, faExpand, faCompress, faArrowLeft, faArrowRight } from '@fortawesome/free-solid-svg-icons';
import './FlipbookViewer.css';

const API_URL = 'http://localhost:3001';

const Page = React.forwardRef((props, ref) => (
    <div className="page" ref={ref}>
        <img src={props.src} alt="" className="page-image" />
    </div>
));

function FlipbookViewer({ menuData }) {
    const [currentPage, setCurrentPage] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const flipBookRef = useRef(null);
    const totalPages = menuData.imageUrls.length;

    useEffect(() => {
        const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const handleFlip = (e) => setCurrentPage(e.data);
    const goToNextPage = () => flipBookRef.current?.pageFlip().flipNext();
    const goToPrevPage = () => flipBookRef.current?.pageFlip().flipPrev();
    
    const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.2, 2));
    const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.2, 1));

    const toggleFullScreen = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    };
    
    const bookContainerClass = currentPage === 0 ? 'book-container is-cover' : 'book-container';

    return (
        <div className="viewer-layout">
            <div className="top-bar"></div>

            <div className="safe-area-box">
                <div className={bookContainerClass} style={{ transform: `scale(${zoom})` }}>
                    <HTMLFlipBook
                        ref={flipBookRef}
                        width={550}
                        height={800}
                        size="stretch"
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
            </div>

            <div className="bottom-bar">
                <div className="controls-left">
                    <button onClick={handleZoomIn} title="Zoom In"><FontAwesomeIcon icon={faSearchPlus} /></button>
                    <button onClick={handleZoomOut} title="Zoom Out"><FontAwesomeIcon icon={faSearchMinus} /></button>
                </div>
                <div className="controls-center">
                    <button onClick={goToPrevPage} title="Previous Page"><FontAwesomeIcon icon={faArrowLeft} /></button>
                    <span className="page-counter">{`${currentPage === 0 ? 1 : currentPage * 2} / ${totalPages}`}</span>
                    <button onClick={goToNextPage} title="Next Page"><FontAwesomeIcon icon={faArrowRight} /></button>
                </div>
                <div className="controls-right">
                    <button onClick={toggleFullScreen} title="Fullscreen">
                        <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
                    </button>
                </div>
            </div>
        </div>
    );
}

export default FlipbookViewer;