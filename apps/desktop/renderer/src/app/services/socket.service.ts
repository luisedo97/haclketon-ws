import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import {
  DeviceStatusEventPayload,
  MessageEventPayload,
  QrEventPayload,
  SOCKET_EVENTS,
} from '@ws-spy/shared';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SocketService implements OnDestroy {
  private socket: Socket | null = null;

  readonly qr$ = new Subject<QrEventPayload>();
  readonly deviceStatus$ = new Subject<DeviceStatusEventPayload>();
  readonly message$ = new Subject<MessageEventPayload>();

  connect(apiUrl: string) {
    if (this.socket?.connected) {
      return;
    }

    this.socket = io(apiUrl, {
      transports: ['websocket', 'polling'],
    });

    this.socket.on(SOCKET_EVENTS.QR, (payload: QrEventPayload) => {
      this.qr$.next(payload);
    });

    this.socket.on(
      SOCKET_EVENTS.DEVICE_STATUS,
      (payload: DeviceStatusEventPayload) => {
        this.deviceStatus$.next(payload);
      },
    );

    this.socket.on(SOCKET_EVENTS.MESSAGE, (payload: MessageEventPayload) => {
      this.message$.next(payload);
    });
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  ngOnDestroy() {
    this.disconnect();
  }
}
