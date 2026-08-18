import '@testing-library/jest-dom/vitest'

import { initI18n } from '../src/i18n'

// jsdom has no matchMedia; the theme store asks for it on every render.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
}

// jsdom has no layout, so it has no `scrollIntoView` either; components that
// keep a thread pinned to its last message call it on every render.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

await initI18n('ca')
