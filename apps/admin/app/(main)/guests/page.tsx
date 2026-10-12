'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorText, get } from '@/lib/api';

interface Row { id: string; last_name: string; first_name: string; middle_name: string | null; phone_e164: string | null; email: string | null; tags: string[] }

export default function GuestsPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const t = setTimeout(() => get<Row[]>(`/guests?q=${encodeURIComponent(q.trim())}`).then(setRows, (e) => setError(errorText(e))), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="stack">
      <h1>Гости</h1>
      <input placeholder="Фамилия, телефон или e-mail" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
      {error && <div className="error">{error}</div>}
      {rows && (rows.length === 0 ? <div className="muted">Ничего не найдено</div> : (
        <table className="list">
          <thead><tr><th>Гость</th><th>Телефон</th><th>E-mail</th><th>Метки</th></tr></thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} className="click" onClick={() => router.push(`/guests/${g.id}`)}>
                <td>{g.last_name} {g.first_name} {g.middle_name ?? ''}</td>
                <td>{g.phone_e164 ?? <span className="muted">скрыт</span>}</td>
                <td>{g.email ?? ''}</td>
                <td>{g.tags.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}
