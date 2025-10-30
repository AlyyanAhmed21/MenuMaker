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
  Changes in this file vs the previous working baseline:
  - Moved the overlay controls into the top bar so they are visible again.
  - Added subtle page shadows by default and a stronger shadow while a page turn is in progress.
  - Implemented a safe "doTurn" wrapper that toggles an "is-turning" CSS class on the book container
    around manual navigation calls so we can enhance the 3D/shadow effect during animations.
  - Also register turn.js 'turning' and 'turned' callbacks to add/remove the same class for plugin-driven flips.
*/

export default function FlipbookViewer({ menuData }) {
  const flipbookRef = useRef(null);
  const safeAreaRef = useRef(null);
  const [turnInstance, setTurnInstance] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = (menuData && Array.isArray(menuData.imageUrls)) ? menuData.imageUrls.length : 0;
  const TURN_DURATION_MS = 2000;

  // Build static page markup and inject into the container (turn.js will own these DOM nodes)
  const injectPages = useCallback((urls) => {
    if (!flipbookRef.current) return;
    const nodes = (urls || []).map((u, i) => {
      const src = `${API_URL}${u}`;
      return `<div class="page" data-page="${i + 1}"><img class="page-image" src="${src}" draggable="false" /></div>`;
    });

    // Ensure even count for display:'double' (append blank page if odd)
    if (nodes.length % 2 === 1) {
      nodes.push('<div class="page blank-page" data-page="blank"></div>');
    }

    flipbookRef.current.innerHTML = nodes.join('');
  }, []);

  // Wait for images inside the container to load (with timeout)
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

  // Compute adaptive book size based on natural image sizes
  const computeAdaptiveSize = useCallback(() => {
    const container = safeAreaRef.current;
    const el = flipbookRef.current;
    if (!container || !el) return null;

    const containerWidth = Math.max(320, container.clientWidth - 40);
    const containerHeight = Math.max(320, container.clientHeight - 40);

    const imgs = Array.from(el.querySelectorAll('img.page-image'));
    let leftImg = imgs[0] || null;
    let rightImg = imgs[1] || null;

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

  // Helper: add/remove turning class around manual turn actions
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
      // remove after animation duration + small buffer
      setTimeout(() => {
        try { el.classList.remove('is-turning'); } catch (_) {}
      }, TURN_DURATION_MS + 80);
    }
  }, [turnInstance]);

  // Initialize turn.js after injecting pages and ensuring images loaded
  useEffect(() => {
    let mounted = true;
    let $book = null;

    async function init() {
      if (!menuData || !Array.isArray(menuData.imageUrls) || menuData.imageUrls.length === 0) {
        return;
      }

      // 1) Inject pages
      injectPages(menuData.imageUrls);

      // 2) Wait images
      try { await waitForImagesInContainer(4000); } catch (_) {}

      // 3) Compute initial size and apply wrapper style
      const size = computeAdaptiveSize();
      try {
        if (size && flipbookRef.current) {
          flipbookRef.current.style.width = `${size.bookWidth}px`;
          flipbookRef.current.style.height = `${size.bookHeight}px`;
        }
      } catch (err) {}

      // 4) Load jQuery + turn.min.js
      try {
        await loadScript('https://code.jquery.com/jquery-3.6.0.min.js', () => !!window.jQuery);
        await loadScript('/turn.min.js', () => !!(window.jQuery && window.jQuery.fn && window.jQuery.fn.turn));
        await new Promise(r => setTimeout(r, 20));
      } catch (err) {
        console.warn('Scripts failed to load', err);
      }

      if (!mounted) return;
      const $ = window.jQuery;
      if (!$ || !$.fn || !$.fn.turn || !flipbookRef.current) {
        return;
      }

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
            turning: function (e, page, view) {
              // try adding turning class (plugin-invoked flip)
              try { flipbookRef.current && flipbookRef.current.classList.add('is-turning'); } catch (_) {}
            },
            turned: function (e, page) {
              try {
                if (Number.isFinite(page)) setCurrentPage(page);
              } catch (_) {}
              // recompute sizes after turn completes
              setTimeout(() => {
                try {
                  const s2 = computeAdaptiveSize();
                  if (s2 && $book && $book.turn) $book.turn('size', s2.bookWidth, s2.bookHeight);
                } catch (_) {}
                try { flipbookRef.current && flipbookRef.current.classList.remove('is-turning'); } catch (_) {}
              }, 40 + TURN_DURATION_MS);
            },
            missing: function (e, pages) {
              console.info('turn.js missing pages', pages);
            }
          }
        });

        // make sure shadow classes are applied
        if (flipbookRef.current) flipbookRef.current.classList.remove('is-turning');

        // apply final safe size
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
      try {
        if (turnInstance && turnInstance.turn && turnInstance.turn('is')) turnInstance.turn('destroy');
      } catch (_) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuData]);

  // Resize recompute
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

  // Keyboard nav
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') doTurn('previous');
      else if (e.key === 'ArrowRight') doTurn('next');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doTurn]);

  // Pointer handlers (use doTurn wrapper)
  useEffect(() => {
    const el = flipbookRef.current;
    if (!el) return;
    const s = { active: false, sx: 0, sy: 0, moved: false };
    const SWIPE = 50;
    function down(e) { s.active = true; s.sx = e.clientX; s.sy = e.clientY; s.moved = false; try { (e.target || el).setPointerCapture && (e.target || el).setPointerCapture(e.pointerId); } catch(_) {} }
    function move(e) { if (!s.active) return; if (Math.abs(e.clientX - s.sx) > 8 || Math.abs(e.clientY - s.sy) > 8) s.moved = true; }
    function up(e) {
      if (!s.active) return;
      const dx = e.clientX - s.sx; const adx = Math.abs(dx); const dy = Math.abs(e.clientY - s.sy);
      if (adx > Math.max(SWIPE, dy)) {
        if (dx < 0) doTurn('next'); else doTurn('previous');
      } else if (!s.moved) {
        const rect = el.getBoundingClientRect(); const relX = (e.clientX - rect.left) / rect.width;
        if (relX < 0.5) doTurn('previous'); else doTurn('next');
      }
      s.active = false; s.moved = false; try { (e.target || el).releasePointerCapture && (e.target || el).releasePointerCapture(e.pointerId); } catch(_) {}
    }
    el.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [doTurn]);

  // Page counter display
  let displayText = '';
  try {
    if (turnInstance && turnInstance.turn) {
      const v = turnInstance.turn('view');
      if (Array.isArray(v) && v.length === 2) displayText = `${v[0]} - ${v[1]} / ${totalPages}`;
      else if (Array.isArray(v) && v.length === 1) displayText = `${v[0]} / ${totalPages}`;
    }
  } catch (_) { }
  if (!displayText) displayText = `${Math.max(1, currentPage)} / ${totalPages}`;

  // Controls now live in the top bar so they remain visible
  const goFirst = () => doTurn('page', 1);
  const goPrev = () => doTurn('previous');
  const goNext = () => doTurn('next');
  const goLast = () => doTurn('page', totalPages);

  return (
    <div className="viewer-layout">
      <WavyBackground />
      <div className="top-bar">
        <div className="controls-center top-controls">
          <button className="ctrl" onClick={goFirst} title="First">⏮</button>
          <button className="ctrl" onClick={goPrev} title="Prev">◀</button>
          <div className="page-counter"><span>{displayText}</span></div>
          <button className="ctrl" onClick={goNext} title="Next">▶</button>
          <button className="ctrl" onClick={goLast} title="Last">⏭</button>
        </div>
      </div>

      <div className="safe-area-box" ref={safeAreaRef}>
        <div ref={flipbookRef} className="menu-book" />
      </div>
    </div>
  );
}