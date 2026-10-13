'use client';
import { useCallback, useEffect, useState } from 'react';
import { errorText, get, post, put } from '@/lib/api';
import { can, useMe } from '@/components/Shell';

interface Tier { days_before: number; penalty_pct: number; penalty_nights?: number }
interface Plan {
  id: string; code: string; name: string; meal_plan: string; is_refundable: boolean; is_public: boolean; is_active: boolean;
  cancellation_policy: Tier[]; prepayment_policy: { pct: number; due: string; days?: number }; deposit_policy: { days_before: number; seasons: { name: string; from: string; to: string }[] } | null; accommodation_type_ids: string[];
}
interface Type { id: string; name: string }
interface Season { name: string; from: string; to: string }

const MEAL: Record<string, string> = { none: 'Без питания', breakfast: 'Завтрак', half_board: 'Полупансион', full_board: 'Полный пансион' };
const NEW = {
  id: null as string | null,
  code: '', name: '', mealPlan: 'none', isRefundable: true, isPublic: true, isActive: true, typeIds: [] as string[],
  tiers: [{ days_before: 3, penalty_pct: 0 }, { days_before: 0, penalty_pct: 0, penalty_nights: 1 }] as Tier[],
  prepayPct: 30, prepayDue: 'at_booking', prepayDays: 0,
  deposit: false, depositDays: 14, seasons: [{ name: 'Летний сезон', from: '01.06', to: '31.08' }] as Season[],
};
type Form = typeof NEW;

// Сезон хранится как ММ-ДД, в форме показывается как ДД.ММ
const toDm = (md: string) => md.split('-').reverse().join('.');
const fromDm = (dm: string) => { const [d, m] = dm.trim().split('.'); return `${(m ?? '').padStart(2, '0')}-${(d ?? '').padStart(2, '0')}`; };

function formOf(p: Plan): Form {
  return {
    id: p.id, code: p.code, name: p.name, mealPlan: p.meal_plan, isRefundable: p.is_refundable, isPublic: p.is_public, isActive: p.is_active,
    typeIds: p.accommodation_type_ids, tiers: p.cancellation_policy.map((t) => ({ ...t })),
    prepayPct: p.prepayment_policy.pct, prepayDue: p.prepayment_policy.due, prepayDays: p.prepayment_policy.days ?? 0,
    deposit: !!p.deposit_policy, depositDays: p.deposit_policy?.days_before ?? 14,
    seasons: p.deposit_policy ? p.deposit_policy.seasons.map((x) => ({ name: x.name, from: toDm(x.from), to: toDm(x.to) })) : NEW.seasons,
  };
}

/** Условия отмены словами: «за 7+ дн. бесплатно, позже 100%». */
function policyText(tiers: Tier[]) {
  const sorted = [...tiers].sort((a, b) => b.days_before - a.days_before);
  const fine = (t: Tier) =>
    t.penalty_nights !== undefined
      ? t.penalty_nights === 0 ? 'бесплатно' : `удержание ${t.penalty_nights === 1 ? 'одних суток' : `${t.penalty_nights} сут.`}`
      : t.penalty_pct === 0 ? 'бесплатно' : `удержание ${t.penalty_pct}%`;
  return sorted.map((t, i) => `${t.days_before > 0 ? `за ${t.days_before}+ дн.` : i > 0 ? `менее чем за ${sorted[i - 1].days_before} дн.` : 'в любой момент'}: ${fine(t)}`).join('; ');
}

