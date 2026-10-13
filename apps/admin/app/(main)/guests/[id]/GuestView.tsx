'use client';
import Link from 'next/link';
import { useRouteId } from '@/lib/route';
import { useCallback, useEffect, useState } from 'react';
import { STATUS, errorText, fmtDate, get, put, rub } from '@/lib/api';
import { can, useMe } from '@/components/Shell';

interface Guest {
  id: string; last_name: string; first_name: string; middle_name: string | null; phone_e164: string | null; email: string | null; tags: string[];
  bookings: { id: string; number: string; status: string; arrival: string; departure: string; total_minor: number }[];
  consents: { id: string; kind: string; granted_at: string; revoked_at: string | null }[];
  notes: { id: string; body: string; created_at: string }[];
  total_spent_minor: number;
}

export default function GuestView() {
  const id = useRouteId();
  const me = useMe();
  const [g, setG] = useState<Guest | null>(null);
  const [f, setF] = useState<{ lastName: string; firstName: string; middleName: string; phone: string; email: string; tags: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => get<Guest>(`/guests/${id}`).then(setG, (e) => setError(errorText(e))), [id]);
  useEffect(() => { load(); }, [load]);
  // Без права на контакты форма отправила бы пустые телефон и e-mail, поэтому редактирование только с этим правом
  const editable = can(me, 'guest.write') && can(me, 'guest.contacts.read');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f) return;
    setError(''); setNotice('');
    try {
      await put(`/guests/${id}`, {
        lastName: f.lastName, firstName: f.firstName, middleName: f.middleName || null, phone: f.phone || null, email: f.email || null,
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      setNotice('Сохранено'); setF(null); load();
    } catch (err) { setError(errorText(err)); }
  };

  if (!g) return error ? <div className="error">{error}</div> : <div className="muted">Загрузка…</div>;
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <Link href="/guests" className="muted">← Гости</Link>
      <div className="row">
        <h1 style={{ margin: 0, marginRight: 'auto' }}>{g.last_name} {g.first_name} {g.middle_name ?? ''}</h1>
        {editable && !f && (
          <button className="btn" onClick={() => setF({ lastName: g.last_name, firstName: g.first_name, middleName: g.middle_name ?? '', phone: g.phone_e164 ?? '', email: g.email ?? '', tags: g.tags.join(', ') })}>Изменить</button>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      {f ? (
        <form className="card stack" onSubmit={save}>
          <div className="grid2">
            <label>Фамилия<input required value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} /></label>
            <label>Имя<input required value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} /></label>
            <label>Отчество<input value={f.middleName} onChange={(e) => setF({ ...f, middleName: e.target.value })} /></label>
            <label>Телефон<input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/[\s()-]/g, '') })} /></label>
            <label>E-mail<input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
            <label>Метки через запятую<input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></label>
          </div>
          <div className="row"><button className="btn primary">Сохранить</button><button type="button" className="btn" onClick={() => setF(null)}>Отмена</button></div>
        </form>
      ) : (
        <div className="card grid2">
          <div><div className="muted">Телефон</div>{g.phone_e164 ?? <span className="muted">скрыт или не указан</span>}</div>
          <div><div className="muted">E-mail</div>{g.email ?? <span className="muted">скрыт или не указан</span>}</div>
          <div><div className="muted">Проживания</div>{g.bookings.filter((b) => b.status === 'checked_out').length}, на сумму {rub(g.total_spent_minor)}</div>
          <div><div className="muted">Метки</div>{g.tags.join(', ') || '—'}</div>
        </div>
      )}
      <h2>Брони</h2>
      <table className="list">
        <thead><tr><th>Номер</th><th>Даты</th><th>Статус</th><th className="num">Сумма</th></tr></thead>
        <tbody>
          {g.bookings.map((b) => (
            <tr key={b.id}>
              <td><Link href={`/bookings/${b.id}`}>{b.number}</Link></td>
              <td>{fmtDate(b.arrival)} – {fmtDate(b.departure)}</td>
              <td><span className={`badge tone-${STATUS[b.status]?.tone ?? 'muted'}`}>{STATUS[b.status]?.label ?? b.status}</span></td>
              <td className="num">{rub(b.total_minor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>Согласия</h2>
      {g.consents.length === 0 ? <div className="muted">Нет записанных согласий</div> : (
        <ul>{g.consents.map((c) => <li key={c.id}>{c.kind}: дано {new Date(c.granted_at).toLocaleDateString('ru-RU')}{c.revoked_at && `, отозвано ${new Date(c.revoked_at).toLocaleDateString('ru-RU')}`}</li>)}</ul>
      )}
    </div>
  );
}
