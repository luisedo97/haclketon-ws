import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceStatus } from '@prisma/client';
import makeWASocket, {
  DisconnectReason,
  WASocket,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  proto,
} from '@whiskeysockets/baileys';
import { makeInMemoryStore } from '@whiskeysockets/baileys/lib/Store';
import type { Chat, Contact as BaileysContact } from '@whiskeysockets/baileys/lib/Types';
import * as fs from 'fs';
import * as path from 'path';
import { CreateDeviceDto } from '../../common/dto';
import { DeviceStatus as SharedDeviceStatus, parsePhoneFromJid } from '@ws-spy/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EventsGateway } from '../events/events.gateway';
import { HeuristicsService } from '../ai/heuristics.service';
import { LinkCodesService } from '../auth/link-codes.service';
import { MonitoredGroupsService } from '../monitored-groups/monitored-groups.service';

const LINK_CODE_RE = /^\d{6}$/;

interface MessageHandleOptions {
  /** Emitir al frontend en tiempo real (solo mensajes nuevos en vivo). */
  live?: boolean;
  /** Omitir allowlist de grupos monitoreados (sync histórico de todos los grupos). */
  skipMonitoredCheck?: boolean;
}

interface ActiveSession {
  socket: WASocket;
  deviceId: string;
  store: ReturnType<typeof makeInMemoryStore>;
  storeInterval?: ReturnType<typeof setInterval>;
  persistStoreFile?: () => void;
  historyBackfillDone?: boolean;
}

