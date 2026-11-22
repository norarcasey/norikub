import type { GoTrueClient } from '@supabase/auth-js';

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * What the sign-in panel needs from auth, and nothing more: the panel is tested against a
 * fake of this, and `accountOf` is the one place it meets auth-js. Ported from Hanora's
 * HAN-22, so the shared CruciNora account behaves the same on every site that uses it.
 */
export type Account = {
  /** The signed-in account's email, or null. */
  readonly current: () => Promise<string | null>;
  /** Calls back on every change, sign-in and sign-out included; returns the unsubscribe. */
  readonly watch: (listener: (email: string | null) => void) => () => void;
  readonly sendCode: (email: string) => Promise<Outcome>;
  readonly verifyCode: (email: string, code: string) => Promise<Outcome>;
  readonly signOut: () => Promise<Outcome>;
};

function outcome({ error }: { readonly error: { readonly message: string } | null }): Outcome {
  return error === null ? { ok: true } : { ok: false, message: error.message };
}

export function accountOf(auth: GoTrueClient): Account {
  return {
    current: async () => (await auth.getSession()).data.session?.user.email ?? null,
    watch: (listener) => {
      const { data } = auth.onAuthStateChange((_event, session) => {
        listener(session?.user.email ?? null);
      });
      return () => data.subscription.unsubscribe();
    },
    // No emailRedirectTo: the mail's link goes to CruciNora's Site URL, and Norikub's origin
    // is not among its redirect URLs (docs/supabase.md). The code is the way in, because a
    // link opens the browser rather than the installed app or the Mac app's window.
    // A new email makes a new account: signup is open on the shared project.
    sendCode: async (email) => outcome(await auth.signInWithOtp({ email })),
    // `email`, not `magiclink` or `signup`: one type that takes either mail's code, so the
    // panel need not know whether this address already had an account.
    verifyCode: async (email, token) =>
      outcome(await auth.verifyOtp({ email, token, type: 'email' })),
    // Local, not the default `global`: the account is shared with CruciNora, Nordle and
    // Hanora, and a global sign-out revokes every session it has, signing the player out of
    // all of them. Signed in per site is per site both ways (Nora, 21 Oct 2026).
    signOut: async () => outcome(await auth.signOut({ scope: 'local' })),
  };
}
