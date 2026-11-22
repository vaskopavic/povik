import { browserPlatform } from './browser';

export type { Platform } from './types';

/**
 * The desktop build will choose its implementation at runtime here, by checking for the
 * `window.povik` bridge its preload script exposes (phase 5).
 */
export const platform = browserPlatform;
