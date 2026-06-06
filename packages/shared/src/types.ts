export enum DeviceStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  QR_READY = 'QR_READY',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  BLOCKED = 'BLOCKED',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
}

export interface Device {
  id: string;
  label: string;
  phoneE164: string | null;
  status: DeviceStatus;
  sessionPath: string;
  createdAt: string;
}

export interface Contact {
  id: string;
  deviceId: string | null;
  phoneE164: string;
  displayName: string;
  pushName: string | null;
  notes: string | null;
  isManual: boolean;
}

export interface Conversation {
  id: string;
  deviceId: string;
  contactId: string | null;
  jid: string;
  title: string | null;
  lastMessageAt: string | null;
}

export interface ConversationDetail extends Conversation {
  contact: Contact | null;
  messages: Message[];
}

export interface ConversationListItem extends Conversation {
  contact: Contact | null;
  messages: Message[];
}

export interface Message {
  id: string;
  conversationId: string;
  externalId: string;
  fromMe: boolean;
  text: string | null;
  mediaUrl: string | null;
  sentAt: string;
}

export interface Task {
  id: string;
  contactId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiAnalysis {
  id: string;
  scope: string;
  refId: string;
  model: string;
  output: Record<string, unknown>;
  createdAt: string;
}

export enum ProposalStatus {
  PENDIENTE = 'PENDIENTE',
  APROBADA = 'APROBADA',
  DESCARTADA = 'DESCARTADA',
  RETENIDA = 'RETENIDA',
}

export interface TaskProposal {
  id: string;
  creatorUserId: string | null;
  sourceMessageId: string;
  conversationId: string;
  titulo: string;
  descripcion: string | null;
  fechaLimite: string | null;
  categoria: string;
  responsableProbable: string | null;
  confianza: number;
  status: ProposalStatus;
  modelUsed: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskProposalDetail extends TaskProposal {
  sourceMessage: Message;
  conversation: Pick<Conversation, 'id' | 'jid' | 'title'>;
}

export interface AnalysisTaskItem {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  dueHint: string | null;
}

export interface CreateDeviceDto {
  label: string;
}

export interface CreateContactDto {
  phoneE164: string;
  displayName: string;
  notes?: string;
  deviceId?: string;
}

export interface CreateTaskDto {
  contactId: string;
  title: string;
  description?: string;
  status?: TaskStatus;
  dueAt?: string;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string;
  status?: TaskStatus;
  dueAt?: string | null;
}

/** @deprecated Use AnalyzeConversationRequestDto */
export interface AnalyzeRequestDto {
  scope: 'message' | 'conversation';
  refId: string;
  prompt?: string;
}

export interface AnalyzeConversationRequestDto {
  conversationId: string;
  fromMessageId: string;
  toMessageId: string;
}

export interface AnalyzeResponseDto {
  id: string;
  hasTasks: boolean;
  summary: string;
  tasks: AnalysisTaskItem[];
  model: string;
  messageCount: number;
  contactName: string;
  range: {
    fromMessageId: string;
    toMessageId: string;
    fromAt: string;
    toAt: string;
  };
}
