'use client';
import { useCallback, useEffect, useState } from 'react';
import { addDays, del, errorText, fmtDate, get, post, put, rub, toMinor, todayLocal } from '@/lib/api';
import { can, useMe } from '@/components/Shell';

interface Settings {
  auto_apply: boolean; rate_plan_id: string | null; min_discount_pct: string; max_discount_pct: string; reference: 'min' | 'avg';
  horizon_days: number; occupancy_low_pct: number; occupancy_high_pct: number; last_minute_days: number; collect_every_hours: number;
  round_to_minor: number; surge_window_hours: number; surge_min_bookings: number; surge_markup_pct: string; last_run_at: string | null;
}
interface Category { id: string; external_ref: string; name: string; accommodation_type_id: string | null; factor: string }
interface Run { status: 'running' | 'ok' | 'error'; started_at: string; prices: number; error: string | null }
interface Competitor { id: string; name: string; site_url: string | null; source_kind: 'manual' | 'page'; source_ref: string | null; is_active: boolean; note: string | null; categories: Category[]; lastRun: Run | null }
interface Rec {
  id: string; night: string; type_name: string; accommodation_type_id: string; current_minor: number; suggested_minor: number; status: string;
  applied_auto: boolean; decided_at: string | null; decided_by_name: string | null;
  reasons: { referenceMinor?: number; competitors?: { competitor: string; priceMinor: number | null }[]; occupancyPct?: number; discountPct?: number; floorMinor?: number; floorApplied?: boolean; surge?: boolean; recentBookings?: number };
}
interface Floor { id: string; accommodation_type_id: string; period: string; min_price_minor: number; label: string | null }
interface Type { id: string; name: string }
interface Plan { id: string; name: string; is_active: boolean }
interface Price { competitor: string; category: string; accommodation_type_id: string | null; night: string; price_minor: number | null; source: string }
interface Journal {
  events: { id: number; at: string; action: string; after: Record<string, unknown> | null; before: Record<string, unknown> | null; actor_type: string; actor_name: string | null }[];
  runs: (Run & { id: string; name: string })[];
}

