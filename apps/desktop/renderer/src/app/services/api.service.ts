import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {
  AnalyzeConversationRequestDto,
  AnalyzeResponseDto,
  ConversationDetail,
  ConversationListItem,
  CreateDeviceDto,
  Device,
} from '@ws-spy/shared';
import { Observable } from 'rxjs';

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
}
