import { useEffect, useRef } from 'react';

// `html` is rendered and sanitised by the Python backend (nh3), never built from user input here.
// Each code block gets a Copy button.
export default function Prose({ html }) {
  const ref = useRef(null);

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
  }, [html]);

  const onClick = async (e) => {
    const btn = e.target.closest('.copy-code');
    if (!btn) return;
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

  return <div ref={ref} className="prose" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
}
