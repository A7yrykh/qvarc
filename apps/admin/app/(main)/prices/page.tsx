'use client';
import { useCallback, useEffect, useState } from 'react';
import { WEEKDAYS, addDays, del, errorText, fmtDate, get, isoWeekday, post, rub, toMinor, todayLocal } from '@/lib/api';
import { can, useMe } from '@/components/Shell';

interface Plan { id: string; name: string; is_active: boolean }
interface Day {
  date: string; free: number; priceMinor: number | null; extraAdultMinor: number | null; extraChildMinor: number | null;
  minStay: number | null; maxStay: number | null; minLeadDays: number | null; closed: boolean; closedToArrival: boolean; closedToDeparture: boolean;
}
interface Grid { rows: { accommodationType: { id: string; name: string }; days: Day[] }[] }
interface Rule {
  id: string; accommodation_type_id: string; period: string; weekdays: number[]; priority: number; label: string | null;
  price_minor: number | null; min_stay: number | null; max_stay: number | null; min_lead_days: number | null;
  closed: boolean; closed_to_arrival: boolean; closed_to_departure: boolean; extra_adult_minor: number | null; extra_child_minor: number | null;
}

const DAYS = 31;
const EMPTY = { price: '', extraAdult: '', extraChild: '', minStay: '', maxStay: '', minLead: '', closed: false, cta: false, ctd: false, label: '', weekdays: [1, 2, 3, 4, 5, 6, 7] };

