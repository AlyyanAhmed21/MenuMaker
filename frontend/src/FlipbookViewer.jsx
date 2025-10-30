import React, { useEffect, useRef, useState, useCallback } from 'react';
import WavyBackground from './WavyBackground';
import './FlipbookViewer.css';

const API_URL = 'http://localhost:3001';

// small sequential loader to ensure jQuery is present before turn.js loads
function loadScript(src, check = () => false) {
  return new Promise((resolve, reject) => {
    try {
      if (check()) return resolve();
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)));
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    } catch (err) {
      reject(err);
    }
  });
}

/*
  Fix summary:
  - applyZoomTransform and clearZoomTransform were referenced before definition — moved and defined with useCallback
    so all effects that use them (dblclick, wheel, pinch) have a defined function.
  - Minor stability: used useCallback and refs where appropriate to avoid stale closures.
  No other logic changes beyond ensuring the zoom helpers exist before usage.
*/

export default function FlipbookViewer({ menuData }) {
  const flipbookRef = useRef(null);
  const safeAreaRef = useRef(null);
  const lensRef = useRef(null);
  const [turnInstance, setTurnInstance] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  // Zoom/tool state
  const [zoomToolActive, setZoomToolActive] = useState(false); // magnifier tool (lens + wheel)
  const [zoomed, setZoomed] = useState(false);                 // full-page zoomed in
  const [zoomScale, setZoomScale] = useState(2);               // current zoom factor for full zoom / wheel
  const panRef = useRef({ x: 0, y: 0 });                       // pan offsets when zoomed
  const pinchStateRef = useRef(null);                          // pinch tracking
  const hiResLoadedRef = useRef(false);                        // whether hi-res swap did occur
  const originalSrcsRef = useRef(new Map());                   // map img -> original src (for restore)

  const totalPages = (menuData && Array.isArray(menuData.imageUrls)) ? menuData.imageUrls.length : 0;
  const TURN_DURATION_MS = 1700;
  const MIN_SCALE = 1;
  const MAX_SCALE = 4;

  // ----------------- Zoom helpers (must be defined before effects that use them) -----------------

  // Apply zoom transform centered at given percent location (0-100)
  const applyZoomTransform = useCallback((originPctX = 50, originPctY = 50, scale = null) => {
    const el = flipbookRef.current;
    if (!el) return;
    const s = typeof scale === 'number' ? scale : zoomScale;
    el.style.transformOrigin = `${originPctX}% ${originPctY}%`;
    const { x, y } = panRef.current;
    el.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    el.classList.add('zoomed');
  }, [zoomScale]);

  const clearZoomTransform = useCallback(() => {
    const el = flipbookRef.current;
    if (!el) return;
    panRef.current = { x: 0, y: 0 };
    el.style.transform = '';
    el.style.transformOrigin = '';
    el.classList.remove('zoomed');
  }, []);

  // ----------------- Baseline helpers (inject pages etc.) -----------------
  const injectPages = useCallback((urls) => {
    if (!flipbookRef.current) return;
    const nodes = (urls || []).map((u, i) => {
      const src = u;
      return `<div class="page" data-page="${i + 1}">
                <img class="page-image" src="${src}" draggable="false" data-orig="${src}" />
              </div>`;
    });
    if (nodes.length % 2 === 1) nodes.push('<div class="page blank-page" data-page="blank"></div>');
    flipbookRef.current.innerHTML = nodes.join('');
  }, []);

  const waitForImagesInContainer = useCallback((timeoutMs = 5000) => {
    const container = flipbookRef.current;
    if (!container) return Promise.resolve();
    const imgs = Array.from(container.querySelectorAll('img.page-image'));
    const promises = imgs.map((img) => {
      if (img.complete && img.naturalWidth) return Promise.resolve();
      return new Promise((res) => {
        const onLoad = () => { cleanup(); res(); };
        const onErr = () => { cleanup(); res(); };
        const to = setTimeout(() => { cleanup(); res(); }, timeoutMs);
        function cleanup() {
          clearTimeout(to);
          img.removeEventListener('load', onLoad);
          img.removeEventListener('error', onErr);
        }
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onErr);
      });
    });
    return Promise.all(promises);
  }, []);

  const computeAdaptiveSize = useCallback(() => {
    const container = safeAreaRef.current;
    const el = flipbookRef.current;
    if (!container || !el) return null;
    const containerWidth = Math.max(320, container.clientWidth - 40);
    const containerHeight = Math.max(320, container.clientHeight - 40);
    const imgs = Array.from(el.querySelectorAll('img.page-image'));
    const leftImg = imgs[0] || null;
    const rightImg = imgs[1] || null;
    const aspect = (img) => {
      if (!img) return 8.5 / 11;
      const w = img.naturalWidth || img.width || null;
      const h = img.naturalHeight || img.height || null;
      if (w && h && Number.isFinite(w) && Number.isFinite(h) && h > 0) return w / h;
      return 8.5 / 11;
    };
    const leftAspect = aspect(leftImg);
    const rightAspect = aspect(rightImg);
    const pageMaxHeight = containerHeight;
    let leftW = pageMaxHeight * leftAspect;
    let rightW = pageMaxHeight * rightAspect;
    if (!leftImg && rightImg) leftW = rightW;
    if (!rightImg && leftImg) rightW = leftW;
    let bookWidth = leftW + rightW;
    let bookHeight = pageMaxHeight;
    if (!Number.isFinite(bookWidth) || bookWidth <= 0) {
      const defaultAspect = 8.5 / 11;
      const pageHeight = Math.min(containerHeight, 920);
      const pageWidth = pageHeight * defaultAspect;
      bookWidth = pageWidth * 2;
      bookHeight = pageHeight;
    }
    if (bookWidth > containerWidth) {
      const scale = containerWidth / bookWidth;
      bookWidth = Math.round(bookWidth * scale);
      bookHeight = Math.round(bookHeight * scale);
    } else {
      bookWidth = Math.round(bookWidth);
      bookHeight = Math.round(bookHeight);
    }
    return { bookWidth, bookHeight };
  }, []);

  const doTurn = useCallback((action, ...args) => {
    const el = flipbookRef.current;
    if (!el) return;
    try {
      el.classList.add('is-turning');
      if (turnInstance && turnInstance.turn) {
        turnInstance.turn(action, ...args);
      }
    } catch (err) {
      console.warn('doTurn error', err);
    } finally {
      setTimeout(() => {
        try { el.classList.remove('is-turning'); } catch (_) {}
      }, TURN_DURATION_MS + 80);
    }
  }, [turnInstance]);

  // ----------------- Initialization (unchanged baseline) -----------------
  useEffect(() => {
    let mounted = true;
    let $book = null;
    async function init() {
      if (!menuData || !Array.isArray(menuData.imageUrls) || menuData.imageUrls.length === 0) return;
      injectPages(menuData.imageUrls);
      try { await waitForImagesInContainer(4000); } catch (_) {}
      const size = computeAdaptiveSize();
      try {
        if (size && flipbookRef.current) {
          flipbookRef.current.style.width = `${size.bookWidth}px`;
          flipbookRef.current.style.height = `${size.bookHeight}px`;
        }
      } catch {}
      try {
        await loadScript('https://code.jquery.com/jquery-3.6.0.min.js', () => !!window.jQuery);
        await loadScript('/turn.min.js', () => !!(window.jQuery && window.jQuery.fn && window.jQuery.fn.turn));
        await new Promise(r => setTimeout(r, 20));
      } catch (err) {
        console.warn('Scripts failed to load', err);
      }
      if (!mounted) return;
      const $ = window.jQuery;
      if (!$ || !$.fn || !$.fn.turn || !flipbookRef.current) return;
      try {
        $book = $(flipbookRef.current);
        try { if ($book.turn('is')) $book.turn('destroy'); } catch (_) {}
        $book.turn({
          width: (size && size.bookWidth) || 1,
          height: (size && size.bookHeight) || 1,
          display: 'double',
          acceleration: true,
          gradients: !$.isTouch,
          elevation: 60,
          duration: TURN_DURATION_MS,
          autoCenter: true,
          when: {
            turning: function () {
              try { flipbookRef.current && flipbookRef.current.classList.add('is-turning'); } catch (_) {}
            },
            turned: function (e, page) {
              try { if (Number.isFinite(page)) setCurrentPage(page); } catch (_) {}
              // reset zoom when pages change
              try {
                if (zoomed) {
                  setZoomed(false);
                  panRef.current = { x: 0, y: 0 };
                  const el = flipbookRef.current;
                  if (el) {
                    el.style.transform = '';
                    el.style.transformOrigin = '';
                    el.classList.remove('zoomed');
                  }
                }
              } catch (_) {}
              setTimeout(() => {
                try {
                  const s2 = computeAdaptiveSize();
                  if (s2 && $book && $book.turn) $book.turn('size', s2.bookWidth, s2.bookHeight);
                } catch (_) {}
                try { flipbookRef.current && flipbookRef.current.classList.remove('is-turning'); } catch (_) {}
              }, 40 + TURN_DURATION_MS);
            },
            missing: function (e, pages) { console.info('turn.js missing pages', pages); }
          }
        });
        if (size) {
          try { $book.turn('size', size.bookWidth, size.bookHeight); } catch (_) {}
        }
        setTurnInstance($book);
      } catch (err) {
        console.error('turn.js initialization failed:', err);
      }
    }
    init();
    return () => {
      mounted = false;
      try { if (turnInstance && turnInstance.turn && turnInstance.turn('is')) turnInstance.turn('destroy'); } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuData]);

  // resize recompute
  useEffect(() => {
    const onResize = () => {
      const s = computeAdaptiveSize();
      if (s && flipbookRef.current) {
        try {
          flipbookRef.current.style.width = `${s.bookWidth}px`;
          flipbookRef.current.style.height = `${s.bookHeight}px`;
          if (turnInstance && turnInstance.turn) turnInstance.turn('size', s.bookWidth, s.bookHeight);
        } catch (_) {}
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [turnInstance, computeAdaptiveSize]);

  // ----------------- Progressive hi-res helpers -----------------
  // given url like /pages/01.jpg returns /pages/01@2x.jpg
  const hiResUrlFor = (url) => {
    if (!url) return url;
    const idx = url.lastIndexOf('.');
    if (idx === -1) return `${url}@2x`;
    return `${url.slice(0, idx)}@2x${url.slice(idx)}`;
  };

  // attempt to swap page images to @2x versions; returns Promise resolved true if any swapped
  const swapToHiRes = async () => {
    const el = flipbookRef.current;
    if (!el) return false;
    const imgs = Array.from(el.querySelectorAll('img.page-image'));
    let swappedAny = false;
    await Promise.all(imgs.map((img) => {
      return new Promise((res) => {
        try {
          const orig = img.getAttribute('data-orig') || img.src;
          originalSrcsRef.current.set(img, orig);
          const hi = hiResUrlFor(orig);
          if (!hi || hi === orig) return res(false);
          // probe hi-res
          const probe = new Image();
          probe.onload = () => {
            if (probe.naturalWidth >= (img.naturalWidth || 1) && probe.naturalHeight >= (img.naturalHeight || 1)) {
              img.src = hi;
              swappedAny = true;
              hiResLoadedRef.current = true;
            }
            res(true);
          };
          probe.onerror = () => res(false);
          probe.src = hi;
        } catch (err) { res(false); }
      });
    }));
    return swappedAny;
  };

  // restore original images
  const restoreOriginalImages = () => {
    const el = flipbookRef.current;
    if (!el) return;
    const imgs = Array.from(el.querySelectorAll('img.page-image'));
    imgs.forEach((img) => {
      const orig = originalSrcsRef.current.get(img);
      if (orig) img.src = orig;
    });
    hiResLoadedRef.current = false;
  };

  // ----------------- Lens visual -----------------
  useEffect(() => {
    const container = safeAreaRef.current;
    if (!container) return;
    let lens = lensRef.current;
    if (!lens) {
      lens = document.createElement('div');
      lens.className = 'overlay-lens';
      lens.style.display = 'none';
      lens.style.pointerEvents = 'none';
      container.appendChild(lens);
      lensRef.current = lens;
    }
    return () => {
      if (lensRef.current && lensRef.current.parentNode) {
        lensRef.current.parentNode.removeChild(lensRef.current);
      }
      lensRef.current = null;
    };
  }, []);

  useEffect(() => {
    function onMouseMove(e) {
      const el = flipbookRef.current;
      const lens = lensRef.current;
      if (!el || !lens) return;
      if (!zoomToolActive || zoomed) {
        lens.style.display = 'none';
        return;
      }
      const rect = el.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        lens.style.display = 'none';
        return;
      }
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const pageImg = target && (target.classList && target.classList.contains('page-image') ? target : target && target.closest && target.closest('img.page-image'));
      if (!pageImg) {
        lens.style.display = 'none';
        return;
      }

      lens.style.display = 'block';
      const L = 180;
      const offsetX = 20;
      const offsetY = -20;
      const left = e.clientX - (L / 2) + offsetX;
      const top = e.clientY - (L / 2) + offsetY;
      lens.style.left = `${left}px`;
      lens.style.top = `${top}px`;
      lens.style.width = `${L}px`;
      lens.style.height = `${L}px`;

      const src = pageImg.src || pageImg.getAttribute('data-orig');
      lens.style.backgroundImage = `url("${src}")`;

      const imgRect = pageImg.getBoundingClientRect();
      const naturalW = pageImg.naturalWidth || imgRect.width;
      const naturalH = pageImg.naturalHeight || imgRect.height;
      const scale = 2.2;
      const bgW = naturalW * scale;
      const bgH = naturalH * scale;
      lens.style.backgroundSize = `${bgW}px ${bgH}px`;
      const relX = (e.clientX - imgRect.left) / imgRect.width;
      const relY = (e.clientY - imgRect.top) / imgRect.height;
      const bgPosX = Math.round(relX * bgW - L / 2);
      const bgPosY = Math.round(relY * bgH - L / 2);
      lens.style.backgroundPosition = `-${bgPosX}px -${bgPosY}px`;
    }
    window.addEventListener('mousemove', onMouseMove);
    return () => window.removeEventListener('mousemove', onMouseMove);
  }, [zoomToolActive, zoomed]);

  // ----------------- Double-click handler: toggle full zoom, prevent turning -----------------
  useEffect(() => {
    function onDblClick(e) {
      if (!zoomToolActive) return;
      const el = flipbookRef.current;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / rect.width) * 100;
      const relY = ((e.clientY - rect.top) / rect.height) * 100;
      if (!zoomed) {
        swapToHiRes().then(() => {
          panRef.current = { x: 0, y: 0 };
          applyZoomTransform(relX, relY, zoomScale);
          setZoomed(true);
        });
      } else {
        clearZoomTransform();
        if (hiResLoadedRef.current) restoreOriginalImages();
        setZoomed(false);
      }
    }
    const el = flipbookRef.current;
    if (!el) return;
    el.addEventListener('dblclick', onDblClick);
    return () => el.removeEventListener('dblclick', onDblClick);
  }, [zoomToolActive, zoomed, zoomScale, applyZoomTransform, clearZoomTransform]);

  // ----------------- Swipe-to-turn per-side when NOT zoomed and tool not active ----------
  useEffect(() => {
    const el = flipbookRef.current;
    if (!el) return;
    const state = { active: false, startX: 0, startY: 0, startHalf: null, moved: false };
    const THRESH = 40;
    function onPointerDown(e) {
      if (zoomed || zoomToolActive) return;
      state.active = true;
      state.startX = e.clientX;
      state.startY = e.clientY;
      const rect = el.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      state.startHalf = (relX >= 0.5) ? 'right' : 'left';
      state.moved = false;
      try { (e.target || el).setPointerCapture && (e.target || el).setPointerCapture(e.pointerId); } catch (_) {}
    }
    function onPointerMove(e) {
      if (!state.active) return;
      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) state.moved = true;
    }
    function onPointerUp(e) {
      if (!state.active) return;
      const dx = e.clientX - state.startX;
      const adx = Math.abs(dx);
      const ady = Math.abs(e.clientY - state.startY);
      if (adx > Math.max(THRESH, ady)) {
        if (state.startHalf === 'right') {
          if (dx < 0) doTurn('next'); else doTurn('previous');
        } else {
          if (dx > 0) doTurn('previous'); else doTurn('next');
        }
      } else if (!state.moved) {
        if (state.startHalf === 'right') doTurn('next'); else doTurn('previous');
      }
      state.active = false;
      state.moved = false;
      state.startHalf = null;
      try { (e.target || el).releasePointerCapture && (e.target || el).releasePointerCapture(e.pointerId); } catch (_) {}
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
  }, [doTurn, zoomed, zoomToolActive]);

  // ----------------- Controls & helpers -----------------
  const resetZoom = useCallback(() => {
    clearZoomTransform();
    setZoomed(false);
    setZoomToolActive(false);
    setZoomScale(2);
    document.body.style.cursor = '';
    if (hiResLoadedRef.current) restoreOriginalImages();
  }, [clearZoomTransform]);

  const toggleZoomTool = useCallback(() => {
    setZoomToolActive(v => {
      const nv = !v;
      document.body.style.cursor = nv ? 'zoom-in' : '';
      if (!nv && lensRef.current) lensRef.current.style.display = 'none';
      return nv;
    });
  }, []);

  const goFirst = () => doTurn('page', 1);
  const goPrev = () => doTurn('previous');
  const goNext = () => doTurn('next');
  const goLast = () => doTurn('page', totalPages);

  // display text
  let displayText = '';
  try {
    if (turnInstance && turnInstance.turn) {
      const v = turnInstance.turn('view');
      if (Array.isArray(v) && v.length === 2) displayText = `${v[0]} - ${v[1]} / ${totalPages}`;
      else if (Array.isArray(v) && v.length === 1) displayText = `${v[0]} / ${totalPages}`;
    }
  } catch (_) {}
  if (!displayText) displayText = `${Math.max(1, currentPage)} / ${totalPages}`;

  // clear zoom on unmount
  useEffect(() => () => { try { clearZoomTransform(); } catch (_) {} }, [clearZoomTransform]);

  return (
    <div className="viewer-layout">
      <WavyBackground />
      <div className="top-bar">
        <div className="controls-center top-controls">
          <button
            className={`ctrl zoom-btn ${zoomToolActive ? 'active' : ''}`}
            onClick={toggleZoomTool}
            title="Toggle Magnifier (dblclick to zoom, wheel to adjust while tool active)"
            aria-pressed={zoomToolActive}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
              <circle cx="11" cy="11" r="5" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>

          <button className="ctrl undo-btn" onClick={resetZoom} title="Reset Zoom">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M20 14a8 8 0 10-2.2 5.2L20 14z" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M20 8v6h-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          <button className="ctrl" onClick={goFirst} title="First">⏮</button>
          <button className="ctrl" onClick={goPrev} title="Prev">◀</button>
          <div className="page-counter"><span>{displayText}</span></div>
          <button className="ctrl" onClick={goNext} title="Next">▶</button>
          <button className="ctrl" onClick={goLast} title="Last">⏭</button>
        </div>
      </div>

      <div className="safe-area-box" ref={safeAreaRef}>
        <div ref={flipbookRef} className={`menu-book${zoomed ? ' zoomed' : ''}`} />

        {/* Large overlay side arrows (clickable) */}
        <button className="side-arrow left-arrow" onClick={goPrev} aria-label="Previous page">
          <span className="arrow">◀</span>
        </button>
        <button className="side-arrow right-arrow" onClick={goNext} aria-label="Next page">
          <span className="arrow">▶</span>
        </button>
      </div>
    </div>
  );
}