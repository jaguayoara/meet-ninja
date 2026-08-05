/**
 * Tipos del preload bridge. Se exponen en window.meetninja.
 */
import type { MeetNinjaApi } from '../electron/preload.types';

declare global {
  interface Window {
    meetninja: MeetNinjaApi;
  }
}

export {};