export default function PricesPage() {
  const me = useMe();
  const writable = can(me, 'rates.write');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState('');
  const [from, setFrom] = useState(todayLocal());
  const [grid, setGrid] = useState<Grid | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [sel, setSel] = useState<{ typeId: string; a: string; b: string | null } | null>(null);
  const [allTypes, setAllTypes] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const to = addDays(from, DAYS);

  useEffect(() => {
    get<Plan[]>('/rate-plans').then((p) => { setPlans(p); setPlanId((x) => x || p.find((q) => q.is_active)?.id || ''); }, (e) => setError(errorText(e)));
  }, []);
  const load = useCallback(() => {
    if (!planId) return;
    get<Grid>(`/rate-grid?ratePlanId=${planId}&from=${from}&to=${to}`).then(setGrid, (e) => setError(errorText(e)));
    get<Rule[]>(`/rate-rules?ratePlanId=${planId}&from=${from}&to=${to}`).then(setRules, () => undefined);
  }, [planId, from, to]);
  useEffect(load, [load]);

  const days = Array.from({ length: DAYS }, (_, i) => addDays(from, i));
  const [selFrom, selTo] = sel ? (sel.b && sel.b < sel.a ? [sel.b, sel.a] : [sel.a, sel.b ?? sel.a]) : ['', ''];
  const inSel = (typeId: string, d: string) => !!sel && (allTypes || sel.typeId === typeId) && d >= selFrom && d <= selTo;

  // Первый клик выбирает начало, второй конец периода
  const pick = (typeId: string, d: string) => {
    if (!writable) return;
    setNotice('');
    if (!sel || sel.typeId !== typeId || sel.b) setSel({ typeId, a: d, b: null });
    else setSel({ ...sel, b: d });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sel) return;
    setError(''); setNotice('');
    const num = (s: string) => (s.trim() === '' ? null : Number(s));
    const money = (s: string) => (s.trim() === '' ? null : toMinor(s));
    const body = {
      ratePlanId: planId, from: selFrom, to: addDays(selTo, 1), weekdays: form.weekdays, priority: 100,
      priceMinor: money(form.price), extraAdultMinor: money(form.extraAdult), extraChildMinor: money(form.extraChild),
      minStay: num(form.minStay), maxStay: num(form.maxStay), minLeadDays: num(form.minLead),
      closed: form.closed, closedToArrival: form.cta, closedToDeparture: form.ctd,
      label: form.label || `Правка ${fmtDate(selFrom)}–${fmtDate(selTo)}`,
    };
    if ([body.priceMinor, body.extraAdultMinor, body.extraChildMinor].some((v) => v !== null && Number.isNaN(v))) { setError('Цена: введите число'); return; }
    const typeIds = allTypes ? (grid?.rows.map((r) => r.accommodationType.id) ?? []) : [sel.typeId];
    try {
      for (const t of typeIds) await post('/rate-rules', { ...body, accommodationTypeId: t });
      setNotice('Сохранено. Уже подтверждённые брони не меняются.');
      setSel(null); setForm(EMPTY); load();
    } catch (err) { setError(errorText(err)); }
  };

  const remove = async (r: Rule) => {
    if (!window.confirm(`Удалить правило «${r.label ?? 'без названия'}»?`)) return;
    try { await del(`/rate-rules/${r.id}`); load(); } catch (e) { setError(errorText(e)); }
  };

  const typeName = (id: string) => grid?.rows.find((r) => r.accommodationType.id === id)?.accommodationType.name ?? '';
  const ruleText = (r: Rule) => [
    r.price_minor !== null && `цена ${rub(r.price_minor)}`,
    r.extra_adult_minor !== null && `доп. взрослый ${rub(r.extra_adult_minor)}`,
    r.extra_child_minor !== null && `доп. ребёнок ${rub(r.extra_child_minor)}`,
    r.min_stay !== null && `мин. ${r.min_stay} ноч.`,
    r.max_stay !== null && `макс. ${r.max_stay} ноч.`,
    r.min_lead_days !== null && `за ${r.min_lead_days} дн.`,
    r.closed && 'закрыто', r.closed_to_arrival && 'закрыт заезд', r.closed_to_departure && 'закрыт выезд',
  ].filter(Boolean).join(', ');
  const period = (p: string) => { const [a, b] = p.slice(1, -1).split(','); return `${fmtDate(a)} – ${fmtDate(addDays(b, -1))}`; };

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0, marginRight: 'auto' }}>Цены и ограничения</h1>
        <select value={planId} onChange={(e) => setPlanId(e.target.value)} aria-label="Тариф">
          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.is_active ? '' : ' (выкл.)'}</option>)}
        </select>
        <button className="btn" onClick={() => setFrom(addDays(from, -DAYS))}>←</button>
        <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Начало" />
        <button className="btn" onClick={() => setFrom(addDays(from, DAYS))}>→</button>
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      {plans.length === 0 && <div className="muted">Сначала создайте тариф в разделе «Тарифы».</div>}
      {writable && <div className="muted" style={{ fontSize: 12 }}>Щёлкните по дню начала и по дню конца периода в строке «Цена», затем задайте значения внизу.</div>}

      {grid && (
        <div className="chess-wrap">
          <table className="prices">
            <thead>
              <tr>
                <th className="rowhead" />
                {days.map((d) => (
                  <th key={d} style={isoWeekday(d) >= 6 ? { color: 'var(--bad)' } : undefined}>
                    {WEEKDAYS[isoWeekday(d) - 1]}<br />{fmtDate(d, { day: '2-digit', month: '2-digit' })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map(({ accommodationType: t, days: ds }) => [
                <tr key={`${t.id}h`}><td className="rowhead" colSpan={1} style={{ fontWeight: 600, background: 'var(--surface-2)' }}>{t.name}</td><td colSpan={DAYS} style={{ background: 'var(--surface-2)' }} /></tr>,
                <tr key={`${t.id}f`}>
                  <td className="rowhead muted">Свободно</td>
                  {ds.map((d) => <td key={d.date} style={d.free === 0 ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{d.free}</td>)}
                </tr>,
                <tr key={`${t.id}p`}>
                  <td className="rowhead">Цена, ₽</td>
                  {ds.map((d) => (
                    <td key={d.date} className={`pick${inSel(t.id, d.date) ? ' sel' : d.closed ? ' closed' : ''}`} onClick={() => pick(t.id, d.date)}>
                      {d.priceMinor === null ? '—' : (d.priceMinor / 100).toLocaleString('ru-RU')}
                    </td>
                  ))}
                </tr>,
                <tr key={`${t.id}m`}>
                  <td className="rowhead muted">Мин. ночей</td>
                  {ds.map((d) => <td key={d.date} className={inSel(t.id, d.date) ? 'sel' : ''}>{d.minStay ?? ''}</td>)}
                </tr>,
                <tr key={`${t.id}r`}>
                  <td className="rowhead muted">Ограничения</td>
                  {ds.map((d) => (
                    <td key={d.date} className={inSel(t.id, d.date) ? 'sel' : ''}>
                      <span className="flag" title="Продажи закрыты / закрыт заезд / закрыт выезд">
                        {[d.closed && 'стоп', d.closedToArrival && 'зз', d.closedToDeparture && 'зв'].filter(Boolean).join(' ')}
                      </span>
                    </td>
                  ))}
                </tr>,
              ])}
            </tbody>
          </table>
        </div>
      )}

      {writable && sel && (
        <form className="card stack" onSubmit={save}>
          <div className="row">
            <h2 style={{ margin: 0 }}>
              {allTypes ? 'Все категории' : typeName(sel.typeId)}: {fmtDate(selFrom)} – {fmtDate(selTo)}
            </h2>
            <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}>
              <input type="checkbox" checked={allTypes} onChange={(e) => setAllTypes(e.target.checked)} /> применить ко всем категориям
            </label>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>Пустое поле не меняет значение. Новое правило главнее старых на эти даты.</div>
          <div className="grid2">
            <label>Цена за ночь, ₽<input inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label>
            <label>Доп. взрослый, ₽<input inputMode="decimal" value={form.extraAdult} onChange={(e) => setForm({ ...form, extraAdult: e.target.value })} /></label>
            <label>Доп. ребёнок, ₽<input inputMode="decimal" value={form.extraChild} onChange={(e) => setForm({ ...form, extraChild: e.target.value })} /></label>
            <label>Мин. ночей<input type="number" min={1} value={form.minStay} onChange={(e) => setForm({ ...form, minStay: e.target.value })} /></label>
            <label>Макс. ночей<input type="number" min={1} value={form.maxStay} onChange={(e) => setForm({ ...form, maxStay: e.target.value })} /></label>
            <label>Бронировать не позднее чем за, дн.<input type="number" min={0} value={form.minLead} onChange={(e) => setForm({ ...form, minLead: e.target.value })} /></label>
          </div>
          <div className="row">
            {[['closed', 'Закрыть продажи'], ['cta', 'Закрыть заезд'], ['ctd', 'Закрыть выезд']].map(([k, l]) => (
              <label key={k} className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}>
                <input type="checkbox" checked={form[k as 'closed']} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} /> {l}
              </label>
            ))}
          </div>
          <div className="row">
            <span className="muted">Дни недели:</span>
            {WEEKDAYS.map((w, i) => (
              <label key={w} className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={form.weekdays.includes(i + 1)}
                  onChange={(e) => setForm({ ...form, weekdays: e.target.checked ? [...form.weekdays, i + 1].sort() : form.weekdays.filter((x) => x !== i + 1) })}
                /> {w}
              </label>
            ))}
          </div>
          <label>Название (видно в списке правил)<input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          <div className="row">
            <button className="btn primary" disabled={form.weekdays.length === 0}>Сохранить</button>
            <button type="button" className="btn" onClick={() => setSel(null)}>Отмена</button>
          </div>
        </form>
      )}

      {rules.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <h2>Правила на эти даты</h2>
          <div className="muted" style={{ fontSize: 12 }}>Чтобы снова открыть закрытые даты, удалите правило, которое их закрыло.</div>
          <table className="list">
            <thead><tr><th>Категория</th><th>Период</th><th>Дни</th><th>Что задаёт</th><th>Название</th><th /></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>{typeName(r.accommodation_type_id)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{period(r.period)}</td>
                  <td>{r.weekdays.length === 7 ? 'все' : r.weekdays.map((w) => WEEKDAYS[w - 1]).join(' ')}</td>
                  <td>{ruleText(r)}</td>
                  <td className="muted">{r.label}</td>
                  <td>{writable && <button className="btn danger" onClick={() => remove(r)}>Удалить</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
