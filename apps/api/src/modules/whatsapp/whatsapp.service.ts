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

interface ActiveSession {
  socket: WASocket;
  deviceId: string;
  store: ReturnType<typeof makeInMemoryStore>;
  storeInterval?: ReturnType<typeof setInterval>;
  persistStoreFile?: () => void;
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
      browser: ['ws-spy', 'Desktop', '1.0.0'],
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

    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') {
        return;
      }

      for (const msg of messages) {
        await this.handleIncomingMessage(deviceId, msg);
      }
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

  private async handleIncomingMessage(
    deviceId: string,
    msg: proto.IWebMessageInfo,
  ) {
    try {
      if (!msg.key?.remoteJid || !msg.message) {
        return;
      }

      const jid = msg.key.remoteJid;
      if (this.shouldIgnoreJid(jid)) {
        return;
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
    } catch (error) {
      this.logger.error(
        `Failed to persist message for device ${deviceId}: ${error instanceof Error ? error.message : error}`,
      );
    }
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