const TABS = [['recs', 'Предложения'], ['competitors', 'Соседи'], ['floors', 'Минимальные цены'], ['settings', 'Настройки'], ['journal', 'Журнал']] as const;
type Tab = (typeof TABS)[number][0];
const ACTIONS: Record<string, string> = {
  'pricing.auto_on': 'Включено автоматическое изменение цен',
  'pricing.auto_off': 'Выключено автоматическое изменение цен',
  'pricing.settings': 'Изменены настройки',
  'pricing.auto_apply': 'Цена изменена автоматически',
  'pricing.accept': 'Предложение принято',
  'pricing.reject': 'Предложение отклонено',
  'pricing.recompute': 'Пересчёт предложений',
  'pricing.auto_remove': 'Сняты цены от соседей',
  'pricing.floor.create': 'Добавлен минимум',
  'pricing.floor.delete': 'Удалён минимум',
  'pricing.competitor.create': 'Добавлен сосед',
  'pricing.competitor.update': 'Изменён сосед',
  'pricing.competitor.manual_prices': 'Внесены цены соседа',
  'pricing.category.map': 'Сопоставлена категория',
};
const SKIP: Record<string, string> = { no_floor: 'нет минимальной цены', no_competitor_prices: 'нет цен соседей', no_rooms: 'мест нет', closed: 'продажи закрыты' };
const period = (p: string) => { const [a, b] = p.slice(1, -1).split(','); return `${fmtDate(a)} – ${fmtDate(addDays(b, -1))}`; };
const dt = (s: string) => new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function CompetitorsPage() {
  const me = useMe();
  const writable = can(me, 'rates.write');
  const [tab, setTab] = useState<Tab>('recs');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [types, setTypes] = useState<Type[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSettings = useCallback(() => get<Settings>('/pricing/settings').then(setSettings, (e) => setError(errorText(e))), []);
  useEffect(() => {
    loadSettings();
    get<Type[]>('/accommodation-types').then(setTypes, () => undefined);
    get<Plan[]>('/rate-plans').then(setPlans, () => undefined);
  }, [loadSettings]);
  const typeName = (id: string | null) => types.find((t) => t.id === id)?.name ?? '';

  const toggleAuto = async () => {
    if (!settings) return;
    const on = !settings.auto_apply;
    if (on && !window.confirm('Цены в тарифе будут меняться сами после каждого сбора цен соседей, но не ниже минимальных. Включить?')) return;
    setError('');
    try {
      await put('/pricing/settings', toBody(settings, { auto_apply: on }));
      setNotice(on ? 'Цены теперь меняются автоматически.' : 'Автоматическое изменение выключено: система только предлагает цены.');
      loadSettings();
    } catch (e) { setError(errorText(e)); }
  };

  const run = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await post<{ collected: { name: string; status: string; error?: string }[]; proposed: number; applied: number; skipped: Record<string, number>; message?: string }>('/pricing/run');
      const parts = r.collected.map((c) => `${c.name}: ${c.status === 'ok' ? 'цены собраны' : `ошибка (${c.error})`}`);
      if (r.message) parts.push(r.message);
      else parts.push(`новых предложений ${r.proposed}, применено ${r.applied}`);
      const skips = Object.entries(r.skipped ?? {}).map(([k, v]) => `${SKIP[k] ?? k}: ${v}`);
      if (skips.length) parts.push(`пропущено ночей — ${skips.join(', ')}`);
      setNotice(parts.join('. '));
      loadSettings();
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  };

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0, marginRight: 'auto' }}>Цены соседей</h1>
        {writable && <button className="btn" disabled={busy} onClick={run}>{busy ? 'Собираю…' : 'Собрать цены и пересчитать'}</button>}
      </div>
      {settings && (
        <div className="card row" style={{ alignItems: 'center' }}>
          <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 15, fontWeight: 600, marginRight: 'auto' }}>
            <input type="checkbox" checked={settings.auto_apply} disabled={!writable} onChange={toggleAuto} /> Менять цены автоматически
          </label>
          <span className="muted" style={{ fontSize: 13 }}>
            {settings.auto_apply
              ? `Цены ставятся сами: на ${Number(settings.min_discount_pct)}–${Number(settings.max_discount_pct)}% дешевле соседей, не ниже минимума.`
              : 'Выключено: система только предлагает цены, вы принимаете их сами.'}
            {settings.last_run_at && ` Последний сбор: ${dt(settings.last_run_at)}.`}
          </span>
        </div>
      )}
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      <div className="row">
        {TABS.map(([k, l]) => <button key={k} className={`btn${tab === k ? ' primary' : ''}`} onClick={() => { setTab(k); setNotice(''); }}>{l}</button>)}
      </div>
      {tab === 'recs' && <Recs writable={writable} onError={setError} />}
      {tab === 'competitors' && <Competitors writable={writable} types={types} typeName={typeName} onError={setError} />}
      {tab === 'floors' && <Floors writable={writable} types={types} typeName={typeName} onError={setError} />}
      {tab === 'settings' && settings && <SettingsForm settings={settings} plans={plans} writable={writable} onSaved={() => { loadSettings(); setNotice('Настройки сохранены.'); }} onError={setError} />}
      {tab === 'journal' && <JournalView typeName={typeName} />}
    </div>
  );
}

function toBody(s: Settings, over: Partial<Settings> = {}) {
  const x = { ...s, ...over };
  return {
    autoApply: x.auto_apply, ratePlanId: x.rate_plan_id, minDiscountPct: Number(x.min_discount_pct), maxDiscountPct: Number(x.max_discount_pct),
    reference: x.reference, horizonDays: x.horizon_days, occupancyLowPct: x.occupancy_low_pct, occupancyHighPct: x.occupancy_high_pct,
    lastMinuteDays: x.last_minute_days, collectEveryHours: x.collect_every_hours, roundToMinor: x.round_to_minor,
    surgeWindowHours: x.surge_window_hours, surgeMinBookings: x.surge_min_bookings, surgeMarkupPct: Number(x.surge_markup_pct),
  };
}

