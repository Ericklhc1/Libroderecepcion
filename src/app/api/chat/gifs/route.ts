import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import type { ChatGifItem } from '@/domain/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RESULTS = 18;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type TenorResponse = {
  results?: Array<{
    id?: string;
    title?: string;
    content_description?: string;
    itemurl?: string;
    media_formats?: {
      tinygif?: { url?: string; dims?: number[]; size?: number };
      gif?: { url?: string; dims?: number[]; size?: number };
    };
  }>;
};

type CommonsResponse = {
  query?: {
    pages?: Record<
      string,
      {
        pageid?: number;
        title?: string;
        imageinfo?: Array<{
          url?: string;
          descriptionurl?: string;
          mime?: string;
          size?: number;
          width?: number;
          height?: number;
        }>;
      }
    >;
  };
};

function cleanSearch(value: string | null): string {
  return (value ?? '')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

async function searchTenor(q: string): Promise<ChatGifItem[]> {
  const key = process.env.TENOR_API_KEY?.trim();
  if (!key) return [];

  const params = new URLSearchParams({
    q,
    key,
    client_key: process.env.TENOR_CLIENT_KEY?.trim() || 'libro_operativo_recepcion',
    limit: String(MAX_RESULTS),
    media_filter: 'tinygif,gif',
    contentfilter: 'medium',
    locale: 'es_CL',
  });

  const response = await fetch(`https://tenor.googleapis.com/v2/search?${params.toString()}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(7_000),
  });
  if (!response.ok) return [];

  const payload = (await response.json()) as TenorResponse;
  const items: ChatGifItem[] = [];
  for (const result of payload.results ?? []) {
    const media = result.media_formats?.tinygif ?? result.media_formats?.gif;
    if (!media?.url || !media.url.startsWith('https://media.tenor.com/')) continue;
    if ((media.size ?? 0) > MAX_FILE_BYTES) continue;
    items.push({
      title: (result.content_description || result.title || 'GIF').slice(0, 140),
      url: media.url,
      pageUrl: result.itemurl?.startsWith('https://tenor.com/')
        ? result.itemurl
        : 'https://tenor.com/',
      width: media.dims?.[0] ?? null,
      height: media.dims?.[1] ?? null,
      source: 'TENOR',
    });
  }
  return items;
}

async function searchCommons(q: string): Promise<ChatGifItem[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '50',
    gsrsearch: `${q} animated gif`,
    prop: 'imageinfo',
    iiprop: 'url|mime|size|dimensions',
    origin: '*',
  });

  const response = await fetch(
    `https://commons.wikimedia.org/w/api.php?${params.toString()}`,
    {
      headers: {
        'User-Agent': 'LibroOperativoRecepcion/1.9 (internal hotel messaging)',
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(7_000),
    },
  );
  if (!response.ok) return [];

  const payload = (await response.json()) as CommonsResponse;
  const items: ChatGifItem[] = [];
  for (const page of Object.values(payload.query?.pages ?? {})) {
    const info = page.imageinfo?.[0];
    if (!info?.url || info.mime !== 'image/gif') continue;
    if ((info.size ?? 0) > MAX_FILE_BYTES) continue;
    if (!info.url.startsWith('https://upload.wikimedia.org/')) continue;

    const title = (page.title ?? 'GIF').replace(/^File:/, '').slice(0, 140);
    const pageUrl =
      info.descriptionurl ??
      (page.pageid
        ? `https://commons.wikimedia.org/?curid=${page.pageid}`
        : 'https://commons.wikimedia.org/');

    items.push({
      title,
      url: info.url,
      pageUrl,
      width: info.width ?? null,
      height: info.height ?? null,
      source: 'WIKIMEDIA_COMMONS',
    });
    if (items.length >= MAX_RESULTS) break;
  }
  return items;
}

export async function GET(request: Request) {
  try {
    await requireUser();
    const url = new URL(request.url);
    const q = cleanSearch(url.searchParams.get('q'));
    if (q.length < 2) return chatJson({ items: [] satisfies ChatGifItem[] });

    const tenor = await searchTenor(q).catch(() => [] as ChatGifItem[]);
    if (tenor.length > 0) return chatJson({ items: tenor });

    const fallback = await searchCommons(q).catch(() => [] as ChatGifItem[]);
    if (fallback.length > 0) return chatJson({ items: fallback });

    return chatJson({ items: [] satisfies ChatGifItem[] });
  } catch (error) {
    return chatApiError(error);
  }
}
