'use client';
import { useCallback, useEffect, useState } from 'react';
import { errorText, get, post, rub } from '@/lib/api';

interface Item { id: string; service_name: string; status: string; starts_at: string | null; ends_at: string | null; quantity: number; amount_minor: number; source: string }
interface Service { id: string; name: string; price_minor: number; equipment_type_id: string | null; duration_minutes: number | null; max_quantity: number; is_active: boolean }
interface Slot { startsAt: string; endsAt: string; available: number }

const STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: 'ждёт подтверждения', tone: 'warn' },
  confirmed: { label: 'подтверждена', tone: 'ok' },
  in_use: { label: 'выдано', tone: 'info' },
  done: { label: 'завершена', tone: 'muted' },
  cancelled: { label: 'отменена', tone: 'muted' },
};
const SOURCE: Record<string, string> = { admin: 'админка', guest_app: 'приложение', booking_site: 'сайт' };
const dt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const hm = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Услуги и прокат в брони: список, добавление администратором, отмена */
export default function BookingServices({ bookingId, arrival, departure, editable, manage, onChange }: {
  bookingId: string; arrival: string; departure: string; editable: boolean; manage: boolean; onChange: () => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState({ serviceId: '', date: arrival, slot: '', quantity: '1', comment: '' });
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { get<Item[]>(`/bookings/${bookingId}/services`).then(setItems, (e) => setError(errorText(e))); }, [bookingId]);
  useEffect(load, [load]);
  useEffect(() => { if (manage && editable) get<Service[]>('/services').then((s) => setServices(s.filter((x) => x.is_active)), () => undefined); }, [manage, editable]);

  const svc = services.find((s) => s.id === form.serviceId);
  useEffect(() => {
    setSlots([]);
    if (svc?.equipment_type_id && form.date) get<{ slots: Slot[] }>(`/services/${svc.id}/slots?date=${form.date}`).then((r) => setSlots(r.slots), (e) => setError(errorText(e)));
  }, [svc, form.date]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); load(); onChange(); } catch (e) { setError(errorText(e)); }
    setBusy(false);
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!svc) return;
    run(() => post('/service-bookings', {
      serviceId: svc.id, bookingId, quantity: Number(form.quantity), comment: form.comment || null,
      startsAt: svc.equipment_type_id ? form.slot : null,
    })).then(() => setForm({ ...form, serviceId: '', slot: '', quantity: '1', comment: '' }));
  };

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <h2>Услуги и прокат</h2>
      {error && <div className="error">{error}</div>}
      {items.length === 0 ? <div className="muted">Гость не заказывал услуг</div> : (
        <table className="list" style={{ border: 0 }}>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td style={{ padding: '6px 0' }}>
                  {i.service_name}{i.quantity > 1 && ` × ${i.quantity}`}
                  <div className="muted" style={{ fontSize: 12 }}>{i.starts_at ? `${dt(i.starts_at)}${i.ends_at && i.ends_at !== i.starts_at ? `–${hm(i.ends_at)}` : ''}` : 'без времени'} · {SOURCE[i.source] ?? i.source}</div>
                </td>
                <td style={{ padding: '6px 0' }}><span className={`badge tone-${STATUS[i.status]?.tone ?? 'muted'}`}>{STATUS[i.status]?.label ?? i.status}</span></td>
                <td className="num" style={{ padding: '6px 0' }}>{rub(i.amount_minor)}</td>
                <td style={{ padding: '6px 0', textAlign: 'right' }}>
                  {manage && i.status === 'requested' && <button className="btn" disabled={busy} onClick={() => run(() => post(`/service-bookings/${i.id}/confirm`))}>Подтвердить</button>}
                  {manage && ['requested', 'confirmed'].includes(i.status) && (
                    <> <button className="btn danger" disabled={busy} onClick={() => confirm('Отменить услугу? Сумма уйдёт из брони.') && run(() => post(`/service-bookings/${i.id}/cancel`))}>Отменить</button></>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {manage && editable && services.length > 0 && (
        <form className="row" onSubmit={add} style={{ alignItems: 'flex-end' }}>
          <label>Услуга
            <select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value, slot: '' })} required>
              <option value="">Выберите</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}, {rub(s.price_minor)}</option>)}
            </select>
          </label>
          {svc?.equipment_type_id && (
            <>
              <label>День<input type="date" min={arrival} max={departure} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value, slot: '' })} /></label>
              <label>Время
                <select value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })} required>
                  <option value="">{slots.length ? 'Выберите' : 'нет свободного времени'}</option>
                  {slots.filter((s) => s.available > 0).map((s) => <option key={s.startsAt} value={s.startsAt}>{hm(s.startsAt)} (свободно {s.available})</option>)}
                </select>
              </label>
            </>
          )}
          {svc && <label>Кол-во<input inputMode="numeric" style={{ width: 60 }} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label>}
          {svc && !svc.equipment_type_id && <label>Комментарий<input value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} placeholder="когда, сколько человек" /></label>}
          <button className="btn primary" disabled={busy || !svc}>Добавить в бронь</button>
        </form>
      )}
    </div>
  );
}
