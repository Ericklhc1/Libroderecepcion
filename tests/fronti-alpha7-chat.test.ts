import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  normalizeFrontiReply,
  userExplicitlyRequestedTable,
} from '@/server/ai/fronti-v2/response-style';

describe('FRONTI alpha.7 · chat integrado e individual', () => {
  it('degrada tablas Markdown a texto compacto salvo petición explícita', () => {
    const table = [
      '| Área | Estado |',
      '| --- | --- |',
      '| Caja | Cuadrada |',
      '| Garantías | 1 pendiente |',
    ].join('\n');

    const compact = normalizeFrontiReply(table, 'Revisa cómo va todo');
    expect(compact).toContain('- **Área:** Caja · **Estado:** Cuadrada');
    expect(compact).toContain('- **Área:** Garantías · **Estado:** 1 pendiente');
    expect(compact).not.toContain('| --- |');

    expect(userExplicitlyRequestedTable('Hazme una tabla comparativa')).toBe(true);
    expect(normalizeFrontiReply(table, 'Hazme una tabla comparativa')).toBe(table);
  });

  it('modela a Fronti como actor nativo, no como usuario humano ficticio', () => {
    const schema = readFileSync('prisma/schema.prisma', 'utf8');
    const migration = readFileSync(
      'prisma/migrations/20260925005000_fronti_chat_actor/migration.sql',
      'utf8',
    );

    expect(schema).toContain('FRONTI');
    expect(schema).toContain('enum ChatMessageAuthor');
    expect(schema).toContain('senderId        String?');
    expect(schema).toContain('author          ChatMessageAuthor @default(USER)');
    expect(migration).toContain('CREATE TYPE "ChatMessageAuthor"');
    expect(migration).toContain('ALTER COLUMN "senderId" DROP NOT NULL');
  });

  it('crea un chat privado por usuario y sólo guarda memoria desde ese chat', () => {
    const source = readFileSync('src/server/ai/fronti-chat.ts', 'utf8');
    const chat = readFileSync('src/server/services/chat.ts', 'utf8');

    expect(source).toContain('conversation.type === ChatConversationType.FRONTI');
    expect(chat).toContain('const directKey = `fronti:${user.id}`');
    expect(source).toContain('if (privateFronti && memoryContext)');
    expect(source).toContain('extractAndStoreMemories');
    expect(source).toContain('El contexto de este chat NO es memoria personal');
  });

  it('permite @Fronti en chats humanos respetando permisos del invocador', () => {
    const source = readFileSync('src/server/ai/fronti-chat.ts', 'utf8');
    const route = readFileSync(
      'src/app/api/chat/conversations/[id]/messages/route.ts',
      'utf8',
    );

    expect(source).toContain('/(^|\\s)@fronti\\b/i');
    expect(source).toContain('canUseFronti(user, config.enabled)');
    expect(source).toContain('runReceptionAssistant(user, modelMessages)');
    expect(route).toContain('maybeInvokeFrontiInChat');
  });

  it('integra Fronti en la única burbuja del chat para cuentas operativas', () => {
    const widget = readFileSync('src/components/layout/chat-widget.tsx', 'utf8');
    const layout = readFileSync('src/app/(app)/layout.tsx', 'utf8');

    expect(widget).toContain("item.type === 'FRONTI'");
    expect(widget).toContain("snapshot?.type === 'FRONTI'");
    expect(widget).toContain("insertMentionToken('Fronti')");
    expect(widget).toContain('Fronti está pensando');
    expect(widget).toContain('renderFrontiBody');
    expect(layout).toContain('(!user.roleOperational || user.isSystemAdmin)');
  });

  it('normaliza tokens pegados con Bearer o comillas antes de autenticar', () => {
    const provider = readFileSync('src/server/ai/fronti-provider.ts', 'utf8');

    expect(provider).toContain('function normalizeProviderSecret');
    expect(provider).toContain("replace(/^Bearer\\s+/i, '')");
    expect(provider).toContain('normalizeProviderSecret(apiKey)');
  });
});