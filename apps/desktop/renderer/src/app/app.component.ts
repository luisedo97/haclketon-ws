import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  CdkDragDrop,
  DragDropModule,
} from '@angular/cdk/drag-drop';
import {
  AnalyzeResponseDto,
  ConversationDetail,
  ConversationListItem,
  Device,
  DeviceStatus,
  Message,
  PublicUserLite,
  TaskProposalDetail,
  TaskStatus,
} from '@ws-spy/shared';
import { formatConversationTitle } from './utils/conversation.utils';
import { Subscription } from 'rxjs';
import { ApiService, BoardTask, ProposalPatch } from './services/api.service';
import { AuthService, LinkCodeResult, PublicUser } from './services/auth.service';
import { SocketService } from './services/socket.service';

type ViewMode = 'auth' | 'devices' | 'workspace' | 'inbox' | 'tablero';
type AuthMode = 'login' | 'register';

interface BoardColumn {
  id: TaskStatus;
  label: string;
}

interface ProposalDraft {
  titulo: string;
  descripcion: string;
  fechaLimite: string;
  categoria: string;
  assigneeUserId: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, OnDestroy {
  readonly DeviceStatus = DeviceStatus;

  viewMode = signal<ViewMode>('auth');

  // Auth UI state
  authMode = signal<AuthMode>('login');
  authEmail = signal('');
  authPassword = signal('');
  authDisplayName = signal('');
  authSubmitting = signal(false);
  authError = signal<string | null>(null);

  // Link code UI state
  linkCode = signal<LinkCodeResult | null>(null);
  linkCodeLoading = signal(false);
  linkCodeRemainingSec = signal<number>(0);
  showAccountPanel = signal(false);

  // Inbox state
  inboxCount = signal(0);
  inboxProposals = signal<TaskProposalDetail[]>([]);
  inboxLoading = signal(false);
  selectedProposalId = signal<string | null>(null);
  proposalDraft = signal<ProposalDraft | null>(null);
  proposalSaving = signal(false);
  users = signal<PublicUserLite[]>([]);
  readonly CATEGORIES = [
    'logística',
    'finanzas',
    'voluntariado',
    'comunicación',
    'administración',
    'otro',
  ] as const;

  readonly BOARD_COLUMNS: BoardColumn[] = [
    { id: TaskStatus.PENDING, label: 'Pendiente' },
    { id: TaskStatus.IN_PROGRESS, label: 'En curso' },
    { id: TaskStatus.DONE, label: 'Hecha' },
  ];
  readonly TaskStatus = TaskStatus;

  // Tablero state
  boardTasks = signal<BoardTask[]>([]);
  boardLoading = signal(false);
  boardFilterCategories = signal<Set<string>>(new Set());
  boardFilterAssigneeUserId = signal<string | null>(null);
  boardFilterOnlyMine = signal(false);
  activeMobileBoardColumn = signal<TaskStatus>(TaskStatus.PENDING);

  devices = signal<Device[]>([]);
  conversations = signal<ConversationListItem[]>([]);
  activeConversation = signal<ConversationDetail | null>(null);

  loading = signal(false);
  conversationsLoading = signal(false);
  analyzing = signal(false);
  error = signal<string | null>(null);

  newDeviceLabel = signal('WhatsApp Principal');
  qrByDevice = signal<Record<string, string>>({});
  activeQrDeviceId = signal<string | null>(null);

  selectedDeviceId = signal<string | null>(null);
  selectedConversationId = signal<string | null>(null);

  selectionFromId = signal<string | null>(null);
  selectionToId = signal<string | null>(null);
  analysisResult = signal<AnalyzeResponseDto | null>(null);

  selectedDevice = computed(() =>
    this.devices().find((device) => device.id === this.selectedDeviceId()) ??
    null,
  );

  selectionReady = computed(
    () => !!this.selectionFromId() && !!this.selectionToId(),
  );

  private subscriptions = new Subscription();
  private conversationsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private conversationsLoadInFlight = false;
  private linkCodeTimer: ReturnType<typeof setInterval> | null = null;

  currentUser = computed<PublicUser | null>(() => this.auth.currentUser());
  isAdmin = computed(() => this.auth.currentUser()?.role === 'ADMIN');
  selectedProposal = computed<TaskProposalDetail | null>(() => {
    const id = this.selectedProposalId();
    if (!id) return null;
    return this.inboxProposals().find((p) => p.id === id) ?? null;
  });

  filteredBoardTasks = computed<BoardTask[]>(() => {
    const tasks = this.boardTasks();
    const cats = this.boardFilterCategories();
    const assignee = this.boardFilterAssigneeUserId();
    const mine = this.boardFilterOnlyMine();
    const meId = this.currentUser()?.id ?? null;

    return tasks.filter((t) => {
      if (cats.size > 0 && !cats.has((t.category ?? '').toLowerCase())) {
        return false;
      }
      if (assignee && t.assigneeUserId !== assignee) {
        return false;
      }
      if (mine && (!meId || t.assigneeUserId !== meId)) {
        return false;
      }
      return true;
    });
  });

  boardCategories = computed<string[]>(() => {
    const set = new Set<string>(this.CATEGORIES.map((c) => c.toLowerCase()));
    for (const task of this.boardTasks()) {
      if (task.category) set.add(task.category.toLowerCase());
    }
    return Array.from(set).sort();
  });

  readonly boardConnectedIds = this.BOARD_COLUMNS.map((c) => `col-${c.id}`);

  constructor(
    private readonly api: ApiService,
    private readonly socket: SocketService,
    private readonly auth: AuthService,
  ) {}

  ngOnInit() {
    if (this.auth.isAuthenticated()) {
      this.bootstrapAuthenticated();
    } else {
      this.viewMode.set('auth');
    }

    this.subscriptions.add(
      this.socket.qr$.subscribe(({ deviceId, qr }) => {
        this.qrByDevice.update((current) => ({ ...current, [deviceId]: qr }));
        this.activeQrDeviceId.set(deviceId);
      }),
    );

    this.subscriptions.add(
      this.socket.deviceStatus$.subscribe(({ deviceId, status }) => {
        this.devices.update((list) =>
          list.map((device) =>
            device.id === deviceId ? { ...device, status } : device,
          ),
        );

        if (status === DeviceStatus.CONNECTED) {
          this.activeQrDeviceId.set(null);
          if (this.selectedDeviceId() === deviceId) {
            this.loadConversations(deviceId);
          }
        }
      }),
    );

    this.subscriptions.add(
      this.socket.proposalCreated$.subscribe((payload) => {
        if (payload.creatorUserId !== this.currentUser()?.id) return;
        this.inboxCount.update((n) => n + 1);
        if (this.viewMode() === 'inbox') {
          this.loadInbox();
        }
      }),
    );

    this.subscriptions.add(
      this.socket.proposalApproved$.subscribe((payload) => {
        if (payload.creatorUserId !== this.currentUser()?.id) return;
        if (this.viewMode() === 'inbox') {
          this.removeProposalFromInbox(payload.proposalId);
        } else {
          this.refreshInboxCount();
        }
      }),
    );

    this.subscriptions.add(
      this.socket.proposalDiscarded$.subscribe((payload) => {
        if (payload.creatorUserId !== this.currentUser()?.id) return;
        if (this.viewMode() === 'inbox') {
          this.removeProposalFromInbox(payload.proposalId);
        } else {
          this.refreshInboxCount();
        }
      }),
    );

    this.subscriptions.add(
      this.socket.taskCreated$.subscribe(() => {
        if (this.viewMode() === 'tablero') {
          this.loadBoard();
        }
      }),
    );

    this.subscriptions.add(
      this.socket.taskUpdated$.subscribe((payload) => {
        if (this.viewMode() !== 'tablero') return;
        const known = this.boardTasks().some((t) => t.id === payload.taskId);
        if (!known) {
          this.loadBoard();
          return;
        }
        this.boardTasks.update((list) =>
          list.map((t) =>
            t.id === payload.taskId ? { ...t, status: payload.status } : t,
          ),
        );
      }),
    );

    this.subscriptions.add(
      this.socket.message$.subscribe(({ deviceId, message }) => {
        if (this.selectedDeviceId() !== deviceId) {
          return;
        }

        let needsRefresh = false;

        this.conversations.update((list) => {
          const existing = list.find(
            (item) => item.id === message.conversationId,
          );
          if (existing) {
            return list
              .map((item) =>
                item.id === message.conversationId
                  ? {
                      ...item,
                      lastMessageAt: message.sentAt,
                      messages: [message],
                    }
                  : item,
              )
              .sort(
                (a, b) =>
                  new Date(b.lastMessageAt ?? 0).getTime() -
                  new Date(a.lastMessageAt ?? 0).getTime(),
              );
          }

          needsRefresh = true;
          return list;
        });

        if (needsRefresh) {
          this.scheduleConversationsRefresh(deviceId);
        }

        const active = this.activeConversation();
        if (active?.id === message.conversationId) {
          const exists = active.messages.some((item) => item.id === message.id);
          if (!exists) {
            this.activeConversation.set({
              ...active,
              messages: [...active.messages, message],
              lastMessageAt: message.sentAt,
            });
          }
        }
      }),
    );
  }

  ngOnDestroy() {
    if (this.conversationsRefreshTimer) {
      clearTimeout(this.conversationsRefreshTimer);
    }
    if (this.linkCodeTimer) {
      clearInterval(this.linkCodeTimer);
    }
    this.subscriptions.unsubscribe();
    this.socket.disconnect();
  }

  private bootstrapAuthenticated() {
    this.viewMode.set('devices');
    this.socket.connect(this.api.getApiUrl(), this.auth.token());
    this.loadDevices();
    this.refreshInboxCount();
    this.loadUsers();
    // Refrescar el user — pudo cambiar phoneE164 mientras estaba offline.
    this.auth.fetchMe().subscribe({
      error: () => {
        // El interceptor desloguea si es 401.
      },
    });
  }

  refreshInboxCount() {
    if (!this.auth.isAuthenticated()) {
      this.inboxCount.set(0);
      return;
    }
    this.api.countPendingProposals().subscribe({
      next: ({ count }) => this.inboxCount.set(count),
      error: () => {},
    });
  }

  loadUsers() {
    if (!this.auth.isAuthenticated()) return;
    this.api.listUsers().subscribe({
      next: (users) => this.users.set(users),
      error: () => {},
    });
  }

  openInbox() {
    this.viewMode.set('inbox');
    this.selectedProposalId.set(null);
    this.proposalDraft.set(null);
    this.error.set(null);
    this.loadInbox();
  }

  openTablero() {
    this.viewMode.set('tablero');
    this.error.set(null);
    this.loadBoard();
  }

  loadBoard() {
    this.boardLoading.set(true);
    this.api.listBoardTasks().subscribe({
      next: (tasks) => {
        this.boardTasks.set(tasks);
        this.boardLoading.set(false);
      },
      error: (err) => {
        this.boardLoading.set(false);
        this.error.set(
          this.extractErrorMessage(err, 'No se pudieron cargar las tareas.'),
        );
      },
    });
  }

  tasksForColumn(status: TaskStatus): BoardTask[] {
    return this.filteredBoardTasks().filter((t) => t.status === status);
  }

  onDropTask(event: CdkDragDrop<TaskStatus>, targetStatus: TaskStatus) {
    if (event.previousContainer === event.container) {
      return;
    }
    const task = event.item.data as BoardTask;
    if (!task || task.status === targetStatus) {
      return;
    }

    const previousStatus = task.status;
    this.boardTasks.update((list) =>
      list.map((t) => (t.id === task.id ? { ...t, status: targetStatus } : t)),
    );

    this.api.updateTaskStatus(task.id, targetStatus).subscribe({
      error: (err) => {
        this.boardTasks.update((list) =>
          list.map((t) =>
            t.id === task.id ? { ...t, status: previousStatus } : t,
          ),
        );
        this.error.set(
          this.extractErrorMessage(err, 'No se pudo mover la tarea.'),
        );
      },
    });
  }

  toggleBoardCategory(category: string) {
    const key = category.toLowerCase();
    const current = new Set(this.boardFilterCategories());
    if (current.has(key)) {
      current.delete(key);
    } else {
      current.add(key);
    }
    this.boardFilterCategories.set(current);
  }

  isBoardCategoryActive(category: string): boolean {
    return this.boardFilterCategories().has(category.toLowerCase());
  }

  clearBoardFilters() {
    this.boardFilterCategories.set(new Set());
    this.boardFilterAssigneeUserId.set(null);
    this.boardFilterOnlyMine.set(false);
  }

  taskStatusLabel(status: TaskStatus): string {
    return (
      this.BOARD_COLUMNS.find((c) => c.id === status)?.label ?? String(status)
    );
  }

  taskAssigneeLabel(task: BoardTask): string {
    if (task.assignee?.displayName) return task.assignee.displayName;
    if (task.assigneeUserId) {
      const match = this.users().find((u) => u.id === task.assigneeUserId);
      if (match) return match.displayName;
    }
    return 'Sin asignar';
  }

  formatDueDate(iso: string | null): string | null {
    if (!iso) return null;
    return new Date(iso).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
    });
  }

  loadInbox() {
    this.inboxLoading.set(true);
    this.api.listProposals('PENDIENTE').subscribe({
      next: (list) => {
        this.inboxProposals.set(list);
        this.inboxCount.set(list.length);
        this.inboxLoading.set(false);
      },
      error: (err) => {
        this.inboxLoading.set(false);
        this.error.set(
          this.extractErrorMessage(err, 'No se pudieron cargar las propuestas.'),
        );
      },
    });
  }

  selectProposal(proposal: TaskProposalDetail) {
    this.selectedProposalId.set(proposal.id);
    this.proposalDraft.set({
      titulo: proposal.titulo,
      descripcion: proposal.descripcion ?? '',
      fechaLimite: proposal.fechaLimite
        ? proposal.fechaLimite.slice(0, 10)
        : '',
      categoria: proposal.categoria,
      assigneeUserId: proposal.matchedAssigneeUserId ?? '',
    });
  }

  updateDraft<K extends keyof ProposalDraft>(field: K, value: ProposalDraft[K]) {
    const current = this.proposalDraft();
    if (!current) return;
    this.proposalDraft.set({ ...current, [field]: value });
  }

  private currentPatch(): ProposalPatch {
    const draft = this.proposalDraft();
    if (!draft) return {};
    return {
      titulo: draft.titulo,
      descripcion: draft.descripcion || null,
      fechaLimite: draft.fechaLimite || null,
      categoria: draft.categoria,
      assigneeUserId: draft.assigneeUserId || null,
    };
  }

  saveDraft() {
    const id = this.selectedProposalId();
    if (!id || this.proposalSaving()) return;
    this.proposalSaving.set(true);
    this.api.updateProposal(id, this.currentPatch()).subscribe({
      next: (updated) => {
        this.inboxProposals.update((list) =>
          list.map((p) => (p.id === updated.id ? updated : p)),
        );
        this.proposalSaving.set(false);
      },
      error: (err) => {
        this.proposalSaving.set(false);
        this.error.set(
          this.extractErrorMessage(err, 'No se pudo guardar la propuesta.'),
        );
      },
    });
  }

  approveProposal() {
    const id = this.selectedProposalId();
    if (!id || this.proposalSaving()) return;
    this.proposalSaving.set(true);
    this.api.approveProposal(id, this.currentPatch()).subscribe({
      next: () => {
        this.proposalSaving.set(false);
        this.removeProposalFromInbox(id);
      },
      error: (err) => {
        this.proposalSaving.set(false);
        this.error.set(
          this.extractErrorMessage(err, 'No se pudo aprobar la propuesta.'),
        );
      },
    });
  }

  discardProposal() {
    const id = this.selectedProposalId();
    if (!id || this.proposalSaving()) return;
    this.proposalSaving.set(true);
    this.api.discardProposal(id).subscribe({
      next: () => {
        this.proposalSaving.set(false);
        this.removeProposalFromInbox(id);
      },
      error: (err) => {
        this.proposalSaving.set(false);
        this.error.set(
          this.extractErrorMessage(err, 'No se pudo descartar la propuesta.'),
        );
      },
    });
  }

  private removeProposalFromInbox(id: string) {
    this.inboxProposals.update((list) => list.filter((p) => p.id !== id));
    this.inboxCount.set(this.inboxProposals().length);
    this.selectedProposalId.set(null);
    this.proposalDraft.set(null);
  }

  confidenceBucket(c: number): 'low' | 'medium' | 'high' {
    if (c >= 0.8) return 'high';
    if (c >= 0.5) return 'medium';
    return 'low';
  }

  submitAuth() {
    if (this.authSubmitting()) return;
    const email = this.authEmail().trim();
    const password = this.authPassword();
    const displayName = this.authDisplayName().trim();

    if (!email || !password) {
      this.authError.set('Email y contraseña son requeridos.');
      return;
    }
    if (this.authMode() === 'register' && !displayName) {
      this.authError.set('El nombre es requerido para registrarse.');
      return;
    }

    this.authSubmitting.set(true);
    this.authError.set(null);

    const obs =
      this.authMode() === 'login'
        ? this.auth.login({ email, password })
        : this.auth.register({ email, password, displayName });

    obs.subscribe({
      next: () => {
        this.authSubmitting.set(false);
        this.authPassword.set('');
        this.bootstrapAuthenticated();
      },
      error: (err) => {
        this.authSubmitting.set(false);
        this.authError.set(
          this.extractErrorMessage(err, 'No se pudo autenticar.'),
        );
      },
    });
  }

  toggleAuthMode() {
    this.authMode.update((m) => (m === 'login' ? 'register' : 'login'));
    this.authError.set(null);
  }

  logout() {
    this.auth.logout();
    this.socket.disconnect();
    this.devices.set([]);
    this.conversations.set([]);
    this.activeConversation.set(null);
    this.viewMode.set('auth');
    this.linkCode.set(null);
    this.showAccountPanel.set(false);
    if (this.linkCodeTimer) {
      clearInterval(this.linkCodeTimer);
      this.linkCodeTimer = null;
    }
  }

  toggleAccountPanel() {
    this.showAccountPanel.update((v) => !v);
  }

  requestLinkCode() {
    if (this.linkCodeLoading()) return;
    this.linkCodeLoading.set(true);
    this.error.set(null);
    this.auth.generateLinkCode().subscribe({
      next: (result) => {
        this.linkCode.set(result);
        this.linkCodeLoading.set(false);
        this.startLinkCodeCountdown(result.expiresAt);
      },
      error: (err) => {
        this.linkCodeLoading.set(false);
        this.error.set(
          this.extractErrorMessage(err, 'No se pudo generar el código.'),
        );
      },
    });
  }

  private startLinkCodeCountdown(expiresAtIso: string) {
    if (this.linkCodeTimer) {
      clearInterval(this.linkCodeTimer);
    }
    const expiresAt = new Date(expiresAtIso).getTime();
    const tick = () => {
      const remaining = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      this.linkCodeRemainingSec.set(remaining);
      if (remaining === 0 && this.linkCodeTimer) {
        clearInterval(this.linkCodeTimer);
        this.linkCodeTimer = null;
      }
    };
    tick();
    this.linkCodeTimer = setInterval(tick, 1000);
  }

  formatRemaining(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  loadDevices() {
    if (!this.isAdmin()) {
      this.devices.set([]);
      return;
    }
    this.loading.set(true);
    this.error.set(null);

    this.api.getDevices().subscribe({
      next: (devices) => {
        this.devices.set(devices);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('No se pudo conectar con la API. Verifica docker compose.');
        this.loading.set(false);
      },
    });
  }

  createAndConnect() {
    const label = this.newDeviceLabel().trim();
    if (!label) {
      return;
    }

    this.loading.set(true);
    this.api.createDevice({ label }).subscribe({
      next: (device) => {
        this.devices.update((list) => [device, ...list]);
        this.connect(device.id);
      },
      error: () => {
        this.error.set('Error al crear el dispositivo.');
        this.loading.set(false);
      },
    });
  }

  connect(deviceId: string) {
    this.loading.set(true);
    this.api.connectDevice(deviceId).subscribe({
      next: () => this.loading.set(false),
      error: () => {
        this.error.set('Error al iniciar la vinculación.');
        this.loading.set(false);
      },
    });
  }

  disconnect(deviceId: string) {
    this.api.disconnectDevice(deviceId).subscribe({
      next: () => {
        if (this.selectedDeviceId() === deviceId) {
          this.selectedDeviceId.set(null);
          this.conversations.set([]);
          this.activeConversation.set(null);
          this.viewMode.set('devices');
        }
        this.loadDevices();
      },
    });
  }

  openWorkspace(deviceId: string) {
    this.selectedDeviceId.set(deviceId);
    this.selectedConversationId.set(null);
    this.activeConversation.set(null);
    this.conversations.set([]);
    this.analysisResult.set(null);
    this.clearSelection();
    this.error.set(null);
    this.viewMode.set('workspace');
    this.loadConversations(deviceId);
  }

  backToDevices() {
    this.viewMode.set('devices');
    this.selectedConversationId.set(null);
    this.activeConversation.set(null);
    this.conversations.set([]);
    this.clearSelection();
  }

  loadConversations(deviceId: string, force = false) {
    if (this.conversationsLoadInFlight && !force) {
      return;
    }

    this.conversationsLoadInFlight = true;
    this.conversationsLoading.set(true);
    this.error.set(null);

    this.api.getConversations(deviceId).subscribe({
      next: (conversations) => {
        this.conversations.set(conversations ?? []);
        this.conversationsLoading.set(false);
        this.conversationsLoadInFlight = false;
      },
      error: (err) => {
        this.conversations.set([]);
        this.conversationsLoading.set(false);
        this.conversationsLoadInFlight = false;
        const message = this.extractErrorMessage(
          err,
          'No se pudieron cargar las conversaciones.',
        );
        this.error.set(message);
      },
    });
  }

  openConversation(conversationId: string) {
    this.selectedConversationId.set(conversationId);
    this.clearSelection();
    this.analysisResult.set(null);
    this.loading.set(true);
    this.error.set(null);

    this.api.getConversation(conversationId).subscribe({
      next: (conversation) => {
        this.activeConversation.set(conversation);
        this.loading.set(false);
      },
      error: (err) => {
        this.activeConversation.set(null);
        this.error.set(
          this.extractErrorMessage(err, 'No se pudo cargar la conversación.'),
        );
        this.loading.set(false);
      },
    });
  }

  onMessageClick(message: Message) {
    const fromId = this.selectionFromId();
    const toId = this.selectionToId();

    if (!fromId) {
      this.selectionFromId.set(message.id);
      this.selectionToId.set(message.id);
      return;
    }

    if (!toId || fromId === toId) {
      this.setOrderedSelection(fromId, message.id);
      return;
    }

    this.selectionFromId.set(message.id);
    this.selectionToId.set(message.id);
  }

  clearSelection() {
    this.selectionFromId.set(null);
    this.selectionToId.set(null);
  }

  analyzeSelection() {
    const conversation = this.activeConversation();
    const fromId = this.selectionFromId();
    const toId = this.selectionToId();

    if (!conversation || !fromId || !toId) {
      return;
    }

    const ordered = this.getOrderedRange(fromId, toId, conversation.messages);
    if (!ordered) {
      this.error.set('Selecciona un rango de mensajes válido.');
      return;
    }

    this.analyzing.set(true);
    this.error.set(null);
    this.analysisResult.set(null);

    this.api
      .analyzeConversation({
        conversationId: conversation.id,
        fromMessageId: ordered.fromId,
        toMessageId: ordered.toId,
      })
      .subscribe({
        next: (result) => {
          this.analysisResult.set(result);
          this.analyzing.set(false);
        },
        error: (err) => {
          const message =
            err?.error?.message ??
            'No se pudo completar el análisis. Verifica que Ollama esté activo.';
          this.error.set(
            Array.isArray(message) ? message.join(', ') : String(message),
          );
          this.analyzing.set(false);
        },
      });
  }

  isMessageSelected(message: Message): boolean {
    const fromId = this.selectionFromId();
    const toId = this.selectionToId();
    const conversation = this.activeConversation();

    if (!fromId || !toId || !conversation) {
      return false;
    }

    const ordered = this.getOrderedRange(fromId, toId, conversation.messages);
    if (!ordered) {
      return false;
    }

    const fromMsg = conversation.messages.find(
      (item) => item.id === ordered.fromId,
    );
    const toMsg = conversation.messages.find(
      (item) => item.id === ordered.toId,
    );

    if (!fromMsg || !toMsg) {
      return false;
    }

    const sentAt = new Date(message.sentAt).getTime();
    return (
      sentAt >= new Date(fromMsg.sentAt).getTime() &&
      sentAt <= new Date(toMsg.sentAt).getTime()
    );
  }

  isSelectionEndpoint(message: Message): 'from' | 'to' | null {
    const fromId = this.selectionFromId();
    const toId = this.selectionToId();
    const conversation = this.activeConversation();

    if (!fromId || !toId || !conversation) {
      return null;
    }

    const ordered = this.getOrderedRange(fromId, toId, conversation.messages);
    if (!ordered) {
      return null;
    }

    if (message.id === ordered.fromId) {
      return 'from';
    }
    if (message.id === ordered.toId) {
      return 'to';
    }
    return null;
  }

  conversationTitle(
    conversation: ConversationListItem | ConversationDetail,
  ): string {
    return formatConversationTitle(
      conversation.jid,
      conversation.contact,
      conversation.title,
    );
  }

  previewText(conversation: ConversationListItem): string {
    const last = conversation.messages[0];
    if (!last?.text) {
      return 'Sin mensajes de texto';
    }
    return last.fromMe ? `Tú: ${last.text}` : last.text;
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatMessageTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  priorityLabel(priority: 'low' | 'medium' | 'high'): string {
    return (
      {
        low: 'Baja',
        medium: 'Media',
        high: 'Alta',
      } as const
    )[priority];
  }

  statusLabel(status: DeviceStatus): string {
    const labels: Record<DeviceStatus, string> = {
      [DeviceStatus.DISCONNECTED]: 'Desconectado',
      [DeviceStatus.CONNECTING]: 'Conectando...',
      [DeviceStatus.QR_READY]: 'Esperando QR',
      [DeviceStatus.CONNECTED]: 'Conectado',
      [DeviceStatus.ERROR]: 'Error',
    };
    return labels[status];
  }

  getQrUrl(qr: string): string {
    return `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qr)}`;
  }

  private scheduleConversationsRefresh(deviceId: string) {
    if (this.conversationsRefreshTimer) {
      clearTimeout(this.conversationsRefreshTimer);
    }

    this.conversationsRefreshTimer = setTimeout(() => {
      this.conversationsRefreshTimer = null;
      this.loadConversations(deviceId);
    }, 1500);
  }

  private extractErrorMessage(err: unknown, fallback: string): string {
    const error = err as {
      error?: { message?: string | string[] };
      message?: string;
    };

    const message = error?.error?.message ?? error?.message ?? fallback;
    return Array.isArray(message) ? message.join(', ') : String(message);
  }

  private setOrderedSelection(firstId: string, secondId: string) {
    const conversation = this.activeConversation();
    if (!conversation) {
      return;
    }

    const ordered = this.getOrderedRange(firstId, secondId, conversation.messages);
    if (!ordered) {
      return;
    }

    this.selectionFromId.set(ordered.fromId);
    this.selectionToId.set(ordered.toId);
  }

  private getOrderedRange(
    firstId: string,
    secondId: string,
    messages: Message[],
  ): { fromId: string; toId: string } | null {
    const first = messages.find((message) => message.id === firstId);
    const second = messages.find((message) => message.id === secondId);

    if (!first || !second) {
      return null;
    }

    if (new Date(first.sentAt) <= new Date(second.sentAt)) {
      return { fromId: first.id, toId: second.id };
    }

    return { fromId: second.id, toId: first.id };
  }
}
