import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { EventsModule } from './modules/events/events.module';
import { HealthModule } from './modules/health/health.module';
import { MonitoredGroupsModule } from './modules/monitored-groups/monitored-groups.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { PrismaModule } from './prisma/prisma.module';

const WEB_ROOT_CANDIDATES = [
  process.env.WEB_ROOT,
  resolve(__dirname, '../../../apps/desktop/renderer/dist/ws-spy-renderer/browser'),
  resolve(__dirname, '../../desktop/renderer/dist/ws-spy-renderer/browser'),
  resolve(__dirname, '../web'),
].filter((p): p is string => !!p);

function resolveWebRoot(): string | null {
  for (const candidate of WEB_ROOT_CANDIDATES) {
    if (existsSync(join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return null;
}

function buildStaticModules(): DynamicModule[] {
  const root = resolveWebRoot();
  if (!root) {
    return [];
  }
  return [
    ServeStaticModule.forRoot({
      rootPath: root,
      serveRoot: '/',
      exclude: [
        '/auth/(.*)',
        '/devices/(.*)',
        '/devices',
        '/conversations/(.*)',
        '/conversations',
        '/tasks/(.*)',
        '/tasks',
        '/proposals/(.*)',
        '/proposals',
        '/users/(.*)',
        '/users',
        '/monitored-groups/(.*)',
        '/monitored-groups',
        '/ai/(.*)',
        '/health',
        '/socket.io/(.*)',
      ],
      serveStaticOptions: {
        fallthrough: true,
        index: ['index.html'],
      },
    }),
  ];
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    PrismaModule,
    EventsModule,
    AuthModule,
    HealthModule,
    MonitoredGroupsModule,
    WhatsappModule,
    ContactsModule,
    ConversationsModule,
    TasksModule,
    UsersModule,
    AiModule,
    ...buildStaticModules(),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
