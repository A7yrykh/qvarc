'use client';
import { useState } from 'react';
import { DEMO, asset, errorText, post } from '@/lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState(DEMO ? 'demo@kvarc.ru' : '');
  const [password, setPassword] = useState(DEMO ? 'demo' : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/auth/login', { email, password });
      window.location.href = asset('/calendar');
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form onSubmit={submit} className="card stack" style={{ width: '100%', maxWidth: 360 }}>
        <img src={asset('/brand/kvarc-logo.svg')} alt="Кварц, место отдыха" style={{ height: 52, width: 'auto' }} />
        <div className="muted">{DEMO ? 'Демо-версия админки: данные выдуманы, вход без пароля' : 'Вход для сотрудников'}</div>
        {error && <div className="error">{error}</div>}
        <label>Почта<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Пароль<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="btn primary" disabled={busy}>{busy ? 'Входим…' : DEMO ? 'Войти в демо' : 'Войти'}</button>
      </form>
    </main>
  );
}