export default function RatesPage() {
  const me = useMe();
  const writable = can(me, 'rates.write');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [types, setTypes] = useState<Type[]>([]);
  const [f, setF] = useState<Form | null>(null);
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
      const body = {
        code: f.code, name: f.name, mealPlan: f.mealPlan, isRefundable: f.isRefundable, isPublic: f.isPublic, isActive: f.isActive,
        accommodationTypeIds: f.typeIds, cancellationPolicy: f.tiers,
        prepaymentPolicy: { pct: f.prepayPct, due: f.prepayDue, ...(f.prepayDue === 'days_before_arrival' ? { days: f.prepayDays } : {}) },
        depositPolicy: f.isRefundable && f.deposit ? { days_before: f.depositDays, seasons: f.seasons.map((x) => ({ name: x.name, from: fromDm(x.from), to: fromDm(x.to) })) } : null,
      };
      if (f.id) await put(`/rate-plans/${f.id}`, body);
      else await post('/rate-plans', body);
      setNotice(f.id ? 'Тариф сохранён. Новые условия действуют для новых бронирований и для отмен с этого момента.' : 'Тариф создан. Цены задаются в разделе «Цены и ограничения».');
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
        <thead><tr><th>Тариф</th><th>Питание</th><th>Отмена</th><th>Предоплата</th><th>Категории</th>{writable && <th />}</tr></thead>
        <tbody>
          {plans.map((p) => (
            <tr key={p.id} style={p.is_active ? undefined : { opacity: 0.55 }}>
              <td>{p.name}<div className="muted" style={{ fontSize: 12 }}>{p.code}{p.is_public ? '' : ', только для администратора'}{p.is_active ? '' : ', выключен'}</div></td>
              <td>{MEAL[p.meal_plan] ?? p.meal_plan}</td>
              <td>
                {p.is_refundable ? policyText(p.cancellation_policy) : 'невозвратный'}
                {p.is_refundable && p.deposit_policy && (
                  <div className="muted small">
                    Депозит при отмене менее чем за {p.deposit_policy.days_before} дн.: {p.deposit_policy.seasons.map((x) => `${x.name.toLowerCase()} ${x.from.split('-').reverse().join('.')}–${x.to.split('-').reverse().join('.')}`).join(', ')}
                  </div>
                )}
              </td>
              <td>{p.prepayment_policy.pct}% {p.prepayment_policy.due === 'at_booking' ? 'при бронировании' : `за ${p.prepayment_policy.days ?? 0} дн. до заезда`}</td>
              <td>{typeNames(p.accommodation_type_ids)}</td>
              {writable && <td><button className="btn" onClick={() => { setNotice(''); setError(''); setF(formOf(p)); }}>Изменить</button></td>}
            </tr>
          ))}
        </tbody>
      </table>

      {f && (
        <form className="card stack" onSubmit={save}>
          <h2>{f.id ? `Тариф «${f.name}»` : 'Новый тариф'}</h2>
          <div className="grid2">
            <label>Название<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Стандартный" /></label>
            <label>Код (латиницей)<input required pattern="[a-z0-9_\-]{2,40}" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="standard" /></label>
            <label>Питание<select value={f.mealPlan} onChange={(e) => setF({ ...f, mealPlan: e.target.value })}>{Object.entries(MEAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          </div>
          <div className="row">
            <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}><input type="checkbox" checked={f.isPublic} onChange={(e) => setF({ ...f, isPublic: e.target.checked })} /> Продаётся на сайте</label>
            <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}><input type="checkbox" checked={f.isRefundable} onChange={(e) => setF({ ...f, isRefundable: e.target.checked })} /> Возвратный</label>
            {f.id && <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}><input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Включён</label>}
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
          {f.isRefundable && (
            <div className="stack" style={{ gap: 6 }}>
              <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}>
                <input type="checkbox" checked={f.deposit} onChange={(e) => setF({ ...f, deposit: e.target.checked })} /> Сезонный депозит: при поздней отмене в сезон оплата не возвращается, а остаётся на депозите гостя
              </label>
              {f.deposit && (
                <>
                  <div className="row">при отмене менее чем за <input type="number" min={1} max={365} style={{ width: 70 }} value={f.depositDays} onChange={(e) => setF({ ...f, depositDays: Number(e.target.value) })} /> дн. до заезда</div>
                  {f.seasons.map((x, i) => (
                    <div key={i} className="row">
                      <input aria-label="Название сезона" required value={x.name} style={{ width: 220 }} onChange={(e) => setF({ ...f, seasons: f.seasons.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
                      с <input aria-label="Начало, ДД.ММ" required pattern="\d{1,2}\.\d{1,2}" placeholder="01.06" style={{ width: 70 }} value={x.from} onChange={(e) => setF({ ...f, seasons: f.seasons.map((y, j) => (j === i ? { ...y, from: e.target.value } : y)) })} />
                      по <input aria-label="Конец, ДД.ММ" required pattern="\d{1,2}\.\d{1,2}" placeholder="31.08" style={{ width: 70 }} value={x.to} onChange={(e) => setF({ ...f, seasons: f.seasons.map((y, j) => (j === i ? { ...y, to: e.target.value } : y)) })} />
                      {f.seasons.length > 1 && <button type="button" className="btn" onClick={() => setF({ ...f, seasons: f.seasons.filter((_, j) => j !== i) })}>×</button>}
                    </div>
                  ))}
                  <div><button type="button" className="btn" onClick={() => setF({ ...f, seasons: [...f.seasons, { name: 'Новогодние праздники', from: '25.12', to: '10.01' }] })}>Добавить сезон</button></div>
                </>
              )}
            </div>
          )}
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
          <div className="row"><button className="btn primary" disabled={f.typeIds.length === 0}>{f.id ? 'Сохранить' : 'Создать'}</button><button type="button" className="btn" onClick={() => setF(null)}>Отмена</button></div>
        </form>
      )}
    </div>
  );
}
