'use client';
import { useState } from 'react';
import { errorText, post } from '@/lib/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/auth/login', { email, password });
      window.location.href = '/calendar';
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form onSubmit={submit} className="card stack" style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ fontWeight: 700, letterSpacing: '0.24em', fontSize: 20 }}>QVARC</div>
        <div className="muted">Вход для сотрудников</div>
        {error && <div className="error">{error}</div>}
        <label>Почта<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Пароль<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="btn primary" disabled={busy}>{busy ? 'Входим…' : 'Войти'}</button>
      </form>
    </main>
  );
}
