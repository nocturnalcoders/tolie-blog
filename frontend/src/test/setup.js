import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  document.documentElement.setAttribute('data-theme', 'night');
  localStorage.clear();
});

// jsdom has no scrolling
window.scrollTo = () => {};
