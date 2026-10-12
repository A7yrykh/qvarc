'use client';
import { useCallback, useEffect, useState } from 'react';
import { errorText, get, post } from '@/lib/api';
import { can, useMe } from '@/components/Shell';

interface Tier { days_before: number; penalty_pct: number; penalty_nights?: number }
interface Plan {
  id: string; code: string; name: string; meal_plan: string; is_refundable: boolean; is_public: boolean; is_active: boolean;
  cancellation_policy: Tier[]; prepayment_policy: { pct: number; due: string; days?: number }; accommodation_type_ids: string[];
}
interface Type { id: string; name: string }

const MEAL: Record<string, string> = { none: 'Без питания', breakfast: 'Завтрак', half_board: 'Полупансион', full_board: 'Полный пансион' };
const NEW = {
  code: '', name: '', mealPlan: 'none', isRefundable: true, isPublic: true, typeIds: [] as string[],
  tiers: [{ days_before: 7, penalty_pct: 0 }, { days_before: 0, penalty_pct: 100 }] as Tier[],
  prepayPct: 30, prepayDue: 'at_booking', prepayDays: 0,
};

/** Условия отмены словами: «за 7+ дн. бесплатно, позже 100%». */
function policyText(tiers: Tier[]) {
  const sorted = [...tiers].sort((a, b) => b.days_before - a.days_before);
  const fine = (t: Tier) =>
    t.penalty_nights !== undefined
      ? t.penalty_nights === 0 ? 'бесплатно' : `штраф ${t.penalty_nights} ноч.`
      : t.penalty_pct === 0 ? 'бесплатно' : `штраф ${t.penalty_pct}%`;
  return sorted.map((t) => `${t.days_before > 0 ? `за ${t.days_before}+ дн.` : 'в день заезда'}: ${fine(t)}`).join('; ');
}

