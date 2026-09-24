import { requireUser } from '@/server/auth/guard';
import { chatApiError, chatJson } from '@/server/api/chat';
import type { ChatGifItem } from '@/domain/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_RESULTS = 18;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

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

export async function GET(request: Request) {
  try {
    await requireUser();

    const url = new URL(request.url);
    const q = cleanSearch(url.searchParams.get('q'));
    if (q.length < 2) return chatJson({ items: [] satisfies ChatGifItem[] });

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
          'User-Agent': 'LibroOperativoRecepcion/1.8 (internal hotel messaging)',
          Accept: 'application/json',
        },
        cache: 'no-store',
        signal: AbortSignal.timeout(7_000),
      },
    );

    if (!response.ok) {
      return chatJson({ error: 'Wikimedia Commons no respondió correctamente.' }, 502);
    }

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

    return chatJson({ items });
  } catch (error) {
    return chatApiError(error);
  }
}
