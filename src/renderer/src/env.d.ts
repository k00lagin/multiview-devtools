/// <reference types="vite/client" />

import type { RendererBridge } from '@shared/ipc';

declare global {
  interface Window {
    multiviewDevtools: RendererBridge;
  }
}

export {};
