import React, { useState, useEffect, useRef } from 'react';
import { TransformWrapper, TransformComponent, useControls } from "react-zoom-pan-pinch";
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearchPlus, faSearchMinus, faExpand, faCompress, faArrowUp, faArrowDown, faUndo } from '@fortawesome/free-solid-svg-icons';
import WavyBackground from './WavyBackground';
import './ScrollableViewer.css';

const API_URL = 'http://localhost:3001';

const Controls = ({ onPrev, onNext, currentPage, totalPages }) => {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen();
    }
  };

  return (
    <div className="bottom-bar">
      <div className="controls-left">
        <button onClick={() => zoomIn(0.2)} title="Zoom In"><FontAwesomeIcon icon={faSearchPlus} /></button>
        <button onClick={() => zoomOut(0.2)} title="Zoom Out"><FontAwesomeIcon icon={faSearchMinus} /></button>
        <button onClick={() => resetTransform(0)} title="Reset Zoom"><FontAwesomeIcon icon={faUndo} /> Reset</button>
      </div>
      <div className="controls-center">
        <button onClick={onPrev} title="Previous Page" disabled={currentPage === 0}>
          <FontAwesomeIcon icon={faArrowUp} />
        </button>
        <span className="page-counter">{`${currentPage + 1} / ${totalPages}`}</span>
        <button onClick={onNext} title="Next Page" disabled={currentPage === totalPages - 1}>
          <FontAwesomeIcon icon={faArrowDown} />
        </button>
      </div>
      <div className="controls-right">
        <button onClick={toggleFullScreen} title="Fullscreen">
          <FontAwesomeIcon icon={isFullscreen ? faCompress : faExpand} />
        </button>
      </div>
    </div>
  );
};

function ScrollableViewer({ imageUrls }) {
  const [currentPage, setCurrentPage] = useState(0);
  const safeAreaRef = useRef(null);
  const imgRef = useRef(null);
  const wrapperInstanceRef = useRef(null);

  useEffect(() => {
    setCurrentPage(0);
  }, [imageUrls]);

  const goToNextPage = () => setCurrentPage(c => Math.min(c + 1, imageUrls.length - 1));
  const goToPrevPage = () => setCurrentPage(c => Math.max(c - 1, 0));

  // When an image loads, compute available space and zoom to fit
  const handleImageLoad = (e) => {
    const img = e.target;
    imgRef.current = img;

    // Read CSS variables to compute exact reserved top/bottom areas
    const rootStyles = getComputedStyle(document.documentElement);
    const topBarHeightRaw = rootStyles.getPropertyValue('--top-bar-height') || '0px';
    const bottomBarHeightRaw = rootStyles.getPropertyValue('--bottom-bar-height') || '0px';
    const viewerGapRaw = rootStyles.getPropertyValue('--viewer-gap') || '0px';

    const parsePx = v => {
      const n = parseFloat(v);
      return isNaN(n) ? 0 : n;
    };

    const topBarHeight = parsePx(topBarHeightRaw);
    const bottomBarHeight = parsePx(bottomBarHeightRaw);
    const viewerGap = parsePx(viewerGapRaw);

    // safe-area-box contains the TransformWrapper; measure its bounding box
    const safeRect = safeAreaRef.current?.getBoundingClientRect();
    if (!safeRect || !wrapperInstanceRef.current) return;

    // compute available width/height for the image inside the wrapper (consider the CSS side paddings 20px)
    const sidePadding = 40; // left + right (20 + 20) — kept in sync with CSS
    const availableWidth = Math.max(16, safeRect.width - sidePadding);
    // Top padding inside the zoom-content is (topBarHeight + viewerGap).
    // Bottom padding is (bottomBarHeight + viewerGap).
    const availableHeight = Math.max(16, safeRect.height - (topBarHeight + viewerGap) - (bottomBarHeight + viewerGap));

    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) return;

    const fitScale = Math.min(availableWidth / naturalW, availableHeight / naturalH, 1);

    // Use the wrapper instance to zoomTo and center
    const inst = wrapperInstanceRef.current;
    // set transform to fitScale and center the image
    // zoomTo(scale, animationTime, options)
    inst.zoomTo(fitScale, 250);

    // After zoom we want panning to be free, so ensure limits are off (we set limitToBounds=false)
    // ensure the image is centered horizontally (and anchored top because content uses align-items:flex-start)
    setTimeout(() => {
      inst.centerView(); // center the viewport on content
    }, 260);
  };

  return (
    <div className="viewer-layout">
      <WavyBackground />
      <div className="top-bar"></div>

      <div className="safe-area-box" ref={safeAreaRef}>
        <TransformWrapper
          initialScale={1}
          minScale={0.2}
          maxScale={5}
          // Allow free panning when zoomed so horizontal/vertical moves are natural
          limitToBounds={false}
          doubleClick={{ mode: 'zoomIn' }}
          wheel={{ step: 0.2 }}
          panning={{ velocityDisabled: true }}
          // keep reference to instance
          onInit={(instance) => { wrapperInstanceRef.current = instance; }}
          centerOnInit={false}
        >
          <TransformComponent
            wrapperClass="zoom-wrapper"
            contentClass="zoom-content"
          >
            <img
              src={imageUrls[currentPage]}
              alt={`Page ${currentPage + 1}`}
              onLoad={handleImageLoad}
              draggable={false}
            />
          </TransformComponent>

          <Controls
            onPrev={goToPrevPage}
            onNext={goToNextPage}
            currentPage={currentPage}
            totalPages={imageUrls.length}
          />
        </TransformWrapper>
      </div>
    </div>
  );
}

export default ScrollableViewer;