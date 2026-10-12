'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CHANNEL, STATUS, byName, diffDays, errorText, fmtDate, get, patch, post, rub, toMinor } from '@/lib/api';
import { can, useMe } from '@/components/Shell';

interface Stay { id: string; unit_id: string | null; unit_name: string | null; type_name: string; accommodation_type_id: string; stay: string; is_active: boolean; adults: number; children: number }
interface Booking {
  id: string; number: string; status: string; payment_state: string; arrival: string; departure: string; adults: number; children_ages: number[];
  total_minor: number; paid_minor: number; balance_minor: number; prepayment_due_minor: number; special_requests: string | null; created_at: string;
  channel_code: string; booker_guest_id: string; last_name: string; first_name: string; phone_e164: string | null; email: string | null;
  stays: Stay[]; nights: { booking_stay_id: string; night: string; amount_minor: number }[];
  history: { id: number; from_status: string | null; to_status: string; changed_at: string; reason: string | null; source: string }[];
  allowed_transitions: string[];
  registration: Registration;
  deposit: { amount_minor: number; balance_minor: number; season: string; created_at: string } | null;
}
interface Registration {
  guestsSubmittedAt: string | null; rulesVersion: string | null; rulesAcceptedAt: string | null;
  guests: { id: string; firstName: string; lastName: string; middleName: string | null; isChild: boolean; isPrimary: boolean; document: { docType: string; numberMasked: string } | null }[];
}
const DOC_TYPE: Record<string, string> = { ru_passport: 'паспорт РФ', foreign_passport: 'иностранный паспорт', birth_certificate: 'свидетельство о рождении' };
interface Unit { id: string; name: string; accommodation_type_id: string; is_active: boolean }
interface Payment { id: string; purpose: string; method: string; provider: string | null; status: string; amount_minor: number; refunded_minor: number; paid_at: string | null; created_at: string }

const PAY_STATUS: Record<string, { label: string; tone: string }> = {
  created: { label: 'Создан', tone: 'muted' }, pending: { label: 'Ждёт оплаты', tone: 'warn' }, authorized: { label: 'Авторизован', tone: 'info' },
  succeeded: { label: 'Оплачен', tone: 'ok' }, failed: { label: 'Не прошёл', tone: 'bad' }, cancelled: { label: 'Отменён', tone: 'muted' },
};

