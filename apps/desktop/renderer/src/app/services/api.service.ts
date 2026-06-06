import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  AnalyzeConversationRequestDto,
  AnalyzeResponseDto,
  ConversationDetail,
  ConversationListItem,
  CreateDeviceDto,
  Device,
  PublicUserLite,
  Task,
  TaskProposalDetail,
  TaskStatus,
} from '@ws-spy/shared';
import { Observable } from 'rxjs';

export interface BoardTask extends Task {
  contact: { id: string; displayName: string; phoneE164: string } | null;
  assignee: { id: string; displayName: string; role: 'ADMIN' | 'MEMBER' } | null;
}

export interface ProposalPatch {
  titulo?: string;
  descripcion?: string | null;
  fechaLimite?: string | null;
  categoria?: string;
  assigneeUserId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl =
    window.wsSpy?.apiUrl ?? 'http://localhost:3000';

  constructor(private readonly http: HttpClient) {}

  getDevices(): Observable<Device[]> {
    return this.http.get<Device[]>(`${this.baseUrl}/devices`);
  }

  createDevice(dto: CreateDeviceDto): Observable<Device> {
    return this.http.post<Device>(`${this.baseUrl}/devices`, dto);
  }

  connectDevice(id: string): Observable<Device> {
    return this.http.post<Device>(`${this.baseUrl}/devices/${id}/connect`, {});
  }

  disconnectDevice(id: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `${this.baseUrl}/devices/${id}/disconnect`,
      {},
    );
  }

  getConversations(deviceId: string): Observable<ConversationListItem[]> {
    return this.http.get<ConversationListItem[]>(
      `${this.baseUrl}/conversations?deviceId=${deviceId}`,
    );
  }

  getConversation(id: string): Observable<ConversationDetail> {
    return this.http.get<ConversationDetail>(
      `${this.baseUrl}/conversations/${id}`,
    );
  }

  analyzeConversation(
    dto: AnalyzeConversationRequestDto,
  ): Observable<AnalyzeResponseDto> {
    return this.http.post<AnalyzeResponseDto>(
      `${this.baseUrl}/ai/analyze`,
      dto,
    );
  }

  getApiUrl(): string {
    return this.baseUrl;
  }

  listProposals(
    status: 'PENDIENTE' | 'APROBADA' | 'DESCARTADA' | 'RETENIDA' = 'PENDIENTE',
  ): Observable<TaskProposalDetail[]> {
    return this.http.get<TaskProposalDetail[]>(
      `${this.baseUrl}/proposals?status=${status}`,
    );
  }

  countPendingProposals(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(
      `${this.baseUrl}/proposals/count-pending`,
    );
  }

  getProposal(id: string): Observable<TaskProposalDetail> {
    return this.http.get<TaskProposalDetail>(
      `${this.baseUrl}/proposals/${id}`,
    );
  }

  updateProposal(id: string, patch: ProposalPatch): Observable<TaskProposalDetail> {
    return this.http.patch<TaskProposalDetail>(
      `${this.baseUrl}/proposals/${id}`,
      patch,
    );
  }

  approveProposal(
    id: string,
    patch: ProposalPatch,
  ): Observable<{ proposal: TaskProposalDetail; task: { id: string } }> {
    return this.http.post<{
      proposal: TaskProposalDetail;
      task: { id: string };
    }>(`${this.baseUrl}/proposals/${id}/approve`, patch);
  }

  discardProposal(id: string): Observable<TaskProposalDetail> {
    return this.http.post<TaskProposalDetail>(
      `${this.baseUrl}/proposals/${id}/discard`,
      {},
    );
  }

  listUsers(): Observable<PublicUserLite[]> {
    return this.http.get<PublicUserLite[]>(`${this.baseUrl}/users`);
  }

  listBoardTasks(): Observable<BoardTask[]> {
    const statuses = [TaskStatus.PENDING, TaskStatus.IN_PROGRESS, TaskStatus.DONE].join(',');
    return this.http.get<BoardTask[]>(
      `${this.baseUrl}/tasks?status=${statuses}`,
    );
  }

  updateTaskStatus(id: string, status: TaskStatus): Observable<BoardTask> {
    return this.http.patch<BoardTask>(`${this.baseUrl}/tasks/${id}`, { status });
  }
}
