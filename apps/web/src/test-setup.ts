import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library unmounts after each test by itself only when Vitest's globals are on, and
// they are off here so every test imports what it uses. Without this, the second test in a
// file queries a DOM still holding the first one's render.
afterEach(cleanup);