function Recs({ writable, onError }: { writable: boolean; onError: (s: string) => void }) {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const load = useCallback(() => get<Rec[]>('/pricing/recommendations?status=proposed').then((r) => { setRecs(r); setSel(new Set()); }, (e) => onError(errorText(e))), [onError]);
  useEffect(() => { load(); }, [load]);
  const decide = async (ids: string[], accept: boolean) => {
    if (!ids.length) return;
    try { await post('/pricing/recommendations/decide', { ids, accept }); load(); } catch (e) { onError(errorText(e)); load(); }
  };
  if (!recs.length) return <div className="muted">Предложений нет. Они появляются после сбора цен соседей, если для категории заданы минимальные цены и цена отличается от текущей.</div>;
  return (
    <div className="stack">
      {writable && (
        <div className="row">
          <button className="btn primary" disabled={!sel.size} onClick={() => decide([...sel], true)}>Принять выбранные ({sel.size})</button>
          <button className="btn" disabled={!sel.size} onClick={() => decide([...sel], false)}>Отклонить выбранные</button>
          <button className="btn" onClick={() => setSel(new Set(recs.map((r) => r.id)))}>Выбрать все</button>
        </div>
      )}
      <table className="list">
        <thead><tr>{writable && <th />}<th>Ночь</th><th>Категория</th><th>Сейчас</th><th>Соседи</th><th>Загрузка</th><th>Скидка</th><th>Предлагаем</th></tr></thead>
        <tbody>
          {recs.map((r) => (
            <tr key={r.id}>
              {writable && <td><input type="checkbox" checked={sel.has(r.id)} onChange={(e) => { const s = new Set(sel); if (e.target.checked) s.add(r.id); else s.delete(r.id); setSel(s); }} /></td>}
              <td>{fmtDate(r.night, { day: '2-digit', month: '2-digit', weekday: 'short' })}</td>
              <td>{r.type_name}</td>
              <td>{rub(r.current_minor)}</td>
              <td style={{ fontSize: 13 }}>{(r.reasons.competitors ?? []).map((c) => `${c.competitor}: ${c.priceMinor === null ? 'мест нет' : rub(c.priceMinor)}`).join('; ')}</td>
              <td>{r.reasons.occupancyPct ?? 0}%</td>
              <td>{r.reasons.discountPct}%</td>
              <td style={{ fontWeight: 600 }}>
                {rub(r.suggested_minor)}
                {r.reasons.floorApplied && <span className="badge tone-warn" style={{ marginLeft: 6 }}>минимум</span>}
                {r.reasons.surge && <span className="badge tone-bad" style={{ marginLeft: 6 }} title={`Новых броней на эту ночь: ${r.reasons.recentBookings}`}>ажиотаж</span>}
                {writable && <button className="btn" style={{ marginLeft: 8 }} onClick={() => decide([r.id], true)}>Принять</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Competitors({ writable, types, typeName, onError }: { writable: boolean; types: Type[]; typeName: (id: string | null) => string; onError: (s: string) => void }) {
  const [list, setList] = useState<Competitor[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [manual, setManual] = useState({ competitorId: '', externalRef: '', from: todayLocal(), to: addDays(todayLocal(), 7), price: '', soldOut: false });
  const today = todayLocal();
  const load = useCallback(() => {
    get<Competitor[]>('/pricing/competitors').then(setList, (e) => onError(errorText(e)));
    get<Price[]>(`/pricing/competitor-prices?from=${today}&to=${addDays(today, 14)}`).then(setPrices, () => undefined);
  }, [onError, today]);
  useEffect(() => { load(); }, [load]);

  const presets = async () => { try { await post('/pricing/competitors/presets'); load(); } catch (e) { onError(errorText(e)); } };
  const collect = async (c: Competitor) => {
    try { const r = await post<{ status: string; error?: string }>(`/pricing/competitors/${c.id}/collect`); if (r.status !== 'ok') onError(`${c.name}: ${r.error}`); load(); } catch (e) { onError(errorText(e)); }
  };
  const map = async (c: Competitor, cat: Category, over: Partial<{ accommodationTypeId: string | null; factor: number }>) => {
    try {
      await put(`/pricing/competitors/${c.id}/categories`, { externalRef: cat.external_ref, name: cat.name, accommodationTypeId: cat.accommodation_type_id, factor: Number(cat.factor), ...over });
      load();
    } catch (e) { onError(errorText(e)); }
  };
  const toggle = async (c: Competitor) => {
    try { await put(`/pricing/competitors/${c.id}`, { name: c.name, siteUrl: c.site_url, sourceKind: c.source_kind, sourceRef: c.source_ref, note: c.note, isActive: !c.is_active }); load(); } catch (e) { onError(errorText(e)); }
  };
  const saveManual = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceMinor = manual.soldOut ? null : toMinor(manual.price);
    if (priceMinor !== null && (Number.isNaN(priceMinor) || priceMinor <= 0)) { onError('Цена: введите число'); return; }
    try {
      await post('/pricing/competitor-prices', { competitorId: manual.competitorId, externalRef: manual.externalRef, from: manual.from, to: addDays(manual.to, 1), priceMinor });
      setManual({ ...manual, price: '' });
      load();
    } catch (err) { onError(errorText(err)); }
  };

  // Таблица цен: строка — категория соседа, столбец — ночь
  const nights = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const rows = new Map<string, { label: string; byNight: Map<string, number | null> }>();
  for (const p of prices) {
    const key = `${p.competitor}|${p.category}`;
    const r = rows.get(key) ?? { label: `${p.competitor} · ${p.category}${p.accommodation_type_id ? ` → ${typeName(p.accommodation_type_id)}` : ''}`, byNight: new Map() };
    r.byNight.set(p.night, p.price_minor);
    rows.set(key, r);
  }
  const manualComp = list.find((c) => c.id === manual.competitorId);

  return (
    <div className="stack">
      {!list.length && writable && (
        <div className="card stack">
          <div>Соседи ещё не заведены.</div>
          <div><button className="btn primary" onClick={presets}>Добавить «Верт» и «Гости»</button></div>
        </div>
      )}
      {list.map((c) => (
        <div key={c.id} className="card stack">
          <div className="row">
            <h2 style={{ margin: 0, marginRight: 'auto' }}>{c.name}{!c.is_active && <span className="badge tone-muted" style={{ marginLeft: 8 }}>не отслеживается</span>}</h2>
            {c.site_url && <a href={c.site_url} target="_blank" rel="noreferrer">сайт</a>}
            {writable && c.source_kind === 'page' && <button className="btn" onClick={() => collect(c)}>Собрать сейчас</button>}
            {writable && <button className="btn" onClick={() => toggle(c)}>{c.is_active ? 'Не отслеживать' : 'Отслеживать'}</button>}
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            {c.source_kind === 'page' ? `Цены собираются со страницы ${c.source_ref}` : 'Цены вносятся вручную'}
            {c.lastRun && ` · последний сбор ${dt(c.lastRun.started_at)}: ${c.lastRun.status === 'ok' ? `цен ${c.lastRun.prices}` : c.lastRun.status === 'error' ? `ошибка — ${c.lastRun.error}` : 'идёт'}`}
          </div>
          {c.note && <div style={{ fontSize: 13 }}>{c.note}</div>}
          <table className="list">
            <thead><tr><th>Категория соседа</th><th>Сравнивать с нашей</th><th>Коэффициент</th></tr></thead>
            <tbody>
              {c.categories.map((cat) => (
                <tr key={cat.id}>
                  <td>{cat.name}</td>
                  <td>
                    <select value={cat.accommodation_type_id ?? ''} disabled={!writable} onChange={(e) => map(c, cat, { accommodationTypeId: e.target.value || null })}>
                      <option value="">не сравнивать</option>
                      {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <input style={{ width: 80 }} defaultValue={Number(cat.factor)} disabled={!writable} inputMode="decimal"
                      title="Во сколько раз их цена приводится к нашей: 0.8 — их номер больше нашего"
                      onBlur={(e) => { const v = Number(e.target.value.replace(',', '.')); if (v > 0 && v !== Number(cat.factor)) map(c, cat, { factor: v }); }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {writable && list.length > 0 && (
        <form className="card stack" onSubmit={saveManual}>
          <h2 style={{ margin: 0 }}>Внести цены соседа вручную</h2>
          <div className="muted" style={{ fontSize: 13 }}>Например, цены «Верта» на Островке или по телефону. Цена за ночь на двоих на все даты периода.</div>
          <div className="grid2">
            <label>Сосед
              <select value={manual.competitorId} onChange={(e) => setManual({ ...manual, competitorId: e.target.value, externalRef: '' })} required>
                <option value="" />
                {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label>Категория
              <select value={manual.externalRef} onChange={(e) => setManual({ ...manual, externalRef: e.target.value })} required>
                <option value="" />
                {manualComp?.categories.map((x) => <option key={x.id} value={x.external_ref}>{x.name}</option>)}
              </select>
            </label>
            <label>С<input type="date" value={manual.from} onChange={(e) => setManual({ ...manual, from: e.target.value })} required /></label>
            <label>По (включительно)<input type="date" value={manual.to} onChange={(e) => setManual({ ...manual, to: e.target.value })} required /></label>
            <label>Цена за ночь, ₽<input inputMode="decimal" value={manual.price} disabled={manual.soldOut} onChange={(e) => setManual({ ...manual, price: e.target.value })} /></label>
            <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}>
              <input type="checkbox" checked={manual.soldOut} onChange={(e) => setManual({ ...manual, soldOut: e.target.checked })} /> мест нет
            </label>
          </div>
          <div><button className="btn primary">Сохранить</button></div>
        </form>
      )}

      {rows.size > 0 && (
        <div className="stack">
          <h2 style={{ margin: 0 }}>Цены соседей на 14 дней</h2>
          <div className="chess-wrap">
            <table className="prices">
              <thead><tr><th className="rowhead" />{nights.map((n) => <th key={n}>{fmtDate(n, { day: '2-digit', month: '2-digit' })}</th>)}</tr></thead>
              <tbody>
                {[...rows.entries()].map(([k, r]) => (
                  <tr key={k}>
                    <td className="rowhead" style={{ whiteSpace: 'nowrap' }}>{r.label}</td>
                    {nights.map((n) => { const v = r.byNight.get(n); return <td key={n}>{v === undefined ? '' : v === null ? 'нет' : (v / 100).toLocaleString('ru-RU')}</td>; })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Floors({ writable, types, typeName, onError }: { writable: boolean; types: Type[]; typeName: (id: string | null) => string; onError: (s: string) => void }) {
  const [floors, setFloors] = useState<Floor[]>([]);
  const [form, setForm] = useState({ typeIds: [] as string[], from: todayLocal(), to: addDays(todayLocal(), 365), price: '', label: '' });
  const load = useCallback(() => get<Floor[]>('/pricing/floors').then(setFloors, (e) => onError(errorText(e))), [onError]);
  useEffect(() => { load(); }, [load]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const minPriceMinor = toMinor(form.price);
    if (Number.isNaN(minPriceMinor) || minPriceMinor <= 0) { onError('Минимум: введите число'); return; }
    try {
      for (const t of form.typeIds) await post('/pricing/floors', { accommodationTypeId: t, from: form.from, to: addDays(form.to, 1), minPriceMinor, label: form.label || null });
      setForm({ ...form, price: '', label: '' });
      load();
    } catch (err) { onError(errorText(err)); }
  };
  const remove = async (f: Floor) => {
    if (!window.confirm('Удалить минимум?')) return;
    try { await del(`/pricing/floors/${f.id}`); load(); } catch (e) { onError(errorText(e)); }
  };
  return (
    <div className="stack">
      <div className="muted" style={{ fontSize: 13 }}>Цена ночи никогда не опустится ниже минимума. Без минимума для категории и даты цена не предлагается. Если периоды пересекаются, действует более короткий (например, праздник внутри сезона).</div>
      {floors.length > 0 && (
        <table className="list">
          <thead><tr><th>Категория</th><th>Даты</th><th>Минимум за ночь</th><th>Название</th>{writable && <th />}</tr></thead>
          <tbody>
            {floors.map((f) => (
              <tr key={f.id}>
                <td>{typeName(f.accommodation_type_id)}</td><td>{period(f.period)}</td><td>{rub(f.min_price_minor)}</td><td>{f.label}</td>
                {writable && <td><button className="btn danger" onClick={() => remove(f)}>Удалить</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {writable && (
        <form className="card stack" onSubmit={save}>
          <h2 style={{ margin: 0 }}>Добавить минимум</h2>
          <div className="row">
            {types.map((t) => (
              <label key={t.id} className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}>
                <input type="checkbox" checked={form.typeIds.includes(t.id)} onChange={(e) => setForm({ ...form, typeIds: e.target.checked ? [...form.typeIds, t.id] : form.typeIds.filter((x) => x !== t.id) })} /> {t.name}
              </label>
            ))}
          </div>
          <div className="grid2">
            <label>С<input type="date" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} required /></label>
            <label>По (включительно)<input type="date" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} required /></label>
            <label>Минимум за ночь, ₽<input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} required /></label>
            <label>Название<input value={form.label} placeholder="Например, Лето 2027" onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          </div>
          <div><button className="btn primary" disabled={!form.typeIds.length}>Добавить</button></div>
        </form>
      )}
    </div>
  );
}

function SettingsForm({ settings, plans, writable, onSaved, onError }: { settings: Settings; plans: Plan[]; writable: boolean; onSaved: () => void; onError: (s: string) => void }) {
  const [s, setS] = useState(settings);
  useEffect(() => setS(settings), [settings]);
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value === '' ? '' : Number(e.target.value) } as Settings);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await put('/pricing/settings', toBody(s)); onSaved(); } catch (err) { onError(errorText(err)); }
  };
  const removeAuto = async () => {
    if (!window.confirm('Снять все цены, выставленные по соседям, на будущие ночи? Снова будут действовать ваши цены из «Цен и ограничений». Чтобы цены не вернулись при следующем сборе, выключите автоматическое изменение.')) return;
    try { const r = await post<{ removed: number }>('/pricing/auto-prices/remove'); window.alert(`Снято цен: ${r.removed}`); } catch (err) { onError(errorText(err)); }
  };
  return (
    <form className="card stack" onSubmit={save}>
      <div className="grid2">
        <label>Тариф, цены которого считать
          <select value={s.rate_plan_id ?? ''} disabled={!writable} onChange={(e) => setS({ ...s, rate_plan_id: e.target.value || null })}>
            <option value="">не выбран</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_active ? '' : ' (выкл.)'}</option>)}
          </select>
        </label>
        <label>Сравнивать с
          <select value={s.reference} disabled={!writable} onChange={(e) => setS({ ...s, reference: e.target.value as 'min' | 'avg' })}>
            <option value="min">самым дешёвым соседом</option>
            <option value="avg">средней ценой соседей</option>
          </select>
        </label>
        <label>Скидка при высоком спросе, %<input type="number" min={0} max={89} step="0.5" value={Number(s.min_discount_pct)} disabled={!writable} onChange={num('min_discount_pct')} /></label>
        <label>Скидка при низком спросе, %<input type="number" min={0} max={89} step="0.5" value={Number(s.max_discount_pct)} disabled={!writable} onChange={num('max_discount_pct')} /></label>
        <label>Низкий спрос: загрузка до, %<input type="number" min={0} max={100} value={s.occupancy_low_pct} disabled={!writable} onChange={num('occupancy_low_pct')} /></label>
        <label>Высокий спрос: загрузка от, %<input type="number" min={0} max={100} value={s.occupancy_high_pct} disabled={!writable} onChange={num('occupancy_high_pct')} /></label>
        <label>Последние дни перед заездом (свободное дешевеет), дн.<input type="number" min={0} max={60} value={s.last_minute_days} disabled={!writable} onChange={num('last_minute_days')} /></label>
        <label>Считать цены вперёд на, дн.<input type="number" min={1} max={365} value={s.horizon_days} disabled={!writable} onChange={num('horizon_days')} /></label>
        <label>Собирать цены раз в, ч<input type="number" min={1} max={168} value={s.collect_every_hours} disabled={!writable} onChange={num('collect_every_hours')} /></label>
        <label>Ажиотаж: новых броней на ночь, не меньше<input type="number" min={1} max={100} value={s.surge_min_bookings} disabled={!writable} onChange={num('surge_min_bookings')} /></label>
        <label>Ажиотаж: брони за последние, ч<input type="number" min={1} max={720} value={s.surge_window_hours} disabled={!writable} onChange={num('surge_window_hours')} /></label>
        <label>Ажиотаж: поднять цену ещё на, %<input type="number" min={0} max={100} step="0.5" value={Number(s.surge_markup_pct)} disabled={!writable} onChange={num('surge_markup_pct')} /></label>
        <label>Округлять до, ₽<input type="number" min={1} value={s.round_to_minor / 100} disabled={!writable} onChange={(e) => setS({ ...s, round_to_minor: Math.round(Number(e.target.value) * 100) })} /></label>
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        Скидка от цены соседей плавно меняется между этими значениями по нашей загрузке категории на ночь. За последние дни перед заездом свободные номера считаются как при вдвое меньшем спросе. При ажиотаже (много новых броней на ночь за последние часы) скидка минимальная, цена поднимается ещё на заданный процент и не снижается; пересчёт идёт в течение 10 минут после брони. Цена не опускается ниже минимальной.
      </div>
      {writable && (
        <div className="row">
          <button className="btn primary">Сохранить</button>
          <button type="button" className="btn danger" style={{ marginLeft: 'auto' }} onClick={removeAuto}>Снять цены от соседей</button>
        </div>
      )}
    </form>
  );
}

function JournalView({ typeName }: { typeName: (id: string | null) => string }) {
  const [j, setJ] = useState<Journal | null>(null);
  useEffect(() => { get<Journal>('/pricing/journal').then(setJ, () => undefined); }, []);
  if (!j) return <div className="muted">Загрузка…</div>;
  const detail = (e: Journal['events'][number]) => {
    const a = e.after ?? {};
    if (e.action === 'pricing.auto_apply' || e.action === 'pricing.accept')
      return `${a.night ? fmtDate(String(a.night)) : ''}: ${rub(Number(e.before?.priceMinor ?? 0))} → ${rub(Number(a.priceMinor))}`;
    if (e.action === 'pricing.recompute') return `предложено ${a.proposed}, применено ${a.applied}`;
    if (e.action === 'pricing.auto_remove') return `снято ${a.removed}`;
    if (e.action === 'pricing.floor.create') return `${typeName(String(a.accommodationTypeId))}: ${rub(Number(a.minPriceMinor))}`;
    return '';
  };
  return (
    <div className="stack">
      <table className="list">
        <thead><tr><th>Когда</th><th>Кто</th><th>Что</th><th /></tr></thead>
        <tbody>
          {j.events.map((e) => (
            <tr key={e.id}><td>{dt(e.at)}</td><td>{e.actor_name ?? (e.actor_type === 'system' ? 'по расписанию' : '')}</td><td>{ACTIONS[e.action] ?? e.action}</td><td>{detail(e)}</td></tr>
          ))}
        </tbody>
      </table>
      <h2 style={{ margin: 0 }}>Сборы цен</h2>
      <table className="list">
        <thead><tr><th>Когда</th><th>Сосед</th><th>Результат</th></tr></thead>
        <tbody>
          {j.runs.map((r) => (
            <tr key={r.id}><td>{dt(r.started_at)}</td><td>{r.name}</td><td>{r.status === 'ok' ? `цен ${r.prices}` : r.status === 'error' ? `ошибка: ${r.error}` : 'идёт'}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
