import type { DeviceStatus, Message, Task, TaskStatus } from './types';

export const SOCKET_EVENTS = {
  QR: 'whatsapp:qr',
  DEVICE_STATUS: 'whatsapp:device-status',
  MESSAGE: 'whatsapp:message',
  TASK_UPDATED: 'task:updated',
} as const;

export interface QrEventPayload {
  deviceId: string;
  qr: string;
}

export interface DeviceStatusEventPayload {
  deviceId: string;
  status: DeviceStatus;
  phoneE164?: string | null;
}

export interface MessageEventPayload {
  deviceId: string;
  message: Message;
}

export interface TaskUpdatedEventPayload {
  taskId: string;
  status: TaskStatus;
}