export default function RatesPage() {
  const me = useMe();
  const writable = can(me, 'rates.write');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [types, setTypes] = useState<Type[]>([]);
  const [f, setF] = useState<typeof NEW | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    get<Plan[]>('/rate-plans').then(setPlans, (e) => setError(errorText(e)));
    get<Type[]>('/accommodation-types').then(setTypes, () => undefined);
  }, []);
  useEffect(load, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f) return;
    setError(''); setNotice('');
    try {
      await post('/rate-plans', {
        code: f.code, name: f.name, mealPlan: f.mealPlan, isRefundable: f.isRefundable, isPublic: f.isPublic,
        accommodationTypeIds: f.typeIds, cancellationPolicy: f.tiers,
        prepaymentPolicy: { pct: f.prepayPct, due: f.prepayDue, ...(f.prepayDue === 'days_before_arrival' ? { days: f.prepayDays } : {}) },
      });
      setNotice('Тариф создан. Цены задаются в разделе «Цены и ограничения».');
      setF(null); load();
    } catch (err) { setError(errorText(err)); }
  };

  const typeNames = (ids: string[]) => types.filter((t) => ids.includes(t.id)).map((t) => t.name).join(', ');

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <div className="row">
        <h1 style={{ margin: 0, marginRight: 'auto' }}>Тарифы</h1>
        {writable && !f && <button className="btn" onClick={() => setF({ ...NEW, typeIds: types.map((t) => t.id) })}>Добавить тариф</button>}
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      <table className="list">
        <thead><tr><th>Тариф</th><th>Питание</th><th>Отмена</th><th>Предоплата</th><th>Категории</th></tr></thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.id} style={p.is_active ? undefined : { opacity: 0.55 }}>
              <td>{p.name}<div className="muted" style={{ fontSize: 12 }}>{p.code}{p.is_public ? '' : ', только для администратора'}</div></td>
              <td>{MEAL[p.meal_plan] ?? p.meal_plan}</td>
              <td>{p.is_refundable ? policyText(p.cancellation_policy) : 'невозвратный'}</td>
              <td>{p.prepayment_policy.pct}% {p.prepayment_policy.due === 'at_booking' ? 'при бронировании' : `за ${p.prepayment_policy.days ?? 0} дн. до заезда`}</td>
              <td>{typeNames(p.accommodation_type_ids)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {f && (
        <form className="card stack" onSubmit={save}>
          <h2>Новый тариф</h2>
          <div className="grid2">
            <label>Название<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Стандартный" /></label>
            <label>Код (латиницей)<input required pattern="[a-z0-9_\-]{2,40}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="standard" /></label>
            <label>Питание<select value={f.mealPlan} onChange={(e) => setF({ ...f, mealPlan: e.target.value })}>{Object.entries(MEAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          </div>
          <div className="row">
            <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}><input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} /> Продаётся на сайте</label>
            <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}><input type="checkbox" checked={f.isRefundable} onChange={(e) => setF({ ...f, isRefundable: e.target.checked })} /> Возвратный</label>
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="muted">Условия отмены (штраф в % от стоимости или стоимостью первых ночей; строка «0 дней» обязательна)</span>
            {f.tiers.map((t, i) => (
              <div key={i} className="row">
                за <input type="number" min={0} style={{ width: 70 }} value={t.days_before} onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => (j === i ? { ...x, days_before: Number(e.target.value) } : x)) })} /> дн. и более до заезда штраф
                <input type="number" min={0} max={t.penalty_nights !== undefined ? 30 : 100} style={{ width: 70 }} value={t.penalty_nights ?? t.penalty_pct}
                  onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => (j === i ? (x.penalty_nights !== undefined ? { ...x, penalty_nights: Number(e.target.value) } : { ...x, penalty_pct: Number(e.target.value) }) : x)) })} />
                <select aria-label="Единица штрафа" value={t.penalty_nights !== undefined ? 'nights' : 'pct'}
                  onChange={(e) => setF({ ...f, tiers: f.tiers.map((x, j) => (j === i ? (e.target.value === 'nights' ? { days_before: x.days_before, penalty_pct: 0, penalty_nights: 1 } : { days_before: x.days_before, penalty_pct: 0 }) : x)) })}>
                  <option value="pct">% стоимости</option>
                  <option value="nights">ночей</option>
                </select>
                {f.tiers.length > 1 && <button type="button" className="btn" onClick={() => setF({ ...f, tiers: f.tiers.filter((_, j) => j !== i) })}>×</button>}
              </div>
            ))}
            <div><button type="button" className="btn" onClick={() => setF({ ...f, tiers: [...f.tiers, { days_before: 14, penalty_pct: 0 }] })}>Добавить строку</button></div>
          </div>
          <div className="grid2">
            <label>Предоплата, %<input type="number" min={0} max={100} value={f.prepayPct} onChange={(e) => setF({ ...f, prepayPct: Number(e.target.value) })} /></label>
            <label>Когда
              <select value={f.prepayDue} onChange={(e) => setF({ ...f, prepayDue: e.target.value })}>
                <option value="at_booking">При бронировании</option>
                <option value="days_before_arrival">За N дней до заезда</option>
              </select>
            </label>
            {f.prepayDue === 'days_before_arrival' && <label>Дней до заезда<input type="number" min={0} value={f.prepayDays} onChange={(e) => setF({ ...f, prepayDays: Number(e.target.value) })} /></label>}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <span className="muted">Категории в тарифе</span>
            <div className="row">
              {types.map((t) => (
                <label key={t.id} className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}>
                  <input type="checkbox" checked={f.typeIds.includes(t.id)} onChange={(e) => setF({ ...f, typeIds: e.target.checked ? [...f.typeIds, t.id] : f.typeIds.filter((x) => x !== t.id) })} /> {t.name}
                </label>
              ))}
            </div>
          </div>
          <div className="row"><button className="btn primary" disabled={f.typeIds.length === 0}>Создать</button><button type="button" className="btn" onClick={() => setF(null)}>Отмена</button></div>
        </form>
      )}
    </div>
  );
}
