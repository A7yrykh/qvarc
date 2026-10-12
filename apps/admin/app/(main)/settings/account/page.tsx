'use client';
import { useState } from 'react';
import { errorText, post } from '@/lib/api';
import { useMe } from '@/components/Shell';

export default function AccountPage() {
  const me = useMe();
  const [f, setF] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setDone(false);
    if (f.next !== f.repeat) return setError('Новый пароль и повтор не совпадают');
    setBusy(true);
    try {
      await post('/auth/password', { current: f.current, next: f.next });
      setF({ current: '', next: '', repeat: '' });
      setDone(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 420 }}>
      <h1 style={{ margin: 0 }}>Мой пароль</h1>
      <div className="muted">{me?.fullName} · {me?.email}</div>
      {done && <div className="notice">Пароль изменён. На других устройствах нужно будет войти заново.</div>}
      <form className="card stack" onSubmit={submit}>
        <label>Текущий пароль<input type="password" required autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></label>
        <label>Новый пароль (не короче 12 символов)<input type="password" required minLength={12} autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></label>
        <label>Новый пароль ещё раз<input type="password" required minLength={12} autoComplete="new-password" value={f.repeat} onChange={(e) => setF({ ...f, repeat: e.target.value })} /></label>
        {error && <div className="error">{error}</div>}
        <div className="row"><button className="btn primary" disabled={busy}>{busy ? 'Сохраняю…' : 'Сменить пароль'}</button></div>
      </form>
    </div>
  );
}
