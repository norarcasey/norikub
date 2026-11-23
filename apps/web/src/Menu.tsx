import { useEffect } from 'react';
import type { ReactNode } from 'react';

import './menu.css';

/**
 * The game bar's one way to everything that is not the game (Nora, KUB-50): New game, the way
 * back to a friends' table, and Account were four pills in the bar, and on a phone they took
 * the room the opponents' names needed. Three short lines, so it reads as a menu at a glance.
 */
export function MenuButton({
  open,
  onOpen,
}: {
  readonly open: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="menu-open"
      aria-label="Menu"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onOpen}
    >
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
        <path
          d="M3 5h14M3 10h14M3 15h14"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/**
 * A panel in from the right, the side the button is on. A tap on the veil, Escape or the
 * close button shuts it; picking an item is the item's own business, and the caller closes
 * the drawer as it opens what was picked.
 */
export function MenuDrawer({
  onClose,
  children,
}: {
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="menu-veil"
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <nav className="menu-drawer" aria-label="Norikub">
        <button type="button" className="menu-close" aria-label="Close menu" onClick={onClose}>
          ×
        </button>
        {children}
      </nav>
    </div>
  );
}
