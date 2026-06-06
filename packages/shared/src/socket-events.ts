import type { DeviceStatus, Message, Task, TaskStatus } from './types';

export const SOCKET_EVENTS = {
  QR: 'whatsapp:qr',
  DEVICE_STATUS: 'whatsapp:device-status',
  MESSAGE: 'whatsapp:message',
  HISTORY_SYNC: 'whatsapp:history-sync',
  TASK_UPDATED: 'task:updated',
  PROPOSAL_CREATED: 'proposal:created',
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

export interface HistorySyncEventPayload {
  deviceId: string;
  progress?: number | null;
  isLatest?: boolean;
}

export interface TaskUpdatedEventPayload {
  taskId: string;
  status: TaskStatus;
}

export interface ProposalCreatedEventPayload {
  proposalId: string;
  conversationId: string;
  categoria: string;
  confianza: number;
}