const ACTION: Record<string, { label: string; cls?: string; needsReason?: boolean }> = {
  confirmed: { label: 'Подтвердить', cls: 'primary' },
  checked_in: { label: 'Заселить', cls: 'primary' },
  checked_out: { label: 'Выселить', cls: 'primary' },
  pending_payment: { label: 'Ждать оплату' },
  pending_confirmation: { label: 'Ждать подтверждения' },
  cancelled: { label: 'Отменить бронь', cls: 'danger', needsReason: true },
  no_show: { label: 'Неявка', cls: 'danger', needsReason: true },
};

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const me = useMe();
  const [b, setB] = useState<Booking | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const [dates, setDates] = useState({ arrival: '', departure: '' });
  const [payments, setPayments] = useState<Payment[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await get<Booking>(`/bookings/${id}`);
      setB(data);
      setDates({ arrival: data.arrival, departure: data.departure });
      if (can(me, 'payment.read')) setPayments(await get<Payment[]>(`/bookings/${id}/payments`));
    } catch (e) { setError(errorText(e)); }
  }, [id, me]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (can(me, 'inventory.read')) get<Unit[]>('/units').then((u) => setUnits(u.sort(byName))).catch(() => undefined); }, [me]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); setNotice(ok); await load(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  if (!b) return error ? <div className="error">{error}</div> : <div className="muted">Загрузка…</div>;
  const st = STATUS[b.status] ?? { label: b.status, tone: 'muted' };
  const stay = b.stays.find((s) => s.is_active) ?? b.stays[0];
  const editable = can(me, 'booking.write') && !['cancelled', 'no_show', 'expired', 'checked_out'].includes(b.status);
  const sameType = units.filter((u) => u.accommodation_type_id === stay?.accommodation_type_id && u.is_active && u.id !== stay?.unit_id);

  const refund = (p: Payment) => {
    const left = (p.amount_minor - p.refunded_minor) / 100;
    const sum = window.prompt(`Сумма возврата, ₽ (не больше ${left.toLocaleString('ru-RU')})`, String(left));
    if (sum === null) return;
    const amountMinor = toMinor(sum);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) { setError('Сумма возврата: введите число больше нуля'); return; }
    const reason = window.prompt('Причина возврата (попадёт в журнал)');
    if (!reason) return;
    run(() => post(`/payments/${p.id}/refunds`, { amountMinor, reason }), 'Возврат отправлен');
  };

  const changeStatus = (to: string) => {
    const a = ACTION[to];
    let reason: string | undefined;
    if (a?.needsReason) {
      const r = window.prompt(`${a.label}: укажите причину`);
      if (r === null) return;
      reason = r || undefined;
    }
    run(() => post(`/bookings/${b.id}/status`, { status: to, reason }), `Статус: ${STATUS[to]?.label ?? to}`);
  };

  return (
    <div className="stack" style={{ maxWidth: 980 }}>
      <div className="row">
        <Link href="/bookings" className="muted">← Брони</Link>
      </div>
      <div className="row">
        <h1 style={{ margin: 0 }}>Бронь {b.number}</h1>
        <span className={`badge tone-${st.tone}`}>{st.label}</span>
        <span className="muted">{CHANNEL[b.channel_code] ?? b.channel_code}, создана {new Date(b.created_at).toLocaleString('ru-RU')}</span>
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      {can(me, 'booking.status') && b.allowed_transitions.length > 0 && (
        <div className="row">
          {b.allowed_transitions.filter((t) => ACTION[t]).map((t) => (
            <button key={t} className={`btn ${ACTION[t].cls ?? ''}`} disabled={busy} onClick={() => changeStatus(t)}>{ACTION[t].label}</button>
          ))}
        </div>
      )}

      <div className="grid2">
        <div className="card stack" style={{ gap: 6 }}>
          <h2>Гость</h2>
          <Link href={`/guests/${b.booker_guest_id}`}><b>{b.last_name} {b.first_name}</b></Link>
          <div>{b.phone_e164 ?? <span className="muted">телефон скрыт или не указан</span>}</div>
          <div>{b.email ?? <span className="muted">e-mail скрыт или не указан</span>}</div>
          <div className="muted">Взрослых: {b.adults}{b.children_ages.length > 0 && `, детей: ${b.children_ages.length} (${b.children_ages.join(', ')} лет)`}</div>
          {b.special_requests && <div>Пожелания: {b.special_requests}</div>}
        </div>
        <div className="card stack" style={{ gap: 6 }}>
          <h2>Онлайн-регистрация</h2>
          {!b.registration.guestsSubmittedAt && !b.registration.rulesAcceptedAt ? (
            <div className="muted">Гость ещё не заполнял регистрацию в приложении</div>
          ) : (
            <>
              {b.registration.guests.map((g) => (
                <div key={g.id} className="row">
                  <span>{g.lastName} {g.firstName} {g.middleName ?? ''}{g.isChild && <span className="muted"> · ребёнок</span>}</span>
                  <span className={g.document ? '' : 'muted'} style={{ marginLeft: 'auto' }}>{g.document ? `${DOC_TYPE[g.document.docType] ?? g.document.docType} ${g.document.numberMasked}` : 'нет документа'}</span>
                </div>
              ))}
              <div className={b.registration.rulesAcceptedAt ? '' : 'muted'}>
                {b.registration.rulesAcceptedAt ? `Правила приняты ${new Date(b.registration.rulesAcceptedAt).toLocaleString('ru-RU')} (версия ${b.registration.rulesVersion})` : 'Правила ещё не приняты'}
              </div>
            </>
          )}
        </div>
        <div className="card stack" style={{ gap: 6 }}>
          <h2>Проживание</h2>
          <div>{fmtDate(b.arrival)} – {fmtDate(b.departure)}, {diffDays(b.arrival, b.departure)} ноч.</div>
          <div>{stay?.type_name}, номер <b>{stay?.unit_name ?? 'не назначен'}</b></div>
        </div>
        <div className="card stack" style={{ gap: 6 }}>
          <h2>Оплата</h2>
          <div className="row"><span className="muted">Стоимость</span><b style={{ marginLeft: 'auto' }}>{rub(b.total_minor)}</b></div>
          <div className="row"><span className="muted">Оплачено</span><span style={{ marginLeft: 'auto' }}>{rub(b.paid_minor)}</span></div>
          <div className="row"><span className="muted">Остаток</span><b style={{ marginLeft: 'auto', color: b.balance_minor > 0 ? 'var(--bad)' : undefined }}>{rub(b.balance_minor)}</b></div>
          {b.deposit && (
            <div className="row">
              <span className="muted">На депозите гостя ({b.deposit.season.toLowerCase()})</span>
              <b style={{ marginLeft: 'auto' }}>{rub(b.deposit.balance_minor)}{b.deposit.balance_minor < b.deposit.amount_minor && ` из ${rub(b.deposit.amount_minor)}`}</b>
            </div>
          )}
          {b.prepayment_due_minor > 0 && <div className="row"><span className="muted">Предоплата по тарифу</span><span style={{ marginLeft: 'auto' }}>{rub(b.prepayment_due_minor)}</span></div>}
          {payments.length > 0 && (
            <table className="list" style={{ border: 0, marginTop: 6 }}>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td style={{ padding: '6px 0' }}>
                      {rub(p.amount_minor)} <span className={`badge tone-${PAY_STATUS[p.status]?.tone ?? 'muted'}`}>{PAY_STATUS[p.status]?.label ?? p.status}</span>
                      {p.refunded_minor > 0 && <div className="muted" style={{ fontSize: 12 }}>возвращено {rub(p.refunded_minor)}</div>}
                    </td>
                    <td style={{ padding: '6px 0', textAlign: 'right' }}>
                      {p.status === 'succeeded' && p.refunded_minor < p.amount_minor && can(me, 'payment.refund') && (
                        <button className="btn" disabled={busy} onClick={() => refund(p)}>Вернуть</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editable && (
        <div className="grid2">
          <div className="card stack" style={{ gap: 8 }}>
            <h2>Перенести в другой номер</h2>
            <div className="row">
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Номер">
                <option value="">Выберите номер</option>
                {sameType.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button className="btn" disabled={!moveTo || busy} onClick={() => run(() => patch(`/bookings/${b.id}/unit`, { unitId: moveTo }), 'Бронь перенесена')}>Перенести</button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>Занятый номер система не даст выбрать: перенос будет отклонён.</div>
          </div>
          <div className="card stack" style={{ gap: 8 }}>
            <h2>Изменить даты</h2>
            <div className="row">
              <input type="date" value={dates.arrival} onChange={(e) => setDates({ ...dates, arrival: e.target.value })} aria-label="Заезд" />
              <input type="date" value={dates.departure} onChange={(e) => setDates({ ...dates, departure: e.target.value })} aria-label="Выезд" />
              <button
                className="btn"
                disabled={busy || (dates.arrival === b.arrival && dates.departure === b.departure)}
                onClick={() => run(() => patch(`/bookings/${b.id}/dates`, dates), 'Даты изменены')}
              >Сохранить</button>
            </div>
            <div className="muted" style={{ fontSize: 12 }}>Цена уже оплаченных ночей сохраняется, новые ночи считаются по текущему тарифу.</div>
          </div>
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <h2>Цена по ночам</h2>
          <table className="list" style={{ border: 0 }}>
            <tbody>
              {b.nights.map((n) => <tr key={n.night}><td>{fmtDate(n.night, { weekday: 'short', day: '2-digit', month: '2-digit' })}</td><td className="num">{rub(n.amount_minor)}</td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>История</h2>
          <table className="list" style={{ border: 0 }}>
            <tbody>
              {b.history.map((h) => (
                <tr key={h.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(h.changed_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{h.from_status ? `${STATUS[h.from_status]?.label ?? h.from_status} → ` : ''}{STATUS[h.to_status]?.label ?? h.to_status}{h.reason && <div className="muted">{h.reason}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
