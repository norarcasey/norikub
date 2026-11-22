import { auth } from '../supabase/client.ts';
import { AccountPanel } from './AccountPanel.tsx';
import { accountOf } from './port.ts';

/**
 * The panel wired to the real client. Its own module so App can load it lazily: auth-js
 * stays off the first paint, and is never loaded at all by a build without the Supabase
 * values (App checks `env` before offering the button that imports this).
 */
const live = accountOf(auth);

export default function LiveAccountPanel({ onClose }: { readonly onClose: () => void }) {
  return <AccountPanel account={live} onClose={onClose} />;
}
