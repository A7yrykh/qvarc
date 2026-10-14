'use client';
import { useEffect, useState } from 'react';
import { PROPERTY, addDays, api, errorText, fmtDate, rub } from '@/lib/api';

export interface BookedService {
  id: string; name: string; status: string; startsAt: string | null; endsAt: string | null; quantity: number; amountMinor: number; canCancel: boolean;
}
interface CatalogService {
  id: string; name: string; description: string | null; price: number; pricing: string; bookingMode: 'slot' | 'request'; durationMinutes: number | null;
  minAge: number | null; rules: string | null; cancellationPolicy: string | null; photos: string[]; maxQuantity: number; requiresConfirmation: boolean;
}
interface Category { id: string; name: string; services: CatalogService[] }
interface Slot { startsAt: string; endsAt: string; available: number }

const PRICING: Record<string, string> = { per_item: '', per_hour: ' / час', per_day: ' / день', per_person: ' / чел.', per_stay: ' / за всё проживание' };
const STATUS: Record<string, string> = { requested: 'ждёт подтверждения', confirmed: 'забронировано', in_use: 'выдано', done: 'завершено', cancelled: 'отменено' };

/** Доп. услуги и прокат: гость видит заказанное, добавляет новое и оплачивает онлайн */
export default function Services<T>({ token, timezone, arrival, departure, stayFrom, stayTo, canAdd, booked, dueMinor, onChange }: {
  token: string; timezone: string; arrival: string; departure: string; stayFrom: string; stayTo: string; canAdd: boolean; booked: BookedService[]; dueMinor: number; onChange: (b: T) => void;
}) {
  const [catalog, setCatalog] = useState<Category[]>([]);
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<CatalogService | null>(null);
  const [date, setDate] = useState(arrival);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const hm = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { timeZone: timezone, hour: '2-digit', minute: '2-digit' });
  const when = (s: BookedService) => s.startsAt
    ? `${new Date(s.startsAt).toLocaleDateString('ru-RU', { timeZone: timezone, day: 'numeric', month: 'long' })}, ${hm(s.startsAt)}${s.endsAt && s.endsAt !== s.startsAt ? `–${hm(s.endsAt)}` : ''}`
    : 'время согласуем';
  const days = Array.from({ length: Math.max(1, Math.round((Date.parse(departure) - Date.parse(arrival)) / 86_400_000) + 1) }, (_, i) => addDays(arrival, i));

  useEffect(() => { if (canAdd) api<Category[]>('GET', `/${PROPERTY}/services`).then(setCatalog, () => undefined); }, [canAdd]);
  useEffect(() => {
    setSlots(null); setSlot('');
    if (pick?.bookingMode === 'slot') api<{ slots: Slot[] }>('GET', `/${PROPERTY}/services/${pick.id}/slots?date=${date}`).then((r) => setSlots(r.slots.filter((x) => x.startsAt >= stayFrom && x.endsAt <= stayTo)), (e) => setError(errorText(e)));
  }, [pick, date]);

  const run = async (fn: () => Promise<T>) => {
    setBusy(true); setError('');
    try { onChange(await fn()); return true; } catch (e) { setError(errorText(e)); return false; } finally { setBusy(false); }
  };
  const add = async () => {
    if (!pick) return;
    const ok = await run(() => api<T>('POST', `/${PROPERTY}/bookings/${token}/services`, {
      serviceId: pick.id, quantity, comment: comment || null, startsAt: pick.bookingMode === 'slot' ? slot : null, idempotencyKey: crypto.randomUUID(),
    }));
    if (ok) { setPick(null); setOpen(false); setQuantity(1); setComment(''); }
  };
  const cancel = (s: BookedService) => run(() => api<T>('POST', `/${PROPERTY}/bookings/${token}/services/${s.id}/cancel`));
  const pay = async () => {
    setBusy(true); setError('');
    try {
      const r = await api<{ confirmationUrl: string }>('POST', `/${PROPERTY}/bookings/${token}/pay-services`, { attemptKey: crypto.randomUUID() });
      window.location.href = r.confirmationUrl;
    } catch (e) { setError(errorText(e)); setBusy(false); }
  };

  const total = (pick?.price ?? 0) * quantity;
  if (!canAdd && booked.length === 0) return null;
  return (
    <div className="card summary stack" style={{ gap: 10 }}>
      <h2 style={{ margin: 0 }}>Услуги и прокат</h2>
      {error && <div className="error">{error}</div>}
      {booked.map((s) => (
        <div key={s.id} className="line" style={{ alignItems: 'center', opacity: s.status === 'cancelled' ? 0.5 : 1 }}>
          <span>
            {s.name}{s.quantity > 1 && ` × ${s.quantity}`}
            <div className="small muted">{when(s)} · {STATUS[s.status] ?? s.status}</div>
          </span>
          <span style={{ textAlign: 'right' }}>
            {s.status === 'cancelled' ? <s>{rub(s.amountMinor)}</s> : rub(s.amountMinor)}
            {s.canCancel && <div><button className="btn link small" disabled={busy} onClick={() => cancel(s)}>отменить</button></div>}
          </span>
        </div>
      ))}
      {dueMinor > 0 && (
        <div className="row" style={{ alignItems: 'center' }}>
          <span className="small muted" style={{ marginRight: 'auto' }}>Услуги можно оплатить сейчас или при заезде вместе с проживанием.</span>
          <button className="btn primary" disabled={busy} onClick={pay}>Оплатить {rub(dueMinor)}</button>
        </div>
      )}

      {canAdd && !open && catalog.length > 0 && <div><button className="btn" onClick={() => setOpen(true)}>Добавить услугу</button></div>}
      {canAdd && open && !pick && (
        <div className="stack" style={{ gap: 12 }}>
          {catalog.map((c) => (
            <div key={c.id} className="stack" style={{ gap: 6 }}>
              <b>{c.name}</b>
              {c.services.map((s) => (
                <button key={s.id} className="btn" onClick={() => { setPick(s); setDate(arrival); setQuantity(1); }} style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, width: '100%' }}>
                  <span className="line" style={{ margin: 0 }}><span>{s.name}</span><b>{rub(s.price)}{PRICING[s.pricing] ?? ''}</b></span>
                  {s.description && <span className="small muted">{s.description}</span>}
                </button>
              ))}
            </div>
          ))}
          <div><button className="btn" onClick={() => setOpen(false)}>Закрыть</button></div>
        </div>
      )}
      {canAdd && pick && (
        <div className="stack" style={{ gap: 10 }}>
          <div className="line"><b>{pick.name}</b><b>{rub(pick.price)}{PRICING[pick.pricing] ?? ''}</b></div>
          {pick.description && <div className="small">{pick.description}</div>}
          {pick.rules && <div className="small muted">{pick.rules}</div>}
          {pick.minAge && <div className="small muted">С {pick.minAge} лет</div>}
          {pick.bookingMode === 'slot' ? (
            <>
              <label>День
                <select value={date} onChange={(e) => setDate(e.target.value)}>
                  {days.map((d) => <option key={d} value={d}>{fmtDate(d, { weekday: 'short', day: 'numeric', month: 'long' })}</option>)}
                </select>
              </label>
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                {slots === null ? <span className="muted small">Загрузка…</span>
                  : slots.filter((x) => x.available > 0).length === 0 ? <span className="muted small">На этот день свободного времени нет</span>
                  : slots.filter((x) => x.available > 0).map((x) => (
                    <button key={x.startsAt} className={`btn${slot === x.startsAt ? ' primary' : ''}`} onClick={() => setSlot(x.startsAt)}>{hm(x.startsAt)}</button>
                  ))}
              </div>
              {pick.durationMinutes && <div className="small muted">Сеанс {pick.durationMinutes} мин</div>}
            </>
          ) : (
            <label>Пожелания: когда удобно, сколько человек
              <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
            </label>
          )}
          {pick.maxQuantity > 1 && (
            <label>Количество
              <select value={quantity} onChange={(e) => setQuantity(Number(e.target.value))}>
                {Array.from({ length: Math.min(pick.maxQuantity, slots?.find((x) => x.startsAt === slot)?.available ?? pick.maxQuantity) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          {pick.cancellationPolicy && <div className="small muted">{pick.cancellationPolicy}</div>}
          {pick.requiresConfirmation && <div className="small muted">Администратор подтвердит заказ и свяжется с вами.</div>}
          <div className="row">
            <button className="btn primary" disabled={busy || (pick.bookingMode === 'slot' && !slot)} onClick={add}>Добавить в бронь за {rub(total)}</button>
            <button className="btn" onClick={() => setPick(null)}>Назад</button>
          </div>
        </div>
      )}
    </div>
  );
}
