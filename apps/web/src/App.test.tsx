import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';

import { App } from './App.tsx';

// A smoke test, and the cheapest one there is: an app that throws on first render ships a
// white page, and this catches it without a browser.
it('renders without throwing', () => {
  render(<App />);
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Norikub');
});
