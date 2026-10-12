'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { CHANNEL, addDays, byName, errorText, fmtDate, get, post, restrictionText, rub, todayLocal } from '@/lib/api';

interface Type { id: string; name: string; max_occupancy: number; max_adults: number }
interface Plan { id: string; name: string; is_active: boolean; accommodation_type_ids: string[] }
interface Unit { id: string; name: string; accommodation_type_id: string; is_active: boolean }
interface GuestRow { id: string; last_name: string; first_name: string; middle_name: string | null; phone_e164: string | null }
interface Quote {
  nights: { night: string; amountMinor: number }[]; totalMinor: number; bookable: boolean;
  restrictions: { code: string; night?: string; value?: number }[]; prepaymentDueMinor: number;
}

export default function NewBookingPage() {
  return <Suspense fallback={<div className="muted">Загрузка…</div>}><NewBooking /></Suspense>;
}

function NewBooking() {
  const router = useRouter();
  const sp = useSearchParams();
  const [types, setTypes] = useState<Type[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const arrival0 = sp.get('arrival') ?? todayLocal();
  const [f, setF] = useState({
    typeId: sp.get('typeId') ?? '', planId: '', unitId: sp.get('unitId') ?? '',
    arrival: arrival0, departure: addDays(arrival0, 1), adults: 2, childrenAges: '' as string,
    status: 'confirmed', channelCode: 'front_desk', specialRequests: '', override: false, overrideReason: '',
  });
  const [guestMode, setGuestMode] = useState<'new' | 'existing'>('new');
  const [guest, setGuest] = useState({ lastName: '', firstName: '', middleName: '', phone: '', email: '' });
  const [guestQ, setGuestQ] = useState('');
  const [found, setFound] = useState<GuestRow[]>([]);
  const [guestId, setGuestId] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteErr, setQuoteErr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Ключ повторной отправки: двойной клик или повтор после обрыва связи не создаст вторую бронь
  const [idemKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    get<Type[]>('/accommodation-types').then(setTypes).catch((e) => setError(errorText(e)));
    get<Plan[]>('/rate-plans').then(setPlans).catch((e) => setError(errorText(e)));
    get<Unit[]>('/units').then((u) => setUnits(u.sort(byName))).catch(() => undefined);
  }, []);

  const typePlans = useMemo(() => plans.filter((p) => p.is_active && p.accommodation_type_ids.includes(f.typeId)), [plans, f.typeId]);
  useEffect(() => {
    if (!typePlans.find((p) => p.id === f.planId)) setF((x) => ({ ...x, planId: typePlans[0]?.id ?? '' }));
  }, [typePlans, f.planId]);

  const childrenAges = f.childrenAges.split(/[\s,;]+/).filter(Boolean).map(Number);
  const agesValid = childrenAges.every((a) => Number.isInteger(a) && a >= 0 && a <= 17);

  useEffect(() => {
    setQuote(null); setQuoteErr('');
    if (!f.typeId || !f.planId || f.departure <= f.arrival || !agesValid) return;
    const t = setTimeout(() => {
      post<Quote>('/quotes', { accommodationTypeId: f.typeId, ratePlanId: f.planId, arrival: f.arrival, departure: f.departure, adults: f.adults, childrenAges })
        .then(setQuote, (e) => setQuoteErr(errorText(e)));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.typeId, f.planId, f.arrival, f.departure, f.adults, f.childrenAges]);

  useEffect(() => {
    if (guestMode !== 'existing' || guestQ.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(() => get<GuestRow[]>(`/guests?q=${encodeURIComponent(guestQ.trim())}`).then(setFound).catch(() => undefined), 250);
    return () => clearTimeout(t);
  }, [guestQ, guestMode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = {
        accommodationTypeId: f.typeId, ratePlanId: f.planId, unitId: f.unitId || undefined,
        arrival: f.arrival, departure: f.departure, adults: f.adults, childrenAges,
        status: f.status, channelCode: f.channelCode, specialRequests: f.specialRequests || null,
        idempotencyKey: idemKey,
        overrideRestrictions: f.override, overrideReason: f.override ? f.overrideReason : undefined,
        ...(guestMode === 'existing'
          ? { guestId }
          : { guest: { lastName: guest.lastName, firstName: guest.firstName, middleName: guest.middleName || null, phone: guest.phone || null, email: guest.email || null } }),
      };
      const r = await post<{ id: string }>('/bookings', body);
      router.push(`/bookings/${r.id}`);
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.value });
  const typeUnits = units.filter((u) => u.accommodation_type_id === f.typeId && u.is_active);
  const nights = quote?.nights.length ?? 0;

  return (
    <form className="stack" style={{ maxWidth: 900 }} onSubmit={submit}>
      <h1>Новая бронь</h1>
      {error && <div className="error">{error}</div>}
      <div className="card stack">
        <h2>Проживание</h2>
        <div className="grid2">
          <label>Заезд<input type="date" required value={f.arrival} onChange={(e) => setF({ ...f, arrival: e.target.value, departure: e.target.value >= f.departure ? addDays(e.target.value, 1) : f.departure })} /></label>
          <label>Выезд<input type="date" required value={f.departure} min={addDays(f.arrival, 1)} onChange={set('departure')} /></label>
          <label>Взрослых<input type="number" min={1} max={50} required value={f.adults} onChange={set('adults')} /></label>
          <label>Возраст детей через запятую<input value={f.childrenAges} placeholder="например 5, 12" onChange={set('childrenAges')} /></label>
        </div>
        <div className="grid2">
          <label>Категория
            <select required value={f.typeId} onChange={(e) => setF({ ...f, typeId: e.target.value, unitId: '' })}>
              <option value="">Выберите</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name} (до {t.max_occupancy} чел.)</option>)}
            </select>
          </label>
          <label>Тариф
            <select required value={f.planId} onChange={set('planId')}>
              {typePlans.length === 0 && <option value="">Нет тарифов для категории</option>}
              {typePlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label>Номер
            <select value={f.unitId} onChange={set('unitId')}>
              <option value="">Любой свободный</option>
              {typeUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        </div>
        {!agesValid && <div className="error">Возраст детей: целые числа от 0 до 17</div>}
        {quoteErr && <div className="error">{quoteErr}</div>}
        {quote && (
          <div className={quote.bookable ? 'notice' : 'error'}>
            {quote.bookable ? (
              <>
                {nights} ноч., итого <b>{rub(quote.totalMinor)}</b>
                {quote.prepaymentDueMinor > 0 && <>, предоплата {rub(quote.prepaymentDueMinor)}</>}
                <div style={{ fontSize: 12, marginTop: 4 }}>{quote.nights.map((n) => `${fmtDate(n.night, { day: '2-digit', month: '2-digit' })}: ${rub(n.amountMinor)}`).join(' · ')}</div>
              </>
            ) : (
              <>Нельзя забронировать по тарифу: {quote.restrictions.map(restrictionText).join('; ')}</>
            )}
          </div>
        )}
        {quote && !quote.bookable && !quote.restrictions.some((r) => ['too_many_guests', 'no_price'].includes(r.code)) && (
          <div className="row">
            <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}>
              <input type="checkbox" checked={f.override} onChange={(e) => setF({ ...f, override: e.target.checked })} /> Принять вопреки ограничениям
            </label>
            {f.override && <input required placeholder="Причина (попадёт в журнал)" value={f.overrideReason} onChange={set('overrideReason')} style={{ flex: 1 }} />}
          </div>
        )}
      </div>

      <div className="card stack">
        <div className="row">
          <h2 style={{ margin: 0, marginRight: 'auto' }}>Гость</h2>
          <button type="button" className={`btn ${guestMode === 'new' ? 'primary' : ''}`} onClick={() => setGuestMode('new')}>Новый</button>
          <button type="button" className={`btn ${guestMode === 'existing' ? 'primary' : ''}`} onClick={() => setGuestMode('existing')}>Из базы</button>
        </div>
        {guestMode === 'new' ? (
          <div className="grid2">
            <label>Фамилия<input required value={guest.lastName} onChange={(e) => setGuest({ ...guest, lastName: e.target.value })} /></label>
            <label>Имя<input required value={guest.firstName} onChange={(e) => setGuest({ ...guest, firstName: e.target.value })} /></label>
            <label>Отчество<input value={guest.middleName} onChange={(e) => setGuest({ ...guest, middleName: e.target.value })} /></label>
            <label>Телефон<input type="tel" placeholder="+79001234567" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value.replace(/[\s()-]/g, '') })} /></label>
            <label>E-mail<input type="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} /></label>
          </div>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <input placeholder="Фамилия, телефон или e-mail" value={guestQ} onChange={(e) => setGuestQ(e.target.value)} />
            {found.map((g) => (
              <label key={g.id} className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}>
                <input type="radio" name="guest" checked={guestId === g.id} onChange={() => setGuestId(g.id)} />
                {g.last_name} {g.first_name} {g.middle_name ?? ''} <span className="muted">{g.phone_e164 ?? ''}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="card grid2">
        <label>Статус
          <select value={f.status} onChange={set('status')}>
            <option value="confirmed">Подтверждена</option>
            <option value="pending_payment">Ожидает оплаты</option>
            <option value="pending_confirmation">Ожидает подтверждения</option>
          </select>
        </label>
        <label>Источник
          <select value={f.channelCode} onChange={set('channelCode')}>
            {Object.entries(CHANNEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label style={{ gridColumn: '1 / -1' }}>Пожелания гостя<textarea rows={2} value={f.specialRequests} onChange={set('specialRequests')} /></label>
      </div>

      <div className="row">
        <button className="btn primary" disabled={busy || !quote || (!quote.bookable && !f.override) || (guestMode === 'existing' && !guestId)}>Создать бронь</button>
        <button type="button" className="btn" onClick={() => router.back()}>Отмена</button>
      </div>
    </form>
  );
}
