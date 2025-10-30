import React, { useEffect, useRef, useState, useCallback } from 'react';
import WavyBackground from './WavyBackground';
import './FlipbookViewer.css';

const API_URL = 'http://localhost:3001';

// Sequential loader helper used earlier (unchanged logic expected in your app).
function loadScript(src, globalCheck = () => false) {
  return new Promise((resolve, reject) => {
    try {
      if (globalCheck()) return resolve();
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed to load script')));
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = false; // important: keep execution order
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    } catch (err) {
      reject(err);
    }
  });
}

function FlipbookViewer({ menuData }) {
  const flipbookRef = useRef(null);
  const safeAreaRef = useRef(null);
  const ptrState = useRef({ active: false, startX: 0, startY: 0, moved: false, flipped: false, corner: null });
  const [turnInstance, setTurnInstance] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = (menuData && menuData.imageUrls) ? menuData.imageUrls.length : 0;

  // sizing (same logic as before)
  const setBookSize = useCallback(() => {
    if (!flipbookRef.current || !safeAreaRef.current || !turnInstance) return;

    const safe = safeAreaRef.current;
    const containerWidth = safe.clientWidth - 40;
    const containerHeight = safe.clientHeight - 40;

    const pageAspectRatio = 8.5 / 11;
    let pageHeight = Math.min(containerHeight, 920);
    let pageWidth = pageHeight * pageAspectRatio;
    let bookWidth = pageWidth * 2;
    let bookHeight = pageHeight;

    if (bookWidth > containerWidth) {
      bookWidth = containerWidth;
      pageWidth = bookWidth / 2;
      pageHeight = pageWidth / pageAspectRatio;
      bookHeight = pageHeight;
    }

    try { turnInstance.turn('size', Math.round(bookWidth), Math.round(bookHeight)); } catch (e) {}
    const el = flipbookRef.current;
    el.style.width = `${Math.round(bookWidth)}px`;
    el.style.height = `${Math.round(bookHeight)}px`;
  }, [turnInstance]);

  // Initialize jQuery and turn.js sequentially, then init the book
  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        await loadScript('https://code.jquery.com/jquery-3.6.0.min.js', () => !!window.jQuery);
        await loadScript('/turn.min.js', () => !!(window.jQuery && window.jQuery.fn && window.jQuery.fn.turn));
        await new Promise(r => setTimeout(r, 30));
      } catch (err) {
        console.warn('Could not load scripts (jQuery/turn.js). Flipbook will try to run with limited interaction.', err);
      }

      if (!mounted) return;
      const $ = window.jQuery;
      if (!flipbookRef.current || !($ && $.fn && $.fn.turn)) {
        // plugin not available: we'll still render static pages and our swipe handlers will work
        return;
      }

      const $book = $(flipbookRef.current);

      try {
        if ($book.turn('is')) $book.turn('destroy');
      } catch (e) {}

      $book.turn({
        width: 1,
        height: 1,
        display: 'double',
        autoCenter: true,
        acceleration: true,
        gradients: !$.isTouch,
        elevation: 50,
        duration: 700,
        when: {
          turned: function (e, page) {
            setCurrentPage(page);
          }
        }
      });

      setTurnInstance($book);
    }

    init();
    return () => { mounted = false; };
  }, [menuData]);

  // Resize observer + window resize
  useEffect(() => {
    if (!turnInstance) return;
    setBookSize();
    const safeEl = safeAreaRef.current;
    let ro;
    if (safeEl && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(setBookSize);
      ro.observe(safeEl);
    }
    window.addEventListener('resize', setBookSize);
    return () => {
      window.removeEventListener('resize', setBookSize);
      if (ro && safeEl) ro.unobserve(safeEl);
    };
  }, [turnInstance, setBookSize]);

  // cleanup
  useEffect(() => {
    return () => {
      if (turnInstance && turnInstance.turn && turnInstance.turn('is')) {
        try { turnInstance.turn('destroy'); } catch (e) {}
      }
    };
  }, [turnInstance]);

  // navigation
  const goNext = () => { if (turnInstance && turnInstance.turn) turnInstance.turn('next'); else { /* fallback */ } };
  const goPrev = () => { if (turnInstance && turnInstance.turn) turnInstance.turn('previous'); else { /* fallback */ } };
  const goFirst = () => { if (turnInstance && turnInstance.turn) turnInstance.turn('page', 1); };
  const goLast = () => { if (turnInstance && turnInstance.turn) turnInstance.turn('page', totalPages); };
  const jumpTo = (value) => {
    const p = Number(value);
    if (!isNaN(p) && p >= 1 && p <= totalPages && turnInstance && turnInstance.turn) {
      turnInstance.turn('page', p);
    }
  };

  // keyboard nav
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'Home') goFirst();
      if (e.key === 'End') goLast();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turnInstance]);

  // Pointer (touch + mouse) handlers for swipe / corner-drag flipping
  useEffect(() => {
    const el = flipbookRef.current;
    if (!el) return;

    const state = ptrState.current;
    const THRESHOLD = 40; // px to count as swipe
    const CORNER_AREA = 0.18; // fractional width from edges considered "corner"

    function onPointerDown(e) {
      // Only left/mouse and touch/pen supported
      state.active = true;
      state.moved = false;
      state.flipped = false;
      state.startX = e.clientX;
      state.startY = e.clientY;
      state.startTime = Date.now();

      // compute corner: left or right or null
      const rect = el.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      if (relX < CORNER_AREA) state.corner = 'left';
      else if (relX > 1 - CORNER_AREA) state.corner = 'right';
      else state.corner = null;

      try { (e.target || el).setPointerCapture && (e.target || el).setPointerCapture(e.pointerId); } catch (err) {}
    }

    function onPointerMove(e) {
      if (!state.active) return;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) state.moved = true;

      // If user started in a corner and moves far enough horizontally, trigger flip
      if (!state.flipped && state.corner) {
        if (state.corner === 'right' && dx < -THRESHOLD) { goNext(); state.flipped = true; }
        if (state.corner === 'left' && dx > THRESHOLD) { goPrev(); state.flipped = true; }
      }
    }

    function onPointerUp(e) {
      if (!state.active) return;
      const dx = e.clientX - state.startX;
      const dt = Date.now() - state.startTime;

      // Quick swipe detection (even if not in corner)
      if (!state.flipped && Math.abs(dx) > THRESHOLD && Math.abs(dx) > Math.abs(e.clientY - state.startY)) {
        if (dx < 0) goNext(); else goPrev();
        state.flipped = true;
      }

      // If not moved much (a tap) and near edge — interpret as page peel attempt: small move triggers
      if (!state.flipped && !state.moved && state.corner) {
        // treat tap on right edge as goNext, left as goPrev
        if (state.corner === 'right') goNext();
        else if (state.corner === 'left') goPrev();
      }

      state.active = false;
      state.corner = null;
      state.moved = false;
      state.flipped = false;
      try { (e.target || el).releasePointerCapture && (e.target || el).releasePointerCapture(e.pointerId); } catch (err) {}
    }

    el.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [turnInstance]);

  if (!menuData || !menuData.imageUrls || menuData.imageUrls.length === 0) {
    return (
      <div className="viewer-layout">
        <WavyBackground />
        <div className="top-bar" />
        <div className="safe-area-box">
          <div className="empty-message">No pages to display.</div>
        </div>
        <div className="bottom-bar" />
      </div>
    );
  }

  // page counter text (same logic)
  let displayPageText = '';
  try {
    if (turnInstance && turnInstance.turn) {
      const view = turnInstance.turn('view');
      if (Array.isArray(view) && view.length === 2) displayPageText = `${view[0]} - ${view[1]} / ${totalPages}`;
      else if (Array.isArray(view) && view.length === 1) displayPageText = `${view[0]} / ${totalPages}`;
    }
  } catch (e) {}
  if (!displayPageText) {
    if (currentPage <= 1) displayPageText = `1 / ${totalPages}`;
    else if (currentPage >= totalPages) displayPageText = `${totalPages} / ${totalPages}`;
    else displayPageText = `${currentPage} - ${Math.min(currentPage + 1, totalPages)} / ${totalPages}`;
  }

  return (
    <div className="viewer-layout">
      <WavyBackground />
      <div className="top-bar">
        <div className="controls-center top-controls">
          <button className="ctrl" title="First" onClick={goFirst}>⏮</button>
          <button className="ctrl" title="Prev" onClick={goPrev}>◀</button>

          <div className="page-counter">
            <span className="page-text">{displayPageText}</span>
            <input
              className="page-jump"
              type="number"
              min="1"
              max={totalPages}
              placeholder="Go to"
              onKeyDown={(e) => {
                if (e.key === 'Enter') jumpTo(e.target.value);
              }}
            />
          </div>

          <button className="ctrl" title="Next" onClick={goNext}>▶</button>
          <button className="ctrl" title="Last" onClick={goLast}>⏭</button>
        </div>
      </div>

      <div className="safe-area-box" ref={safeAreaRef}>
        <div ref={flipbookRef} className="menu-book" aria-hidden={false}>
          {menuData.imageUrls.map((url, idx) => (
            <div key={idx} className="page" data-page={idx + 1}>
              <img src={`${API_URL}${url}`} alt={`page-${idx + 1}`} className="page-image" draggable="false" />
            </div>
          ))}
        </div>

        <button className="nav-arrow left" onClick={goPrev} aria-label="Previous" />
        <button className="nav-arrow right" onClick={goNext} aria-label="Next" />
      </div>

      <div className="bottom-bar" /> {/* kept for spacing */}
    </div>
  );
}

export default FlipbookViewer;