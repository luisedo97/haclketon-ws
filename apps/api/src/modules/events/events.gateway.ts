import {
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import {
  DeviceStatusEventPayload,
  MessageEventPayload,
  QrEventPayload,
  SOCKET_EVENTS,
  TaskUpdatedEventPayload,
} from '@ws-spy/shared';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class EventsGateway {
  @WebSocketServer()
  server!: Server;

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
}
