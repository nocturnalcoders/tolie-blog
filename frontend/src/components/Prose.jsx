import { useEffect, useRef, useState } from 'react';

// `html` is rendered and sanitised by the Python backend (nh3), never built from user input here.
// Code blocks get a Copy button; pictures open large when clicked.
export default function Prose({ html }) {
  const ref = useRef(null);
  const [zoom, setZoom] = useState(null); // {src, alt, from}
  const closeRef = useRef(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll('pre').forEach((pre) => {
      const block = pre.parentElement.classList.contains('codehilite') ? pre.parentElement : pre;
      if (block.parentElement.classList.contains('code-wrap')) return;
      // The button sits in a wrapper, so it stays put when a long line scrolls sideways.
      const wrap = document.createElement('div');
      wrap.className = 'code-wrap';
      block.replaceWith(wrap);
      wrap.appendChild(block);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-code';
      btn.textContent = 'Copy';
      wrap.appendChild(btn);
    });
    // Pictures that aren't links can be opened large, by mouse or keyboard.
    root.querySelectorAll('img').forEach((img) => {
      if (img.closest('a') || img.classList.contains('zoomable')) return;
      img.classList.add('zoomable');
      img.tabIndex = 0;
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', `Open picture${img.alt ? `: ${img.alt}` : ''}`);
    });
  }, [html]);

  useEffect(() => {
    if (!zoom) return undefined;
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') setZoom(null);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      zoom.from?.focus(); // back to the picture that was opened
    };
  }, [zoom]);

  const copy = async (btn) => {
    const pre = btn.parentElement.querySelector('pre');
    const code = pre.querySelector('code') || pre;
    try {
      await navigator.clipboard.writeText(code.textContent.replace(/\n$/, ''));
      btn.textContent = 'Copied';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(code);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      btn.textContent = 'Press Ctrl+C';
    }
    setTimeout(() => {
      btn.textContent = 'Copy';
    }, 1800);
  };

  const onClick = (e) => {
    const btn = e.target.closest('.copy-code');
    if (btn) copy(btn);
    const img = e.target.closest('img.zoomable');
    if (img) setZoom({ src: img.currentSrc || img.src, alt: img.alt, from: img });
  };

  const onKeyDown = (e) => {
    const img = e.target.closest && e.target.closest('img.zoomable');
    if (img && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setZoom({ src: img.currentSrc || img.src, alt: img.alt, from: img });
    }
  };

  return (
    <>
      <div ref={ref} className="prose" onClick={onClick} onKeyDown={onKeyDown} dangerouslySetInnerHTML={{ __html: html }} />
      {zoom && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={zoom.alt || 'Picture'} onClick={() => setZoom(null)}>
          <img src={zoom.src} alt={zoom.alt} onClick={(e) => e.stopPropagation()} />
          {zoom.alt && <p className="lightbox-caption">{zoom.alt}</p>}
          <button ref={closeRef} type="button" className="lightbox-close" onClick={() => setZoom(null)}>Close</button>
        </div>
      )}
    </>
  );
}