@Injectable()
export class WhatsappService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly sessionsPath: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly eventsGateway: EventsGateway,
    private readonly heuristicsService: HeuristicsService,
    private readonly monitoredGroupsService: MonitoredGroupsService,
    private readonly linkCodesService: LinkCodesService,
  ) {
    this.sessionsPath =
      this.configService.get<string>('SESSIONS_PATH') ?? './sessions';
    if (!fs.existsSync(this.sessionsPath)) {
      fs.mkdirSync(this.sessionsPath, { recursive: true });
    }
  }

  async onModuleInit() {
    const devices = await this.prisma.device.findMany({
      where: {
        status: {
          in: [
            DeviceStatus.CONNECTED,
            DeviceStatus.CONNECTING,
            DeviceStatus.QR_READY,
          ],
        },
      },
    });

    for (const device of devices) {
      this.logger.log(`Restoring WhatsApp session for device ${device.id}`);
      void this.connect(device.id).catch((error) => {
        this.logger.error(
          `Failed to restore device ${device.id}: ${error instanceof Error ? error.message : error}`,
        );
      });
    }
  }

  async onModuleDestroy() {
    for (const [deviceId] of this.sessions) {
      await this.disconnect(deviceId);
    }
  }

  findAllDevices() {
    return this.prisma.device.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findDevice(id: string) {
    const device = await this.prisma.device.findUnique({ where: { id } });
    if (!device) {
      throw new NotFoundException(`Device ${id} not found`);
    }
    return device;
  }

  async createDevice(dto: CreateDeviceDto) {
    const sessionPath = path.join(
      this.sessionsPath,
      `auth_info_${Date.now()}`,
    );

    const device = await this.prisma.device.create({
      data: {
        label: dto.label,
        sessionPath,
        status: DeviceStatus.DISCONNECTED,
      },
    });

    return device;
  }

  async connect(deviceId: string) {
    const device = await this.findDevice(deviceId);

    if (this.sessions.has(deviceId)) {
      return device;
    }

    await this.updateDeviceStatus(deviceId, DeviceStatus.CONNECTING);

    if (!fs.existsSync(device.sessionPath)) {
      fs.mkdirSync(device.sessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(
      device.sessionPath,
    );
    const { version } = await fetchLatestBaileysVersion();

    const socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      // Mac OS / Windows permiten syncFullHistory (historial completo al vincular).
      browser: ['Mac OS', 'Desktop', '1.0.0'],
      syncFullHistory: true,
      shouldIgnoreJid: (jid) => {
        if (!jid) return true;
        if (this.shouldIgnoreJid(jid)) return true;
        return !this.isGroupJid(jid);
      },
      getMessage: async (key) => {
        const session = this.sessions.get(deviceId);
        if (!key.remoteJid || !key.id || !session) {
          return undefined;
        }
        const stored = await session.store.loadMessage(key.remoteJid, key.id);
        return stored?.message ?? undefined;
      },
    });

    const store = makeInMemoryStore({});
    const storePath = path.join(device.sessionPath, 'store.json');

    if (fs.existsSync(storePath)) {
      try {
        store.readFromFile(storePath);
        this.logger.log(`Loaded Baileys store from ${storePath}`);
      } catch (error) {
        this.logger.warn(
          `Could not load Baileys store for ${deviceId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    store.bind(socket.ev);

    const persistStoreFile = () => {
      try {
        store.writeToFile(storePath);
      } catch (error) {
        this.logger.warn(
          `Could not write Baileys store for ${deviceId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    };

    const storeInterval = setInterval(persistStoreFile, 30_000);

    this.sessions.set(deviceId, {
      socket,
      deviceId,
      store,
      storeInterval,
      persistStoreFile,
    });

    socket.ev.on('creds.update', saveCreds);

    socket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        await this.updateDeviceStatus(deviceId, DeviceStatus.QR_READY);
        this.eventsGateway.emitQr({ deviceId, qr });
      }

      if (connection === 'open') {
        const phoneE164 =
          socket.user?.id?.split(':')[0]?.replace('@s.whatsapp.net', '') ??
          null;
        await this.prisma.device.update({
          where: { id: deviceId },
          data: { status: DeviceStatus.CONNECTED, phoneE164 },
        });
        this.eventsGateway.emitDeviceStatus({
          deviceId,
          status: SharedDeviceStatus.CONNECTED,
          phoneE164,
        });
        this.logger.log(`Device ${deviceId} connected as ${phoneE164}`);
        void this.scheduleStoreBackfill(deviceId);
      }

      if (connection === 'close') {
        const statusCode = (
          lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
        )?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        const session = this.sessions.get(deviceId);
        if (session?.storeInterval) {
          clearInterval(session.storeInterval);
        }
        session?.persistStoreFile?.();

        this.sessions.delete(deviceId);

        if (shouldReconnect) {
          this.logger.warn(`Device ${deviceId} disconnected, reconnecting...`);
          await this.updateDeviceStatus(deviceId, DeviceStatus.CONNECTING);
          setTimeout(() => void this.connect(deviceId), 3000);
        } else {
          await this.updateDeviceStatus(deviceId, DeviceStatus.DISCONNECTED);
          this.logger.log(`Device ${deviceId} logged out`);
        }
      }
    });

    socket.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify' && type !== 'append') {
        return;
      }

      const isLive = type === 'notify';
      void this.processMessageBatch(deviceId, messages, {
        live: isLive,
        skipMonitoredCheck: !isLive,
      }).catch((error) => {
        this.logger.error(
          `Failed to process messages.upsert for ${deviceId}: ${error instanceof Error ? error.message : error}`,
        );
      });
    });

    socket.ev.on('messaging-history.set', ({ chats, contacts, messages, isLatest, progress }) => {
      void this.handleMessagingHistorySet(deviceId, {
        chats,
        contacts,
        messages,
        isLatest,
        progress,
      }).catch((error) => {
        this.logger.error(
          `Failed to process messaging-history.set for ${deviceId}: ${error instanceof Error ? error.message : error}`,
        );
      });
    });

    socket.ev.on('messages.update', (updates) => {
      void this.processMessageUpdates(deviceId, updates).catch((error) => {
        this.logger.error(
          `Failed to process messages.update for ${deviceId}: ${error instanceof Error ? error.message : error}`,
        );
      });
    });

    socket.ev.on('messages.delete', (item) => {
      void this.processMessageDeletes(deviceId, item).catch((error) => {
        this.logger.error(
          `Failed to process messages.delete for ${deviceId}: ${error instanceof Error ? error.message : error}`,
        );
      });
    });

    socket.ev.on('contacts.upsert', async (contacts) => {
      for (const contact of contacts) {
        await this.syncContact(deviceId, contact);
      }
    });

    socket.ev.on('contacts.update', async (contacts) => {
      for (const contact of contacts) {
        if (!contact.id) {
          continue;
        }
        await this.syncContact(deviceId, {
          id: contact.id,
          ...contact,
        });
      }
    });

    socket.ev.on('chats.upsert', async (chats) => {
      for (const chat of chats) {
        await this.syncChat(deviceId, chat);
      }
    });

    socket.ev.on('chats.update', async (updates) => {
      for (const chat of updates) {
        if (!chat.id) {
          continue;
        }
        await this.syncChat(deviceId, chat as Chat);
      }
    });

    return this.findDevice(deviceId);
  }

  async disconnect(deviceId: string) {
    const session = this.sessions.get(deviceId);
    if (session) {
      session.socket.end(undefined);
      this.sessions.delete(deviceId);
    }
    await this.updateDeviceStatus(deviceId, DeviceStatus.DISCONNECTED);
    return { success: true };
  }

  async removeDevice(deviceId: string) {
    await this.disconnect(deviceId);
    const device = await this.findDevice(deviceId);

    if (fs.existsSync(device.sessionPath)) {
      fs.rmSync(device.sessionPath, { recursive: true, force: true });
    }

    return this.prisma.device.delete({ where: { id: deviceId } });
  }

  private async syncContact(deviceId: string, contact: BaileysContact) {
    try {
      const jid = contact.id;
      if (!jid || this.shouldIgnoreJid(jid)) {
        return;
      }

      const contactKey = this.getContactKey(jid);
      if (!contactKey) {
        return;
      }

      const displayName = this.resolveContactDisplayName(contact);
      const pushName = contact.notify ?? null;

      const saved = await this.prisma.contact.upsert({
        where: {
          deviceId_phoneE164: { deviceId, phoneE164: contactKey },
        },
        create: {
          deviceId,
          phoneE164: contactKey,
          displayName: displayName ?? pushName ?? 'Contacto',
          pushName,
          isManual: false,
        },
        update: {
          ...(displayName ? { displayName } : {}),
          ...(pushName ? { pushName } : {}),
        },
      });

      await this.prisma.conversation.updateMany({
        where: { deviceId, jid },
        data: { contactId: saved.id },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to sync contact for ${deviceId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async syncChat(deviceId: string, chat: Chat) {
    try {
      const jid = chat.id;
      if (!jid || this.shouldIgnoreJid(jid)) {
        return;
      }

      if (!this.isGroupJid(jid)) {
        return;
      }

      const title = chat.name ?? null;
      const lastMessageAt = chat.conversationTimestamp
        ? new Date(Number(chat.conversationTimestamp) * 1000)
        : chat.lastMessageRecvTimestamp
          ? new Date(chat.lastMessageRecvTimestamp)
          : undefined;

      const contactId = await this.ensureContactForJid(
        deviceId,
        jid,
        title,
      );

      await this.prisma.conversation.upsert({
        where: {
          deviceId_jid: { deviceId, jid },
        },
        create: {
          deviceId,
          jid,
          title,
          contactId,
          lastMessageAt,
        },
        update: {
          ...(title ? { title } : {}),
          ...(lastMessageAt ? { lastMessageAt } : {}),
          ...(contactId ? { contactId } : {}),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to sync chat for ${deviceId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async handleMessagingHistorySet(
    deviceId: string,
    payload: {
      chats: Chat[];
      contacts: BaileysContact[];
      messages: proto.IWebMessageInfo[];
      isLatest?: boolean;
      progress?: number | null;
    },
  ) {
    const { chats, contacts, messages, isLatest, progress } = payload;

    for (const contact of contacts) {
      await this.syncContact(deviceId, contact);
    }

    for (const chat of chats) {
      await this.syncChat(deviceId, chat);
    }

    await this.processMessageBatch(deviceId, messages, {
      live: false,
      skipMonitoredCheck: true,
    });

    this.eventsGateway.emitHistorySync({
      deviceId,
      progress,
      isLatest,
    });

    if (isLatest) {
      const session = this.sessions.get(deviceId);
      session?.persistStoreFile?.();
      this.logger.log(`Historial completo sincronizado para device ${deviceId}`);
    } else if (progress != null) {
      this.logger.log(
        `Sincronizando historial para device ${deviceId}: ${progress}%`,
      );
    }
  }

  private async processMessageBatch(
    deviceId: string,
    messages: proto.IWebMessageInfo[],
    options: MessageHandleOptions,
  ) {
    for (const msg of messages) {
      await this.handleIncomingMessage(deviceId, msg, options);
    }
  }

  private async processMessageUpdates(
    deviceId: string,
    updates: { key: proto.IMessageKey; update: Partial<proto.IWebMessageInfo> }[],
  ) {
    for (const { key, update } of updates) {
      await this.handleMessageUpdate(deviceId, key, update);
    }
  }

  private async processMessageDeletes(
    deviceId: string,
    item:
      | { keys: proto.IMessageKey[] }
      | { jid: string; all: true },
  ) {
    if ('all' in item) {
      const jid = item.jid;
      if (!this.isGroupJid(jid)) {
        return;
      }

      const conversation = await this.prisma.conversation.findUnique({
        where: { deviceId_jid: { deviceId, jid } },
        select: { id: true },
      });
      if (!conversation) {
        return;
      }

      await this.prisma.message.deleteMany({
        where: { conversationId: conversation.id },
      });
      return;
    }

    for (const key of item.keys) {
      if (!key.remoteJid || !key.id || !this.isGroupJid(key.remoteJid)) {
        continue;
      }

      const conversation = await this.prisma.conversation.findUnique({
        where: { deviceId_jid: { deviceId, jid: key.remoteJid } },
        select: { id: true },
      });
      if (!conversation) {
        continue;
      }

      await this.prisma.message.deleteMany({
        where: {
          conversationId: conversation.id,
          externalId: key.id,
        },
      });
    }
  }

  private async handleMessageUpdate(
    deviceId: string,
    key: proto.IMessageKey,
    update: Partial<proto.IWebMessageInfo>,
  ) {
    if (!key.remoteJid || !key.id || !this.isGroupJid(key.remoteJid)) {
      return;
    }

    if (!update.message) {
      return;
    }

    const text = this.extractMessageText(update.message);
    if (text === null) {
      return;
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { deviceId_jid: { deviceId, jid: key.remoteJid } },
      select: { id: true },
    });
    if (!conversation) {
      return;
    }

    const savedMessage = await this.prisma.message.updateMany({
      where: {
        conversationId: conversation.id,
        externalId: key.id,
      },
      data: { text },
    });

    if (savedMessage.count === 0) {
      return;
    }

    const message = await this.prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        externalId: key.id,
      },
    });
    if (!message) {
      return;
    }

    this.eventsGateway.emitMessage({
      deviceId,
      message: {
        id: message.id,
        conversationId: message.conversationId,
        externalId: message.externalId,
        fromMe: message.fromMe,
        text: message.text,
        mediaUrl: message.mediaUrl,
        sentAt: message.sentAt.toISOString(),
      },
    });
  }

  private scheduleStoreBackfill(deviceId: string) {
    setTimeout(() => {
      void this.backfillFromStore(deviceId).catch((error) => {
        this.logger.warn(
          `Store backfill failed for ${deviceId}: ${error instanceof Error ? error.message : error}`,
        );
      });
    }, 8_000);
  }

  private async backfillFromStore(deviceId: string) {
    const session = this.sessions.get(deviceId);
    if (!session || session.historyBackfillDone) {
      return;
    }

    session.historyBackfillDone = true;

    const chats = session.store.chats.all();
    let total = 0;

    for (const chat of chats) {
      if (!this.isGroupJid(chat.id)) {
        continue;
      }

      const msgList = session.store.messages[chat.id];
      if (!msgList) {
        continue;
      }

      const messages = msgList.toJSON();
      total += messages.length;

      await this.processMessageBatch(deviceId, messages, {
        live: false,
        skipMonitoredCheck: true,
      });
    }

    if (total > 0) {
      this.logger.log(
        `Backfill desde store completado para ${deviceId}: ${total} mensajes de grupo`,
      );
      this.eventsGateway.emitHistorySync({
        deviceId,
        isLatest: true,
      });
    }
  }

  private async handleIncomingMessage(
    deviceId: string,
    msg: proto.IWebMessageInfo,
    options: MessageHandleOptions = {},
  ) {
    const { live = true, skipMonitoredCheck = false } = options;

    try {
      if (!msg.key?.remoteJid || !msg.message) {
        return;
      }

      const jid = msg.key.remoteJid;
      if (this.shouldIgnoreJid(jid)) {
        return;
      }

      if (!this.isGroupJid(jid)) {
        return;
      }

      const candidateText = this.extractMessageText(msg.message);
      if (live) {
        const consumed = await this.tryConsumeLinkCode(msg, candidateText);
        if (consumed) {
          // El mensaje del código no se persiste — privacidad y para no
          // dejar el código en el feed del grupo si alguien lo audita.
          return;
        }
      }

      if (!skipMonitoredCheck) {
        const allowed = await this.monitoredGroupsService.isMonitored(
          deviceId,
          jid,
        );
        if (!allowed) {
          return;
        }
      }

      const externalId = msg.key.id ?? `${Date.now()}`;
      const fromMe = msg.key.fromMe ?? false;
      const text = this.extractMessageText(msg.message);
      const sentAt = this.extractMessageDate(msg.messageTimestamp);
      const pushName = msg.pushName ?? undefined;

      const contactId = await this.ensureContactForJid(
        deviceId,
        jid,
        pushName,
      );

      const conversation = await this.prisma.conversation.upsert({
        where: {
          deviceId_jid: { deviceId, jid },
        },
        create: {
          deviceId,
          jid,
          lastMessageAt: sentAt,
          contactId,
        },
        update: {
          lastMessageAt: sentAt,
          ...(contactId ? { contactId } : {}),
        },
      });

      const savedMessage = await this.prisma.message.upsert({
        where: {
          conversationId_externalId: {
            conversationId: conversation.id,
            externalId,
          },
        },
        create: {
          conversationId: conversation.id,
          externalId,
          fromMe,
          text,
          sentAt,
        },
        update: {
          text,
        },
      });

      if (live) {
        this.eventsGateway.emitMessage({
          deviceId,
          message: {
            id: savedMessage.id,
            conversationId: savedMessage.conversationId,
            externalId: savedMessage.externalId,
            fromMe: savedMessage.fromMe,
            text: savedMessage.text,
            mediaUrl: savedMessage.mediaUrl,
            sentAt: savedMessage.sentAt.toISOString(),
          },
        });

        await this.maybeEnqueueForAnalysis(savedMessage.id, text, jid);
      }
    } catch (error) {
      this.logger.error(
        `Failed to persist message for device ${deviceId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private async tryConsumeLinkCode(
    msg: proto.IWebMessageInfo,
    text: string | null,
  ): Promise<boolean> {
    if (!text) return false;
    const trimmed = text.trim();
    if (!LINK_CODE_RE.test(trimmed)) return false;

    const participantJid = msg.key.participant ?? undefined;
    if (!participantJid) return false;
    const phone = parsePhoneFromJid(participantJid);
    if (!phone) return false;

    const userId = await this.linkCodesService.consume(trimmed, participantJid);
    if (!userId) return false;

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { phoneE164: phone },
      });
      this.logger.log(`Usuario ${userId} vinculado al número +${phone}`);
    } catch (error) {
      const isUniqueConflict =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === 'P2002';
      if (isUniqueConflict) {
        this.logger.warn(
          `No se pudo vincular ${phone} al usuario ${userId}: el número ya está vinculado a otra cuenta`,
        );
      } else {
        this.logger.error(
          `Error vinculando ${phone} al usuario ${userId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return true;
  }

  private async maybeEnqueueForAnalysis(
    messageId: string,
    text: string | null,
    jid: string,
  ) {
    const decision = this.heuristicsService.evaluate(text, jid);
    if (!decision.enqueue) {
      return;
    }
    try {
      await this.prisma.analysisQueue.create({
        data: { messageId },
      });
    } catch (error) {
      const isDuplicate =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === 'P2002';
      if (!isDuplicate) {
        this.logger.warn(
          `No se pudo encolar mensaje ${messageId}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  private async ensureContactForJid(
    deviceId: string,
    jid: string,
    preferredName?: string | null,
  ): Promise<string | undefined> {
    const contactKey = this.getContactKey(jid);
    if (!contactKey) {
      return undefined;
    }

    const phoneE164 = parsePhoneFromJid(jid);
    const displayName =
      preferredName?.trim() ||
      (phoneE164 ? `+${phoneE164}` : 'Contacto');

    const contact = await this.prisma.contact.upsert({
      where: {
        deviceId_phoneE164: { deviceId, phoneE164: contactKey },
      },
      create: {
        deviceId,
        phoneE164: contactKey,
        displayName,
        pushName: preferredName?.trim() ?? null,
        isManual: false,
      },
      update: {
        ...(preferredName?.trim()
          ? {
              pushName: preferredName.trim(),
              displayName: preferredName.trim(),
            }
          : {}),
      },
    });

    return contact.id;
  }

  private getContactKey(jid: string): string | null {
    const phone = parsePhoneFromJid(jid);
    if (phone) {
      return phone;
    }

    if (jid.endsWith('@lid')) {
      return jid.split('@')[0]?.split(':')[0] ?? null;
    }

    return null;
  }

  private resolveContactDisplayName(contact: BaileysContact): string | null {
    return (
      contact.name?.trim() ||
      contact.notify?.trim() ||
      contact.verifiedName?.trim() ||
      null
    );
  }

  private shouldIgnoreJid(jid: string): boolean {
    return jid === 'status@broadcast' || jid.endsWith('@broadcast');
  }

  private isGroupJid(jid: string): boolean {
    return jid.endsWith('@g.us');
  }

  private async updateDeviceStatus(deviceId: string, status: DeviceStatus) {
    await this.prisma.device.update({
      where: { id: deviceId },
      data: { status },
    });
    this.eventsGateway.emitDeviceStatus({
      deviceId,
      status: status as SharedDeviceStatus,
    });
  }

  private extractMessageText(message: proto.IMessage): string | null {
    return (
      message.conversation ??
      message.extendedTextMessage?.text ??
      message.imageMessage?.caption ??
      message.videoMessage?.caption ??
      message.documentMessage?.caption ??
      null
    );
  }

  private extractMessageDate(
    messageTimestamp: proto.IWebMessageInfo['messageTimestamp'],
  ): Date {
    const raw =
      typeof messageTimestamp === 'object' &&
      messageTimestamp !== null &&
      'toNumber' in messageTimestamp
        ? (messageTimestamp as { toNumber: () => number }).toNumber()
        : Number(messageTimestamp);

    if (!Number.isFinite(raw) || raw <= 0) {
      return new Date();
    }

    return new Date(raw * 1000);
  }
}
