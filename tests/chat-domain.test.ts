import { describe, expect, it } from 'vitest';
import {
  CHAT_AVATARS,
  CHAT_BODY_MAX,
  CHAT_STICKERS,
  directConversationKey,
  isChatAvatarKey,
  isChatNotificationTone,
  isChatStickerKey,
  normalizeChatStatus,
  normalizeChatText,
  normalizeInternalChatHref,
  normalizeWikimediaMediaUrl,
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

  it('normaliza el estado corto del perfil', () => {
    expect(normalizeChatStatus('  En   recepción ☕  ')).toBe('En recepción ☕');
    expect(normalizeChatStatus('   ')).toBeNull();
  });

  it('mantiene avatares y tonos en catálogos cerrados', () => {
    expect(CHAT_AVATARS.length).toBeGreaterThan(20);
    expect(isChatAvatarKey('dragon')).toBe(true);
    expect(isChatAvatarKey('javascript:alert(1)')).toBe(false);
    expect(isChatNotificationTone('bamboo')).toBe(true);
    expect(isChatNotificationTone('sirena-externa')).toBe(false);
  });

  it('acepta sólo media HTTPS de Wikimedia para GIF', () => {
    expect(normalizeWikimediaMediaUrl('https://upload.wikimedia.org/example.gif')).toBe(
      'https://upload.wikimedia.org/example.gif',
    );
    expect(normalizeWikimediaMediaUrl('https://commons.wikimedia.org/example.gif')).toBe(
      'https://commons.wikimedia.org/example.gif',
    );
    expect(normalizeWikimediaMediaUrl('https://example.com/example.gif')).toBeNull();
    expect(normalizeWikimediaMediaUrl('javascript:alert(1)')).toBeNull();
  });
});
