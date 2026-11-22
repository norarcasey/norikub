/**
 * Where auth-js keeps this origin's session (client.ts's `storageKey`). Its own module, with
 * nothing else in it, so a screen can ask whether anyone is signed in here without loading
 * auth-js to find out, as Hanora's does (HAN-23 there).
 */
export const AUTH_STORAGE_KEY = 'norikub.auth';
