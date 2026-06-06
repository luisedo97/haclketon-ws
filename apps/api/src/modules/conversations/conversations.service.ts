import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { parsePhoneFromJid } from '@ws-spy/shared';
import { Message, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(deviceId?: string) {
    const where = await this.buildConversationFilter(deviceId);

    const conversations = await this.prisma.conversation.findMany({
      where,
      include: {
        contact: true,
        messages: {
          take: 1,
          orderBy: { sentAt: 'desc' },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
    });

    return this.dedupeByJid(conversations);
  }

  async findOne(id: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        contact: true,
        messages: {
          orderBy: { sentAt: 'asc' },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }

    const linked = await this.ensureContactLinked(conversation);
    const messages = await this.loadMergedMessages(
      linked.jid,
      linked.deviceId,
      linked.messages,
    );

    return {
      ...linked,
      messages,
    };
  }

  async getMessagesInRange(
    conversationId: string,
    fromMessageId: string,
    toMessageId: string,
  ) {
    const conversation = await this.findOne(conversationId);

    const fromMessage = conversation.messages.find(
      (message) => message.id === fromMessageId,
    );
    const toMessage = conversation.messages.find(
      (message) => message.id === toMessageId,
    );

    if (!fromMessage || !toMessage) {
      throw new BadRequestException(
        'Los mensajes seleccionados no pertenecen a esta conversación',
      );
    }

    if (fromMessage.sentAt > toMessage.sentAt) {
      throw new BadRequestException(
        'El mensaje inicial debe ser anterior o igual al mensaje final',
      );
    }

    const messages = conversation.messages.filter(
      (message) =>
        message.sentAt >= fromMessage.sentAt &&
        message.sentAt <= toMessage.sentAt,
    );

    return {
      conversation,
      fromMessage,
      toMessage,
      messages,
    };
  }

  private async buildConversationFilter(
    deviceId?: string,
  ): Promise<Prisma.ConversationWhereInput> {
    const baseFilter: Prisma.ConversationWhereInput = {
      jid: {
        notIn: ['status@broadcast'],
      },
      NOT: {
        jid: {
          endsWith: '@broadcast',
        },
      },
    };

    if (!deviceId) {
      return baseFilter;
    }

    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      return { ...baseFilter, deviceId: '__missing__' };
    }

    if (!device.phoneE164) {
      return { ...baseFilter, deviceId };
    }

    const relatedDevices = await this.prisma.device.findMany({
      where: { phoneE164: device.phoneE164 },
      select: { id: true },
    });

    return {
      ...baseFilter,
      deviceId: {
        in: relatedDevices.map((item) => item.id),
      },
    };
  }

  private dedupeByJid<
    T extends {
      jid: string;
      lastMessageAt: Date | null;
    },
  >(conversations: T[]): T[] {
    const byJid = new Map<string, T>();

    for (const conversation of conversations) {
      const existing = byJid.get(conversation.jid);
      if (
        !existing ||
        (conversation.lastMessageAt &&
          (!existing.lastMessageAt ||
            conversation.lastMessageAt > existing.lastMessageAt))
      ) {
        byJid.set(conversation.jid, conversation);
      }
    }

    return Array.from(byJid.values()).sort(
      (a, b) =>
        new Date(b.lastMessageAt ?? 0).getTime() -
        new Date(a.lastMessageAt ?? 0).getTime(),
    );
  }

  private async loadMergedMessages(
    jid: string,
    deviceId: string,
    fallbackMessages: Message[],
  ): Promise<Message[]> {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device?.phoneE164) {
      return fallbackMessages;
    }

    const relatedConversations = await this.prisma.conversation.findMany({
      where: {
        jid,
        device: { phoneE164: device.phoneE164 },
      },
      select: { id: true },
    });

    if (relatedConversations.length <= 1) {
      return fallbackMessages;
    }

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId: {
          in: relatedConversations.map((item) => item.id),
        },
      },
      orderBy: { sentAt: 'asc' },
    });

    const unique = new Map<string, Message>();
    for (const message of messages) {
      unique.set(`${message.conversationId}:${message.externalId}`, message);
    }

    return Array.from(unique.values()).sort(
      (a, b) => a.sentAt.getTime() - b.sentAt.getTime(),
    );
  }

  private async ensureContactLinked<
    T extends {
      id: string;
      deviceId: string;
      jid: string;
      contactId: string | null;
      contact: {
        id: string;
        displayName: string;
        phoneE164: string;
        pushName?: string | null;
      } | null;
    },
  >(conversation: T): Promise<T> {
    if (conversation.contactId && conversation.contact) {
      return conversation;
    }

    const phoneE164 = parsePhoneFromJid(conversation.jid);
    const contactKey =
      phoneE164 ??
      (conversation.jid.endsWith('@lid')
        ? conversation.jid.split('@')[0]?.split(':')[0]
        : null);

    if (!contactKey) {
      return conversation;
    }

    const contact = await this.prisma.contact.upsert({
      where: {
        deviceId_phoneE164: {
          deviceId: conversation.deviceId,
          phoneE164: contactKey,
        },
      },
      create: {
        deviceId: conversation.deviceId,
        phoneE164: contactKey,
        displayName: phoneE164 ? `+${phoneE164}` : 'Contacto',
        isManual: false,
      },
      update: {},
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { contactId: contact.id },
    });

    return {
      ...conversation,
      contactId: contact.id,
      contact,
    };
  }
}
