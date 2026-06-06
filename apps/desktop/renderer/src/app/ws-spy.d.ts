export interface WsSpyBridge {
  apiUrl: string;
  platform: string;
}

declare global {
  interface Window {
    wsSpy?: WsSpyBridge;
  }
}

export {};
