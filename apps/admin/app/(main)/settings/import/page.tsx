'use client';
import { useState } from 'react';
import { errorText, post, rub } from '@/lib/api';

interface Result {
  period?: { from: string; to: string };
  rates?: { plan: string; created: boolean; rules: number }[];
  bookings?: { created: number; skipped: number; cancelled: number; upcoming: number; guests: number; paymentsMinor: number; unassigned: string[] };
}

/** Файл → base64 без префикса data:… */
function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function ImportPage() {
  const [rates, setRates] = useState<File | null>(null);
  const [bookings, setBookings] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState<Result | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setRes(null);
    setBusy(true);
    try {
      setRes(await post<Result>('/imports/travelline', {
        ratePlans: rates ? await base64(rates) : undefined,
        bookings: bookings ? await base64(bookings) : undefined,
      }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const fmt = (d: string) => d.split('-').reverse().join('.');
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <h1 style={{ margin: 0 }}>Перенос из TravelLine</h1>
      <div className="muted">
        Выгрузки из личного кабинета TravelLine в формате xlsx. Сначала загружаются цены, затем брони.
        Повторная загрузка безопасна: уже перенесённые брони пропускаются, цены TravelLine заменяются новыми, правила, заведённые здесь вручную, не трогаются.
      </div>
      <form className="card stack" onSubmit={submit}>
        <label>Шахматка тарифов (rate_plans…xlsx)<input type="file" accept=".xlsx" onChange={(e) => setRates(e.target.files?.[0] ?? null)} /></label>
        <label>Отчёт по бронированиям (полный, xlsx)<input type="file" accept=".xlsx" onChange={(e) => setBookings(e.target.files?.[0] ?? null)} /></label>
        {error && <div className="error">{error}</div>}
        <div className="row"><button className="btn primary" disabled={busy || (!rates && !bookings)}>{busy ? 'Загружаю… (до минуты)' : 'Загрузить'}</button></div>
      </form>
      {res && (
        <div className="card stack">
          {res.rates && (
            <div>
              <b>Цены{res.period ? ` за ${fmt(res.period.from)} – ${fmt(res.period.to)}` : ''}</b>
              {res.rates.map((p) => <div key={p.plan}>{p.plan}: {p.created ? 'тариф создан' : 'тариф уже был'}, правил {p.rules}</div>)}
            </div>
          )}
          {res.bookings && (
            <div>
              <b>Брони</b>
              <div>Перенесено: {res.bookings.created} (отменённых {res.bookings.cancelled}, текущих и предстоящих {res.bookings.upcoming}), уже были: {res.bookings.skipped}</div>
              <div>Новых гостей: {res.bookings.guests}. Внесённые предоплаты: {rub(res.bookings.paymentsMinor)}</div>
              {res.bookings.unassigned.length > 0 && (
                <div className="muted">Без номера (нет свободного в категории), разместите в шахматке: {res.bookings.unassigned.join('; ')}</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
