import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';
import { createApi, setApi } from '../api';
import { createFakeApi } from './fakeApi';

// Every test starts with a signed-out, in-memory server: nothing reaches the network.
beforeEach(() => {
  setApi(createApi(createFakeApi().fetch));
});

afterEach(() => {
  cleanup();
});

// CodeMirror measures text with Range geometry that jsdom does not implement.
if (typeof Range !== 'undefined' && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
}
if (typeof document !== 'undefined' && !document.elementFromPoint) {
  document.elementFromPoint = () => null;
}

// jsdom can't make object URLs for its own Blobs; tests only need unique strings.
let objectUrls = 0;
URL.createObjectURL = () => `blob:test/${++objectUrls}`;
URL.revokeObjectURL = () => {};

// jsdom has no scrolling; components call scrollIntoView and tests spy on it.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
