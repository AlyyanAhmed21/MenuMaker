import React, { useState, useRef, useEffect, useCallback } from 'react';
import HTMLFlipBook from 'react-pageflip';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSearchPlus, faSearchMinus, faExpand, faCompress, faArrowLeft, faArrowRight } from '@fortawesome/free-solid-svg-icons';
import WavyBackground from './WavyBackground';
import './FlipbookViewer.css';

const API_URL = 'http://localhost:3001';

/**
 * Page component for the flipbook.
 * The <img> intentionally uses height:100% and width:auto so text remains readable.
 */
const Page = React.forwardRef(({ src }, ref) => (
  <div className="page" ref={ref}>
    <img src={src} alt="" className="page-image" draggable={false} />
  </div>
));

export default function FlipbookViewer({ menuData = { imageUrls: [] } }) {
  const imageUrls = menuData.imageUrls || [];
  const totalPages = imageUrls.length;

  const containerRef = useRef(null);
  const topBarRef = useRef(null);
  const bottomBarRef = useRef(null);
  const flipBookRef = useRef(null);

  // page size used by HTMLFlipBook (single page width/height)
  const [pageSize, setPageSize] = useState({ width: 550, height: 800 });
  const [imgAspect, setImgAspect] = useState(800 / 550); // default aspect (h/w)
  const [currentPageIndex, setCurrentPageIndex] = useState(0); // 0-based index returned by onFlip

  // Read natural aspect ratio from first image (if available) to avoid distortion.
  useEffect(() => {
    if (!imageUrls || imageUrls.length === 0) return;
    const img = new Image();
    img.onload = () => {
      if (img.naturalWidth && img.naturalHeight) {
        setImgAspect(img.naturalHeight / img.naturalWidth);
      }
      // update after new aspect known
      computePageSize();
    };
    img.src = `${API_URL}${imageUrls[0]}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrls]);

  // compute the ideal page size so:
  // - cover (first page) fills almost the full vertical area (top bar -> above bottom bar)
  // - two-page spreads fit horizontally (two pages + gutter <= availableWidth)
  const computePageSize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const topH = topBarRef.current ? topBarRef.current.getBoundingClientRect().height : 0;
    const bottomH = bottomBarRef.current ? bottomBarRef.current.getBoundingClientRect().height : 0;

    // Available area for the book (safe zone)
    const availableHeight = Math.max(120, rect.height - topH - bottomH - 10); // small breathing room
    const availableWidth = Math.max(240, rect.width - 40); // leave side background visible

    const isCover = currentPageIndex === 0;

    // Choose target height: cover gets slightly more vertical real estate so it's dominant.
    const coverHeight = Math.min(availableHeight * 0.98, 1600);
    const spreadHeight = Math.min(availableHeight * 0.92, 1600);
    let targetHeight = isCover ? coverHeight : spreadHeight;

    // Compute page width from target height using image aspect ratio
    let pageW = Math.round(targetHeight / imgAspect);

    // Gutter between pages when showing two-page spread
    const gutter = Math.max(12, Math.round(availableWidth * 0.02));

    // Ensure two pages + gutter fit horizontally. If not, clamp pageW and recompute height.
    const maxPageWForSpread = Math.floor((availableWidth - gutter) / 2);
    if (!isCover && pageW > maxPageWForSpread) {
      pageW = maxPageWForSpread;
      targetHeight = Math.round(pageW * imgAspect);
    }

    // For cover, ensure it doesn't exceed a reasonable portion of width (so sides show background)
    const maxCoverW = Math.floor(availableWidth * 0.86);
    if (isCover && pageW > maxCoverW) {
      pageW = maxCoverW;
      targetHeight = Math.round(pageW * imgAspect);
    }

    // Final safety clamps
    pageW = Math.max(120, pageW);
    targetHeight = Math.max(120, Math.round(targetHeight));

    setPageSize({ width: pageW, height: targetHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageIndex, imgAspect]);

  // Update sizes on mount, resize, and when current page changes.
  useEffect(() => {
    computePageSize();
    const onResize = () => computePageSize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [computePageSize]);

  // Ensure we don't forcibly flip back to cover - do not call flip(0) automatically.
  // The user reported earlier code forced a page reset; we avoid that here.

  // onFlip from react-pageflip gives the new page index; we store and recompute sizes.
  const handleFlip = (e) => {
    const newIndex = e.data;
    setCurrentPageIndex(newIndex);
    // recompute page size for the new state (cover vs spread)
    setTimeout(() => computePageSize(), 30);
  };

  const goNext = () => flipBookRef.current?.pageFlip()?.flipNext();
  const goPrev = () => flipBookRef.current?.pageFlip()?.flipPrev();

  // Simple zoom helpers (we apply small transform for user feedback)
  const zoomIn = () => {
    // brief enlarge pulse
    const wrap = containerRef.current;
    if (!wrap) return;
    wrap.style.transition = 'transform 180ms ease';
    wrap.style.transform = 'scale(1.05)';
    setTimeout(() => { wrap.style.transform = ''; }, 200);
  };
  const zoomOut = () => {
    const wrap = containerRef.current;
    if (!wrap) return;
    wrap.style.transition = 'transform 180ms ease';
    wrap.style.transform = 'scale(0.97)';
    setTimeout(() => { wrap.style.transform = ''; }, 200);
  };

  // Fullscreen toggle
  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Human-friendly page counter (1-based)
  const pageCounterText = `${Math.min(currentPageIndex + 1, Math.max(1, totalPages))} / ${Math.max(1, totalPages)}`;

  return (
    <div className="viewer-layout">
      <WavyBackground />
      <div className="top-bar" ref={topBarRef}></div>

      <div className="safe-area-box" ref={containerRef}>
        {/* book-wrap centers the book (cover or spread) horizontally and vertically */}
        <div className={`book-wrap ${currentPageIndex === 0 ? 'cover-mode' : 'spread-mode'}`}>
          <HTMLFlipBook
            ref={flipBookRef}
            width={pageSize.width}
            height={pageSize.height}
            size="stretch"
            showCover={true}
            mobileScrollSupport={true}
            onFlip={handleFlip}
            className="menu-book"
            maxShadowOpacity={0.35}
            drawShadow={true}
            flippingTime={650}
            usePortrait={false}
            startPage={0}
            shadowSide={true}
          >
            {imageUrls.map((url, i) => (
              <Page key={i} src={`${API_URL}${url}`} />
            ))}
          </HTMLFlipBook>
        </div>
      </div>

      <div className="bottom-bar" ref={bottomBarRef}>
        <div className="controls-left">
          <button onClick={zoomIn} title="Zoom In"><FontAwesomeIcon icon={faSearchPlus} /></button>
          <button onClick={zoomOut} title="Zoom Out"><FontAwesomeIcon icon={faSearchMinus} /></button>
        </div>

        <div className="controls-center">
          <button onClick={goPrev} title="Previous Page"><FontAwesomeIcon icon={faArrowLeft} /></button>
          <span className="page-counter">{pageCounterText}</span>
          <button onClick={goNext} title="Next Page"><FontAwesomeIcon icon={faArrowRight} /></button>
        </div>

        <div className="controls-right">
          <button onClick={toggleFullScreen} title="Fullscreen"><FontAwesomeIcon icon={faExpand} /></button>
        </div>
      </div>
    </div>
  );
}