'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CHANNEL, STATUS, errorText, fmtDate, get, rub } from '@/lib/api';
import { can, useMe } from '@/components/Shell';

interface Row {
  id: string; number: string; status: string; payment_state: string; arrival: string; departure: string;
  total_minor: number; created_at: string; last_name: string; first_name: string; channel_code: string;
}

export default function BookingsPage() {
  const me = useMe();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [arrivalFrom, setArrivalFrom] = useState('');
  const [arrivalTo, setArrivalTo] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (status) p.set('status', status);
    if (arrivalFrom) p.set('arrivalFrom', arrivalFrom);
    if (arrivalTo) p.set('arrivalTo', arrivalTo);
    const t = setTimeout(() => get<Row[]>(`/bookings?${p}`).then((r) => { setRows(r); setError(''); }, (e) => setError(errorText(e))), 250);
    return () => clearTimeout(t);
  }, [q, status, arrivalFrom, arrivalTo]);

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0, marginRight: 'auto' }}>Брони</h1>
        {can(me, 'booking.write') && <Link className="btn primary" href="/bookings/new">Новая бронь</Link>}
      </div>
      <div className="row">
        <input placeholder="Номер брони или фамилия" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус">
          <option value="">Все статусы</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="row" style={{ display: 'flex' }}>Заезд с <input type="date" value={arrivalFrom} onChange={(e) => setArrivalFrom(e.target.value)} /></label>
        <label className="row" style={{ display: 'flex' }}>по <input type="date" value={arrivalTo} onChange={(e) => setArrivalTo(e.target.value)} /></label>
      </div>
      {error && <div className="error">{error}</div>}
      {rows && (rows.length === 0 ? <div className="muted">Ничего не найдено</div> : (
        <table className="list">
          <thead>
            <tr><th>Номер</th><th>Гость</th><th>Заезд</th><th>Выезд</th><th>Статус</th><th>Источник</th><th className="num">Сумма</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, tone: 'muted' };
              return (
                <tr key={r.id} className="click" onClick={() => router.push(`/bookings/${r.id}`)}>
                  <td><Link href={`/bookings/${r.id}`}>{r.number}</Link></td>
                  <td>{r.last_name} {r.first_name}</td>
                  <td>{fmtDate(r.arrival)}</td>
                  <td>{fmtDate(r.departure)}</td>
                  <td><span className={`badge tone-${st.tone}`}>{st.label}</span></td>
                  <td>{CHANNEL[r.channel_code] ?? r.channel_code}</td>
                  <td className="num">{rub(r.total_minor)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
    </div>
  );
}
