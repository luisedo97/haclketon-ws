import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import {
  DeviceStatusEventPayload,
  MessageEventPayload,
  ProposalApprovedEventPayload,
  ProposalCreatedEventPayload,
  ProposalDiscardedEventPayload,
  QrEventPayload,
  SOCKET_EVENTS,
  TaskUpdatedEventPayload,
} from '@ws-spy/shared';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  handleConnection(socket: Socket) {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      this.extractBearer(socket.handshake.headers.authorization);

    if (!token) {
      this.logger.warn(`Socket ${socket.id} rechazado: sin token`);
      socket.disconnect(true);
      return;
    }

    try {
      this.jwtService.verify(token, {
        secret:
          this.configService.get<string>('JWT_SECRET') ??
          'dev-secret-please-change',
      });
    } catch (error) {
      this.logger.warn(
        `Socket ${socket.id} rechazado: token inválido (${error instanceof Error ? error.message : error})`,
      );
      socket.disconnect(true);
    }
  }

  private extractBearer(header?: string): string | undefined {
    if (!header) return undefined;
    const [type, value] = header.split(' ');
    return type?.toLowerCase() === 'bearer' ? value : undefined;
  }

  emitQr(payload: QrEventPayload) {
    this.server.emit(SOCKET_EVENTS.QR, payload);
  }

  emitDeviceStatus(payload: DeviceStatusEventPayload) {
    this.server.emit(SOCKET_EVENTS.DEVICE_STATUS, payload);
  }

  emitMessage(payload: MessageEventPayload) {
    this.server.emit(SOCKET_EVENTS.MESSAGE, payload);
  }

  emitTaskUpdated(payload: TaskUpdatedEventPayload) {
    this.server.emit(SOCKET_EVENTS.TASK_UPDATED, payload);
  }

  emitProposalCreated(payload: ProposalCreatedEventPayload) {
    this.server.emit(SOCKET_EVENTS.PROPOSAL_CREATED, payload);
  }

  emitProposalApproved(payload: ProposalApprovedEventPayload) {
    this.server.emit(SOCKET_EVENTS.PROPOSAL_APPROVED, payload);
  }

  emitProposalDiscarded(payload: ProposalDiscardedEventPayload) {
    this.server.emit(SOCKET_EVENTS.PROPOSAL_DISCARDED, payload);
  }
}
