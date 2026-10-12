'use client';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { PROPERTY, api, cancellationText, diffDays, errorText, fmtDate, nightsWord, rub, type Tier } from '@/lib/api';

interface Manage {
  number: string; status: string; paymentState: string; propertyName: string; arrival: string; departure: string;
  checkInTime: string; checkOutTime: string; adults: number; childrenAges: number[]; guestName: string; accommodation: string;
  ratePlan: string | null; cancellationPolicy: Tier[] | null; totalMinor: number; prepaymentDueMinor: number; paidMinor: number;
  holdExpiresAt: string | null; canPay: boolean; cancellation: { penaltyMinor: number; refundMinor: number } | null;
}

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  pending_payment: { label: 'Ожидает оплаты', bg: 'var(--warn-bg)', fg: 'var(--warn)' },
  pending_confirmation: { label: 'Ожидает подтверждения', bg: 'var(--warn-bg)', fg: 'var(--warn)' },
  confirmed: { label: 'Подтверждена', bg: 'var(--ok-bg)', fg: 'var(--ok)' },
  checked_in: { label: 'Вы заселены', bg: 'var(--ok-bg)', fg: 'var(--ok)' },
  checked_out: { label: 'Проживание завершено', bg: '#eee', fg: 'var(--muted)' },
  cancelled: { label: 'Отменена', bg: 'var(--bad-bg)', fg: 'var(--bad)' },
  expired: { label: 'Время оплаты истекло', bg: 'var(--bad-bg)', fg: 'var(--bad)' },
  no_show: { label: 'Неявка', bg: 'var(--bad-bg)', fg: 'var(--bad)' },
};

function useCountdown(until: string | null) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!until) { setLeft(null); return; }
    const tick = () => setLeft(Math.max(0, Math.floor((Date.parse(until) - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  return left;
}

export default function ManagePage() {
  const { token } = useParams<{ token: string }>();
  const [b, setB] = useState<Manage | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(() => api<Manage>('GET', `/${PROPERTY}/bookings/${token}`).then((x) => { setB(x); setError(''); }, (e) => setError(errorText(e))), [token]);
  useEffect(() => { load(); }, [load]);
  // Пока бронь ждёт оплату, статус обновляется сам: уведомление банка может прийти через несколько секунд
  useEffect(() => {
    if (b?.status !== 'pending_payment') return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [b?.status, load]);
  const left = useCountdown(b?.status === 'pending_payment' ? b.holdExpiresAt : null);

  const pay = async () => {
    setBusy(true); setError('');
    try {
      const r = await api<{ confirmationUrl: string }>('POST', `/${PROPERTY}/bookings/${token}/pay`, { attemptKey: crypto.randomUUID() });
      window.location.href = r.confirmationUrl;
    } catch (e) { setError(errorText(e)); setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true); setError('');
    try { setB(await api<Manage>('POST', `/${PROPERTY}/bookings/${token}/cancel`)); setConfirmCancel(false); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  if (!b) return error ? <div className="stack"><div className="brand">КВАРЦ</div><div className="error">{error}</div></div> : <div className="muted">Загрузка…</div>;
  const st = STATUS[b.status] ?? { label: b.status, bg: '#eee', fg: 'var(--muted)' };
  const nights = diffDays(b.arrival, b.departure);
  const balance = b.totalMinor - b.paidMinor;

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <div className="brand">КВАРЦ</div>
      <div className="row">
        <h1 style={{ margin: 0 }}>Бронь {b.number}</h1>
        <span className="status" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
      </div>
      {error && <div className="error">{error}</div>}

      {b.status === 'pending_payment' && (
        <div className="warn stack" style={{ gap: 8 }}>
          {b.canPay ? (
            <>
              <div>Номер закреплён за вами{left !== null && left > 0 ? ` ещё ${Math.floor(left / 60)} мин ${String(left % 60).padStart(2, '0')} с` : ''}. Внесите предоплату {rub(b.prepaymentDueMinor - b.paidMinor)}, чтобы подтвердить бронь.</div>
              <div className="small">Если вы уже оплатили, статус обновится сам в течение минуты.</div>
              <div><button className="btn primary" disabled={busy} onClick={pay}>Оплатить {rub(b.prepaymentDueMinor - b.paidMinor)}</button></div>
            </>
          ) : (
            <div>Проверяем оплату…</div>
          )}
        </div>
      )}
      {b.status === 'confirmed' && <div className="notice">Бронь подтверждена. Ждём вас {fmtDate(b.arrival)} с {b.checkInTime}.</div>}
      {b.status === 'expired' && <div className="error">Время на оплату истекло, номер освобождён. Если деньги списались, они вернутся автоматически. Вы можете оформить бронь заново.</div>}
      {b.status === 'cancelled' && <div className="error">Бронь отменена.{b.paidMinor > 0 ? ` По условиям тарифа удержано ${rub(b.paidMinor)}.` : ''} Возврат, если он положен, приходит на карту в течение нескольких дней.</div>}

      <div className="card summary">
        <h2>{b.accommodation}</h2>
        <div className="muted">{b.ratePlan}</div>
        <div className="line"><span>Гость</span><span>{b.guestName}</span></div>
        <div className="line"><span>Заезд</span><span>{fmtDate(b.arrival, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}, с {b.checkInTime}</span></div>
        <div className="line"><span>Выезд</span><span>{fmtDate(b.departure, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}, до {b.checkOutTime}</span></div>
        <div className="line"><span>Гости</span><span>{b.adults} взр.{b.childrenAges.length > 0 && `, ${b.childrenAges.length} дет.`}</span></div>
        <div className="line"><span>Стоимость за {nightsWord(nights)}</span><b>{rub(b.totalMinor)}</b></div>
        <div className="line"><span>Оплачено</span><span>{rub(b.paidMinor)}</span></div>
        {['confirmed', 'checked_in'].includes(b.status) && balance > 0 && <div className="line"><span>К оплате при заезде</span><b>{rub(balance)}</b></div>}
        <div className="small muted">{cancellationText(b.cancellationPolicy)}</div>
      </div>

      {b.cancellation && (
        <div className="card stack" style={{ gap: 8 }}>
          {!confirmCancel ? (
            <div><button className="btn" onClick={() => setConfirmCancel(true)}>Отменить бронь</button></div>
          ) : (
            <>
              <div>
                {b.cancellation.penaltyMinor === 0 ? 'Отмена бесплатная.' : `По условиям тарифа удерживается ${rub(b.cancellation.penaltyMinor)}.`}{' '}
                {b.cancellation.refundMinor > 0 ? `Вернём ${rub(b.cancellation.refundMinor)} на карту, с которой была оплата.` : b.paidMinor > 0 ? 'Оплата не возвращается.' : ''}
              </div>
              <div className="row">
                <button className="btn primary" disabled={busy} onClick={cancel}>Да, отменить</button>
                <button className="btn" onClick={() => setConfirmCancel(false)}>Не отменять</button>
              </div>
            </>
          )}
        </div>
      )}
      <div className="small muted">Сохраните эту страницу: по ссылке можно в любой момент посмотреть бронь, оплатить или отменить её.</div>
    </div>
  );
}
