import { Injectable, OnDestroy } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import {
  DeviceStatusEventPayload,
  HistorySyncEventPayload,
  MessageEventPayload,
  ProposalApprovedEventPayload,
  ProposalCreatedEventPayload,
  ProposalDiscardedEventPayload,
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
  readonly historySync$ = new Subject<HistorySyncEventPayload>();
  readonly proposalCreated$ = new Subject<ProposalCreatedEventPayload>();
  readonly proposalApproved$ = new Subject<ProposalApprovedEventPayload>();
  readonly proposalDiscarded$ = new Subject<ProposalDiscardedEventPayload>();

  connect(apiUrl: string, token: string | null) {
    if (this.socket?.connected) {
      return;
    }

    if (!token) {
      // Sin token la API rechaza el handshake; no intentamos.
      return;
    }

    this.socket = io(apiUrl, {
      transports: ['websocket', 'polling'],
      auth: { token },
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

    this.socket.on(
      SOCKET_EVENTS.HISTORY_SYNC,
      (payload: HistorySyncEventPayload) => {
        this.historySync$.next(payload);
      },
    );

    this.socket.on(
      SOCKET_EVENTS.PROPOSAL_CREATED,
      (payload: ProposalCreatedEventPayload) => {
        this.proposalCreated$.next(payload);
      },
    );

    this.socket.on(
      SOCKET_EVENTS.PROPOSAL_APPROVED,
      (payload: ProposalApprovedEventPayload) => {
        this.proposalApproved$.next(payload);
      },
    );

    this.socket.on(
      SOCKET_EVENTS.PROPOSAL_DISCARDED,
      (payload: ProposalDiscardedEventPayload) => {
        this.proposalDiscarded$.next(payload);
      },
    );
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }

  ngOnDestroy() {
    this.disconnect();
  }
}
