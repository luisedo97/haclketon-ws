import { contextBridge } from 'electron';

const apiUrl = process.env.API_URL ?? 'http://localhost:3000';

contextBridge.exposeInMainWorld('wsSpy', {
  apiUrl,
  platform: process.platform,
});

export interface WsSpyBridge {
  apiUrl: string;
  platform: NodeJS.Platform;
}

declare global {
  interface Window {
    wsSpy: WsSpyBridge;
  }
}
