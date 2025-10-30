import React, { useEffect, useRef, useState, useCallback } from "react";
import "./FlipbookCanvasViewer.css";

const API_URL = "http://localhost:3001";
const H_PADDING = 40;
const TOP_PADDING = 8;
const GUTTER = 12;
const MIN_PAGE_WIDTH = 320;
const MIN_PAGE_HEIGHT = 420;

// utility: resolve candidate URLs
function resolveCandidates(path) {
  if (!path) return [];
  if (/^https?:\/\//.test(path) || path.startsWith("//")) return [path];
  return [`${API_URL}${path}`, path];
}

// preload an image and return { ok, url, w, h }
function preloadOne(path) {
  return new Promise((resolve) => {
    const cands = resolveCandidates(path);
    let i = 0;
    const tryNext = () => {
      if (i >= cands.length) return resolve({ ok: false, url: null, w: 0, h: 0 });
      const url = cands[i++];
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve({ ok: true, url, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
      img.onerror = tryNext;
      img.src = url;
    };
    tryNext();
  });
}

export default function FlipbookCanvasViewer({ menuData = { imageUrls: [] }, onZoomRequest = null }) {
  const imageUrls = menuData.imageUrls || [];
  const rootRef = useRef(null);
  const containerRef = useRef(null); // <-- FIX: previously missing
  const pageFlipRef = useRef(null);
  const retryTimer = useRef(null);

  const [preloaded, setPreloaded] = useState([]);
  const [spreads, setSpreads] = useState([]); // each spread: { left, right, layout }
  const [spreadSize, setSpreadSize] = useState({ width: 900, height: 700 });
  const [currentSpread, setCurrentSpread] = useState(0);
  const [engineAvailable, setEngineAvailable] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("idle");

  // compute available height (window height minus bottom bar)
  const computeAvailableHeight = useCallback(() => {
    const winH = window.innerHeight || 800;
    const bottomBar = document.querySelector(".bottom-bar");
    const bottomH = bottomBar ? bottomBar.clientHeight : 86;
    const reserved = bottomH + 12 + TOP_PADDING;
    const avail = Math.max(MIN_PAGE_HEIGHT, winH - reserved);
    return { availHeight: avail, bottomBarHeight: bottomH };
  }, []);

  // build spreads from preloaded pages: cover (left=null,right=page1), then pairs
  const buildSpreads = useCallback((imgs) => {
    if (!imgs || imgs.length === 0) return [];
    const out = [];
    out.push({ left: null, right: imgs[0] });
    for (let i = 1; i < imgs.length; i += 2) {
      out.push({ left: imgs[i] || null, right: imgs[i + 1] || null });
    }
    return out;
  }, []);

  // compute layout per spread so pages sit flush and share a height
  const computeLayouts = useCallback(
    (spreadsIn) => {
      const { availHeight } = computeAvailableHeight();
      const winW = window.innerWidth || 1200;
      const maxContainerW = Math.max(480, winW - H_PADDING);

      // pick a reasonable singlePageWidth as median of scaled natural widths
      const samples = [];
      spreadsIn.forEach((s) => {
        if (s.left && s.left.ok && s.left.h) samples.push(Math.round((s.left.w / s.left.h) * availHeight));
        if (s.right && s.right.ok && s.right.h) samples.push(Math.round((s.right.w / s.right.h) * availHeight));
      });
      let singlePageW = samples.length ? samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)] : Math.floor(maxContainerW / 2);
      singlePageW = Math.max(MIN_PAGE_WIDTH, Math.min(singlePageW, Math.floor(maxContainerW / 1.6)));

      const layouts = spreadsIn.map((s, idx) => {
        if (idx === 0) {
          const leftW = singlePageW;
          const rightW = singlePageW;
          const totalW = leftW + rightW + GUTTER;
          return { leftW, rightW, gutter: GUTTER, totalW, height: availHeight };
        }
        const lw = s.left && s.left.ok && s.left.h ? Math.round((s.left.w / s.left.h) * availHeight) : singlePageW;
        const rw = s.right && s.right.ok && s.right.h ? Math.round((s.right.w / s.right.h) * availHeight) : singlePageW;
        let preferred = lw + rw + GUTTER;
        const scale = preferred <= maxContainerW ? 1 : maxContainerW / preferred;
        const leftW = Math.max(MIN_PAGE_WIDTH, Math.round(lw * scale));
        const rightW = Math.max(MIN_PAGE_WIDTH, Math.round(rw * scale));
        const totalW = leftW + rightW + GUTTER;
        const height = Math.round(availHeight * scale);
        return { leftW, rightW, gutter: GUTTER, totalW, height };
      });

      const containerW = Math.min(maxContainerW, Math.max(...layouts.map((l) => l.totalW)));
      const containerH = Math.max(...layouts.map((l) => l.height));
      return { layouts, containerW, containerH };
    },
    [computeAvailableHeight]
  );

  // preload all images on mount / when imageUrls change
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!imageUrls || imageUrls.length === 0) {
        setPreloaded([]);
        setSpreads([]);
        setLoadingMessage("No pages provided");
        return;
      }
      setLoadingMessage("Preloading images...");
      const results = await Promise.all(imageUrls.map((p) => preloadOne(p)));
      if (!mounted) return;
      setPreloaded(results);
      setLoadingMessage(`Loaded ${results.filter((r) => r.ok).length}/${imageUrls.length}`);
      const built = buildSpreads(results);
      const { layouts, containerW, containerH } = computeLayouts(built);
      const withLayouts = built.map((s, i) => ({ ...s, layout: layouts[i] || { leftW: 0, rightW: 0, totalW: containerW, height: containerH } }));
      setSpreads(withLayouts);
      setSpreadSize({ width: containerW, height: containerH });

      // enforce container width so only one spread visible
      if (containerRef.current) {
        const appliedW = Math.min(window.innerWidth - H_PADDING, containerW + 40);
        containerRef.current.style.width = `${appliedW}px`;
        containerRef.current.style.maxWidth = `${appliedW}px`;
      }

      // try init engine shortly after layout applied
      setTimeout(() => {
        tryInitEngine(withLayouts, { width: containerW, height: containerH });
      }, 60);
    })();
    return () => (mounted = false);
  }, [imageUrls, buildSpreads, computeLayouts]);

  // tries to initialize PageFlip engine (dynamic import). graceful failure -> fallback
  const tryInitEngine = async (withLayouts, dims) => {
    // avoid re-initializing if already present
    if (pageFlipRef.current) return;
    try {
      const mod = await import("page-flip"); // dynamic import
      const { PageFlip } = mod;
      if (!PageFlip) throw new Error("PageFlip not found in module");
      const root = rootRef.current;
      if (!root) throw new Error("root not found");

      // clear root and build page DOMs
      root.innerHTML = "";
      const pages = [];
      withLayouts.forEach((s, idx) => {
        const pageEl = document.createElement("div");
        pageEl.className = "pf-page";
        pageEl.style.width = `${dims.width}px`;
        pageEl.style.height = `${dims.height}px`;

        const inner = document.createElement("div");
        inner.style.display = "flex";
        inner.style.width = "100%";
        inner.style.height = "100%";
        inner.style.alignItems = "center";
        inner.style.justifyContent = "center";

        if (idx === 0) {
          const leftBlank = document.createElement("div");
          leftBlank.style.flex = "0 0 " + Math.max(40, Math.round(s.layout.totalW * 0.45)) + "px";
          const right = document.createElement("div");
          right.style.flex = "0 0 " + s.layout.rightW + "px";
          right.style.display = "flex";
          right.style.alignItems = "center";
          right.style.justifyContent = "center";
          if (s.right && s.right.ok) {
            const img = document.createElement("img");
            img.crossOrigin = "anonymous";
            img.src = s.right.url;
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "contain";
            img.draggable = false;
            img.addEventListener("dblclick", () => onZoomRequest && onZoomRequest(1));
            right.appendChild(img);
          } else {
            const ph = document.createElement("div");
            ph.className = "page-placeholder-inner";
            ph.innerText = "Missing";
            right.appendChild(ph);
          }
          inner.appendChild(leftBlank);
          inner.appendChild(right);
        } else {
          const leftWrap = document.createElement("div");
          leftWrap.style.flex = "0 0 " + s.layout.leftW + "px";
          leftWrap.style.display = "flex";
          leftWrap.style.alignItems = "center";
          leftWrap.style.justifyContent = "center";
          if (s.left && s.left.ok) {
            const img = document.createElement("img");
            img.crossOrigin = "anonymous";
            img.src = s.left.url;
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "contain";
            img.draggable = false;
            const leftIndex = 2 + (idx - 1) * 2;
            img.addEventListener("dblclick", () => onZoomRequest && onZoomRequest(leftIndex));
            leftWrap.appendChild(img);
          } else {
            const ph = document.createElement("div");
            ph.className = "page-placeholder-inner";
            ph.innerText = "Missing";
            leftWrap.appendChild(ph);
          }

          const rightWrap = document.createElement("div");
          rightWrap.style.flex = "0 0 " + s.layout.rightW + "px";
          rightWrap.style.display = "flex";
          rightWrap.style.alignItems = "center";
          rightWrap.style.justifyContent = "center";
          if (s.right && s.right.ok) {
            const img = document.createElement("img");
            img.crossOrigin = "anonymous";
            img.src = s.right.url;
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "contain";
            img.draggable = false;
            const leftIndex = 2 + (idx - 1) * 2;
            const rightIndex = Math.min(preloaded.length, leftIndex + 1);
            img.addEventListener("dblclick", () => onZoomRequest && onZoomRequest(rightIndex));
            rightWrap.appendChild(img);
          } else {
            const ph = document.createElement("div");
            ph.className = "page-placeholder-inner";
            ph.innerText = "Missing";
            rightWrap.appendChild(ph);
          }

          inner.appendChild(leftWrap);
          inner.appendChild(rightWrap);
        }

        pageEl.appendChild(inner);
        pages.push(pageEl);
        root.appendChild(pageEl);
      });

      // instantiate PageFlip engine
      const pf = new PageFlip(root, {
        width: dims.width,
        height: dims.height,
        size: "fixed",
        showCover: false,
        drawShadow: true,
        flippingTime: 800,
        usePortrait: false,
        startPage: 0,
        maxShadowOpacity: 0.5,
      });

      try {
        pf.loadFromHtml(root);
      } catch (e) {
        if (typeof pf.loadFromImages === "function") {
          const imgUrls = preloaded.map((p) => (p.ok ? p.url : ""));
          await pf.loadFromImages(imgUrls);
        }
      }

      // wire events
      pf.on("flip", (e) => {
        setCurrentSpread(e.data);
      });

      pageFlipRef.current = pf;
      setEngineAvailable(true);
      setLoadingMessage("Animated engine ready");

      try { pf.flip(0); } catch (err) {}
    } catch (err) {
      console.warn("PageFlip init failed:", err);
      setEngineAvailable(false);
      setLoadingMessage("Animated engine unavailable (fallback active)");
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => {
        tryInitAgain(withLayouts, dims);
      }, 800);
    }
  };

  // retry helper
  const tryInitAgain = async (withLayouts, dims) => {
    if (pageFlipRef.current) return;
    try {
      await tryInitEngine(withLayouts, dims);
    } catch (e) {
      retryTimer.current = setTimeout(() => tryInitAgain(withLayouts, dims), 1200);
    }
  };

  // controls
  const goNext = async () => {
    if (engineAvailable && pageFlipRef.current) {
      try { pageFlipRef.current.flipNext(); return; } catch (e) { console.warn("flipNext failed:", e); }
    }
    setCurrentSpread((s) => Math.min(spreads.length - 1, (s || 0) + 1));
  };
  const goPrev = async () => {
    if (engineAvailable && pageFlipRef.current) {
      try { pageFlipRef.current.flipPrev(); return; } catch (e) { console.warn("flipPrev failed:", e); }
    }
    setCurrentSpread((s) => Math.max(0, (s || 0) - 1));
  };
  const resetCover = async () => {
    if (engineAvailable && pageFlipRef.current) {
      try { pageFlipRef.current.flip(0); setCurrentSpread(0); return; } catch (e) { console.warn("reset flip failed:", e); }
    }
    setCurrentSpread(0);
  };

  // keep DOM synchronized when using fallback static mode
  useEffect(() => {
    if (!engineAvailable && rootRef.current && spreads.length) {
      Array.from(rootRef.current.children).forEach((child, i) => {
        child.style.display = i === currentSpread ? "flex" : "none";
      });
    }
  }, [currentSpread, engineAvailable, spreads.length]);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (pageFlipRef.current && typeof pageFlipRef.current.destroy === "function") {
        try { pageFlipRef.current.destroy(); } catch (e) {}
      }
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  return (
    <div className="canvas-viewer-layout">
      <div className="safe-area-box">
        <div className="book-container" ref={containerRef} style={{ height: `calc(100vh - 96px)` }}>
          <div className="book-top-spacer" />
          <div className="pageflip-root-wrapper" style={{ height: `${Math.max(MIN_PAGE_HEIGHT, spreadSize.height)}px`, overflow: "hidden" }}>
            {/* Root container where we inject per-spread DOM nodes for the engine */}
            <div id="pageflip-root" ref={rootRef} className="pageflip-root" />
          </div>
        </div>
      </div>

      <div className="controls-bar">
        <div className="controls-left">
          <button onClick={() => (engineAvailable ? pageFlipRef.current?.flip(0) : resetCover())}>Reset</button>
        </div>
        <div className="controls-center">
          <button onClick={goPrev}>◀</button>
          <span className="counter">{engineAvailable ? `${Math.max(1, currentSpread)} / ${preloaded.length}` : `${Math.max(1, currentSpread)} / ${preloaded.length}`}</span>
          <button onClick={goNext}>▶</button>
        </div>
        <div className="controls-right"></div>
      </div>
    </div>
  );
}