import { useUpdateReady } from './updates.ts';

/**
 * A newer build has taken over this page: say so, and let the reload wait until it suits.
 * Quiet, and never a reload by itself, for the reason in `updates.ts`. Where it sits and how it
 * looks are the app's.
 */
export function UpdateNotice({
  reload = () => window.location.reload(),
}: {
  readonly reload?: () => void;
}) {
  if (!useUpdateReady()) return null;
  return (
    <p className="update-notice" role="status">
      Norikub has been updated.{' '}
      <button type="button" onClick={reload}>
        Reload
      </button>
    </p>
  );
}
