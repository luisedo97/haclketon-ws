import type { DeviceStatus, Message, Task, TaskStatus } from './types';

export const SOCKET_EVENTS = {
  QR: 'whatsapp:qr',
  DEVICE_STATUS: 'whatsapp:device-status',
  MESSAGE: 'whatsapp:message',
  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  PROPOSAL_CREATED: 'proposal:created',
  PROPOSAL_APPROVED: 'proposal:approved',
  PROPOSAL_DISCARDED: 'proposal:discarded',
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

export interface TaskCreatedEventPayload {
  taskId: string;
  assigneeUserId: string | null;
  status: TaskStatus;
}

export interface ProposalCreatedEventPayload {
  proposalId: string;
  conversationId: string;
  categoria: string;
  confianza: number;
  creatorUserId: string | null;
}

export interface ProposalApprovedEventPayload {
  proposalId: string;
  creatorUserId: string | null;
  taskId: string;
}

export interface ProposalDiscardedEventPayload {
  proposalId: string;
  creatorUserId: string | null;
}
