/**
 * Откуда берутся цены соседей. Источник по адресу/коду соседа и списку ночей
 * возвращает цену одной ночи (base_occupancy гостей) по каждой категории соседа.
 */
export interface ObservedPrice {
  /** Код или название категории у соседа */
  externalRef: string;
  name: string;
  night: string;
  /** NULL — на эту ночь мест нет */
  priceMinor: number | null;
}

export type FetchFn = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface SourceContext {
  fetchFn: FetchFn;
  /** Уже известные категории соседа: по их названиям ищутся цены на странице */
  categories: { externalRef: string; name: string }[];
}

export interface CompetitorSource {
  collect(ref: string, nights: string[], ctx: SourceContext): Promise<ObservedPrice[]>;
}

export const COMPETITOR_SOURCES = Symbol('COMPETITOR_SOURCES');
export type CompetitorSources = Record<string, CompetitorSource>;

export const UA = 'Mozilla/5.0 (compatible; QVARC price monitor)';

/** HTML → текст: блоки на отдельных строках, сущности раскрыты. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|h\d|li|td|tr|section|article|span)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#39;|&#x27;|&apos;|&rsquo;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/&laquo;|&raquo;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .replace(/\n\s*/g, '\n');
}

// «от 8'500 р. / ночь», «от 8 500 ₽», «9000 руб./сутки»
const PRICE_RE = /(?:от\s*)?(\d{1,3}(?:['’  .]\d{3})+|\d{4,6})\s*(?:₽|р\.|руб)/gi;
const PRICE_TEST = new RegExp(PRICE_RE.source, 'i');
const toMinor = (s: string) => Number(s.replace(/\D/g, '')) * 100;

/**
 * Цены «от … за ночь» со страницы номеров (сайты на Tilda и похожие).
 * Цена категории — первая цена после её названия и до названия следующей категории.
 * Если категорий ещё нет, названием считается ближайшая короткая строка над ценой.
 * Цена без дат: одинакова для всех ночей, поэтому годится только как ориентир.
 */
export function parsePriceList(html: string, categories: { externalRef: string; name: string }[]): { externalRef: string; name: string; priceMinor: number }[] {
  const text = htmlToText(html);
  const prices = [...text.matchAll(PRICE_RE)].map((m) => ({ at: m.index!, minor: toMinor(m[1]) }));
  const out = new Map<string, { externalRef: string; name: string; priceMinor: number }>();

  if (categories.length) {
    const lower = text.toLowerCase();
    // Все вхождения названий; «Standart» внутри «Standart comfort» не считается
    let hits: { at: number; end: number; cat: (typeof categories)[number] }[] = [];
    for (const cat of categories) {
      const needle = cat.name.toLowerCase();
      if (!needle) continue;
      for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, i + 1)) {
        const after = lower[i + needle.length] ?? ' ';
        const before = lower[i - 1] ?? ' ';
        if (/[\p{L}\p{N}]/u.test(after) || /[\p{L}\p{N}]/u.test(before)) continue;
        hits.push({ at: i, end: i + needle.length, cat });
      }
    }
    hits = hits.filter((h) => !hits.some((o) => o !== h && o.at <= h.at && o.end >= h.end && o.end - o.at > h.end - h.at));
    hits.sort((a, b) => a.at - b.at);
    hits.forEach((h, i) => {
      if (out.has(h.cat.externalRef)) return;
      const next = hits[i + 1]?.at ?? Infinity;
      const p = prices.find((x) => x.at >= h.end && x.at < next);
      if (p) out.set(h.cat.externalRef, { externalRef: h.cat.externalRef, name: h.cat.name, priceMinor: p.minor });
    });
    return [...out.values()];
  }

  for (const p of prices) {
    const lines = text.slice(0, p.at).split('\n').map((l) => l.trim()).filter(Boolean).reverse();
    const name = lines.find((l) => l.length >= 2 && l.length <= 28 && !PRICE_TEST.test(l) && !/^\d/.test(l));
    if (name && !out.has(name)) out.set(name, { externalRef: name, name, priceMinor: p.minor });
  }
  return [...out.values()];
}

export class PageSource implements CompetitorSource {
  async collect(url: string, nights: string[], ctx: SourceContext): Promise<ObservedPrice[]> {
    if (!/^https:\/\//.test(url)) throw new Error('Адрес страницы должен начинаться с https://');
    const res = await ctx.fetchFn(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
    if (!res.ok) throw new Error(`Сайт ответил ${res.status}`);
    const found = parsePriceList(await res.text(), ctx.categories);
    if (!found.length) throw new Error('На странице не найдено ни одной цены');
    return found.flatMap((f) => nights.map((night) => ({ externalRef: f.externalRef, name: f.name, night, priceMinor: f.priceMinor })));
  }
}

export const defaultSources = (): CompetitorSources => ({ page: new PageSource() });
