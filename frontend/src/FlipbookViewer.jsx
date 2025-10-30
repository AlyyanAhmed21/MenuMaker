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
  Updated FlipbookViewer:

  - Uses an injection approach (we set flipbookRef.current.innerHTML) so turn.js
    can own the page DOM nodes without React/turn DOM conflicts (prevents HierarchyRequestError).
  - Waits for images to load before initializing turn.js, ensuring turn has the correct page sizes.
  - Ensures an even number of pages for display:'double' by adding a blank page at the end if needed.
  - Computes adaptive two-page book width from the natural image sizes (fits to available height),
    scales down if necessary, and calls turn('size', bookWidth, bookHeight) so pages meet at the spine.
  - Guards every external call and logs errors instead of throwing.
*/

export default function FlipbookViewer({ menuData }) {
  const flipbookRef = useRef(null);
  const safeAreaRef = useRef(null);
  const [turnInstance, setTurnInstance] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = (menuData && Array.isArray(menuData.imageUrls)) ? menuData.imageUrls.length : 0;
  const TURN_DURATION_MS = 1100;

  // Build static page markup and inject into the container (turn.js will own these DOM nodes)
  const injectPages = useCallback((urls) => {
    if (!flipbookRef.current) return;
    const nodes = (urls || []).map((u, i) => {
      const src = `${API_URL}${u}`;
      // Use background-image style or an <img> child; background keeps markup light.
      return `<div class="page" data-page="${i + 1}"><img class="page-image" src="${src}" draggable="false" /></div>`;
    });

    // Ensure even count for display:'double' (keep first content on the right by appending a blank page)
    if (nodes.length % 2 === 1) {
      // append blank page at the end
      nodes.push('<div class="page blank-page" data-page="blank"></div>');
    }

    // Replace container's children atomically
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
    // Determine the two pages currently visible (left/right) according to data-page or order.
    // When initializing, just consider the first two non-blank images.
    let leftImg = imgs[0] || null;
    let rightImg = imgs[1] || null;
    // Fallbacks
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

    // If one side missing, mirror the other so the single page sits correctly
    if (!leftImg && rightImg) leftW = rightW;
    if (!rightImg && leftImg) rightW = leftW;

    let bookWidth = leftW + rightW;
    let bookHeight = pageMaxHeight;

    // Scale down proportionally when wider than container
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

  // Initialize turn.js after injecting pages and ensuring images loaded
  useEffect(() => {
    let mounted = true;
    let $book = null;

    async function init() {
      if (!menuData || !Array.isArray(menuData.imageUrls) || menuData.imageUrls.length === 0) {
        // Nothing to show
        return;
      }

      // 1) Inject pages into the container (plain DOM children — avoids React/turn conflicts)
      injectPages(menuData.imageUrls);

      // 2) Wait for those page images to load so we can measure natural sizes
      try {
        await waitForImagesInContainer(4000);
      } catch (_) { /* timeout — proceed anyway */ }

      // 3) Compute an adaptive size and apply as initial wrapper size so turn doesn't create large gaps
      const size = computeAdaptiveSize();
      try {
        if (size && flipbookRef.current) {
          flipbookRef.current.style.width = `${size.bookWidth}px`;
          flipbookRef.current.style.height = `${size.bookHeight}px`;
        }
      } catch (err) { /* ignore */ }

      // 4) Load jQuery and turn.js sequentially
      try {
        await loadScript('https://code.jquery.com/jquery-3.6.0.min.js', () => !!window.jQuery);
        await loadScript('/turn.min.js', () => !!(window.jQuery && window.jQuery.fn && window.jQuery.fn.turn));
        // allow plugin to attach
        await new Promise(r => setTimeout(r, 20));
      } catch (err) {
        console.warn('Script load failed:', err);
      }

      if (!mounted) return;
      const $ = window.jQuery;
      if (!$ || !$.fn || !$.fn.turn || !flipbookRef.current) {
        // plugin not present, leave static pages
        return;
      }

      try {
        $book = $(flipbookRef.current);

        // Destroy previous instance safely
        try { if ($book.turn('is')) $book.turn('destroy'); } catch (_) {}

        // Initialize with the computed size (avoid calling turn('addPage') etc. — we let it use the children)
        const opts = {
          width: (size && size.bookWidth) || 1,
          height: (size && size.bookHeight) || 1,
          display: 'double',
          acceleration: true,
          gradients: !$.isTouch,
          elevation: 50,
          duration: TURN_DURATION_MS,
          autoCenter: true,
          when: {
            turned: function (e, page) {
              try {
                if (Number.isFinite(page)) setCurrentPage(page);
              } catch (err) { /* ignore */ }
              // recompute sizes after turn completes (small delay)
              setTimeout(() => {
                try {
                  const s2 = computeAdaptiveSize();
                  if (s2 && $book && $book.turn) $book.turn('size', s2.bookWidth, s2.bookHeight);
                } catch (_) { /* ignore */ }
              }, 40);
            },
            missing: function (e, pages) {
              console.info('turn.js requested missing pages', pages);
            }
          }
        };

        // Initialize turn with the prepared children
        $book.turn(opts);

        // Apply final size again to be safe
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

  // Resize handler: recompute adaptively when the window / container changes
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
      if (e.key === 'ArrowLeft') {
        try { if (turnInstance && turnInstance.turn) turnInstance.turn('previous'); } catch (_) {}
      } else if (e.key === 'ArrowRight') {
        try { if (turnInstance && turnInstance.turn) turnInstance.turn('next'); } catch (_) {}
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turnInstance]);

  // Pointer tap/swipe simple handlers (leave dragging/peel to turn.js)
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
        if (dx < 0) try { if (turnInstance && turnInstance.turn) turnInstance.turn('next'); } catch(_) {}
        else try { if (turnInstance && turnInstance.turn) turnInstance.turn('previous'); } catch(_) {}
      } else if (!s.moved) {
        const rect = el.getBoundingClientRect(); const relX = (e.clientX - rect.left) / rect.width;
        if (relX < 0.5) try { if (turnInstance && turnInstance.turn) turnInstance.turn('previous'); } catch(_) {}
        else try { if (turnInstance && turnInstance.turn) turnInstance.turn('next'); } catch(_) {}
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
  }, [turnInstance]);

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

  return (
    <div className="viewer-layout">
      <WavyBackground />
      <div className="top-bar" />
      <div className="safe-area-box" ref={safeAreaRef}>
        <div ref={flipbookRef} className="menu-book" />
      </div>

      <div className="overlay-controls">
        <div className="controls-center top-controls">
          <button className="ctrl" onClick={() => { try { if (turnInstance && turnInstance.turn) turnInstance.turn('page', 1); } catch (_) {} }}>⏮</button>
          <button className="ctrl" onClick={() => { try { if (turnInstance && turnInstance.turn) turnInstance.turn('previous'); } catch (_) {} }}>◀</button>
          <div className="page-counter"><span>{displayText}</span></div>
          <button className="ctrl" onClick={() => { try { if (turnInstance && turnInstance.turn) turnInstance.turn('next'); } catch (_) {} }}>▶</button>
          <button className="ctrl" onClick={() => { try { if (turnInstance && turnInstance.turn) turnInstance.turn('page', totalPages); } catch (_) {} }}>⏭</button>
        </div>
      </div>
    </div>
  );
}