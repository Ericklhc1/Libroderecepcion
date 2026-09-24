import { describe, expect, it } from 'vitest';
import {
  CHAT_BODY_MAX,
  CHAT_STICKERS,
  directConversationKey,
  isChatStickerKey,
  normalizeChatText,
  normalizeInternalChatHref,
} from '@/domain/chat';

describe('contrato ligero del chat', () => {
  it('deduplica una conversación directa sin importar quién la inicia', () => {
    expect(directConversationKey('b', 'a')).toBe(directConversationKey('a', 'b'));
    expect(directConversationKey('b', 'a')).toBe('a:b');
  });

  it('sólo admite enlaces internos del Libro', () => {
    expect(normalizeInternalChatHref('/caja?turno=1')).toBe('/caja?turno=1');
    expect(normalizeInternalChatHref('//externo.example')).toBeNull();
    expect(normalizeInternalChatHref('https://example.com')).toBeNull();
    expect(normalizeInternalChatHref('javascript:alert(1)')).toBeNull();
  });

  it('normaliza texto, rechaza vacío y limita tamaño', () => {
    expect(normalizeChatText('  hola  ')).toBe('hola');
    expect(normalizeChatText('   ')).toBeNull();
    expect(normalizeChatText('x'.repeat(CHAT_BODY_MAX + 50))?.length).toBe(CHAT_BODY_MAX);
  });

  it('mantiene stickers en un catálogo cerrado y liviano', () => {
    expect(CHAT_STICKERS.length).toBeGreaterThan(3);
    expect(isChatStickerKey('ok')).toBe(true);
    expect(isChatStickerKey('<script>')).toBe(false);
  });
});
