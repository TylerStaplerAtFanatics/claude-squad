require('@testing-library/jest-dom');

// Global mock for Next.js navigation hooks (not available in jsdom)
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn(), back: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

// Global mock for ThemeContext — components using useTheme don't need a provider in tests
jest.mock('@/lib/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'matrix', setTheme: jest.fn() }),
  ThemeProvider: ({ children }) => children,
}));

// Polyfill TextEncoder/TextDecoder for jsdom
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Polyfill ResizeObserver for jsdom (not implemented by default)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Polyfill scrollIntoView for jsdom (not implemented by default)
window.HTMLElement.prototype.scrollIntoView = function () {};

// Polyfill window.matchMedia for jsdom (not implemented by default)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});
