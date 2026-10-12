'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CHANNEL, STATUS, WEEKDAYS, addDays, sortUnits, diffDays, errorText, fmtDate, get, isoWeekday, rub, todayLocal } from '@/lib/api';
import { can, useMe } from '@/components/Shell';

interface CalUnit { id: string; name: string; is_active: boolean; type_id: string; type_name: string }
interface CalStay {
  stay_id: string; unit_id: string | null; stay: string; booking_id: string; number: string; status: string;
  total_minor: number; balance_minor: number; adults: number; children_ages: number[]; channel_code: string; last_name: string; first_name: string;
}
interface CalBlock { id: string; unit_id: string | null; accommodation_type_id: string | null; period: string; reason: string }
interface Cal { from: string; to: string; units: CalUnit[]; stays: CalStay[]; blocks: CalBlock[] }

const DAYS = 28;
const BLOCK_REASON: Record<string, string> = { out_of_order: 'Ремонт', owner_use: 'Для владельца', stop_sale: 'Стоп-продажа' };

/** '[2026-10-12,2026-10-15)' → ['2026-10-12', '2026-10-15'] */
const range = (r: string) => r.slice(1, -1).split(',') as [string, string];

export default function CalendarPage() {
  const me = useMe();
  const router = useRouter();
  const [from, setFrom] = useState(() => addDays(todayLocal(), -2));
  const [data, setData] = useState<Cal | null>(null);
  const [error, setError] = useState('');
  const to = addDays(from, DAYS);
  const today = todayLocal();

  const load = useCallback(() => {
    get<Cal>(`/calendar?from=${from}&to=${to}`).then(setData, (e) => setError(errorText(e)));
  }, [from, to]);
  useEffect(load, [load]);

  const days = useMemo(() => Array.from({ length: DAYS }, (_, i) => addDays(from, i)), [from]);

  // Строки сетки: заголовок, затем по категории строка-подзаголовок и строки номеров
  const layout = useMemo(() => {
    const rows: ({ kind: 'type'; name: string } | { kind: 'unit'; unit: CalUnit })[] = [];
    const rowOfUnit = new Map<string, number>();
    const unitsOfType = new Map<string, string[]>();
    let last = '';
    // Внутри категории номера по порядку 1, 2 … 10 (API отдаёт категории уже по порядку)
    const sorted = sortUnits(data?.units ?? [], (u) => u.type_id);
    for (const u of sorted) {
      if (u.type_id !== last) { rows.push({ kind: 'type', name: u.type_name }); last = u.type_id; }
      rows.push({ kind: 'unit', unit: u });
      rowOfUnit.set(u.id, rows.length + 1); // +1 за строку дат
      unitsOfType.set(u.type_id, [...(unitsOfType.get(u.type_id) ?? []), u.id]);
    }
    return { rows, rowOfUnit, unitsOfType };
  }, [data]);

  /** Колонки сетки для отрезка [a,b): заезд и выезд рисуются половинками дня, как в шахматке TravelLine. */
  const span = (a: string, b: string) => {
    const start = Math.max(0, diffDays(from, a));
    const end = Math.min(DAYS, diffDays(from, b));
    if (end <= 0 || start >= DAYS || end <= start) return null;
    return { gridColumn: `${start + 2} / ${end + 2}` };
  };

  const unassigned = data?.stays.filter((s) => !s.unit_id) ?? [];

  return (
    <div className="stack">
      <div className="row">
        <h1 style={{ margin: 0, marginRight: 'auto' }}>Шахматка</h1>
        <button className="btn" onClick={() => setFrom(addDays(from, -14))}>← 2 недели</button>
        <button className="btn" onClick={() => setFrom(addDays(today, -2))}>Сегодня</button>
        <button className="btn" onClick={() => setFrom(addDays(from, 14))}>2 недели →</button>
        <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="Начало периода" />
        {can(me, 'booking.write') && <Link className="btn primary" href="/bookings/new">Новая бронь</Link>}
      </div>
      {error && <div className="error">{error}</div>}
      {unassigned.length > 0 && (
        <div className="notice" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>
          Брони без номера: {unassigned.map((s) => <Link key={s.stay_id} href={`/bookings/${s.booking_id}`} style={{ marginRight: 8 }}>{s.number} {s.last_name}</Link>)}
        </div>
      )}
      {data && (
        <div className="chess-wrap">
          <div className="chess" style={{ gridTemplateColumns: `170px repeat(${DAYS}, var(--cell))`, gridAutoRows: 'minmax(28px, auto)' }}>
            <div className="head unit" style={{ gridRow: 1, gridColumn: 1, zIndex: 4, height: 'auto' }} />
            {days.map((d, i) => {
              const wd = isoWeekday(d);
              return (
                <div key={d} className={`head${wd >= 6 ? ' weekend' : ''}${d === today ? ' today' : ''}`} style={{ gridRow: 1, gridColumn: i + 2 }}>
                  <div>{WEEKDAYS[wd - 1]}</div>
                  <div style={{ fontSize: 13 }}>{fmtDate(d, { day: 'numeric' })}</div>
                  {(i === 0 || d.endsWith('-01')) && <div>{fmtDate(d, { month: 'short' })}</div>}
                </div>
              );
            })}
            {layout.rows.map((r, idx) =>
              r.kind === 'type' ? (
                <div key={`t${idx}`} className="type" style={{ gridRow: idx + 2 }}>{r.name}</div>
              ) : (
                [
                  <div key={r.unit.id} className="unit" style={{ gridRow: idx + 2, gridColumn: 1 }}>
                    {r.unit.name}{!r.unit.is_active && <span className="muted">&nbsp;(выкл.)</span>}
                  </div>,
                  ...days.map((d, i) => (
                    <div
                      key={`${r.unit.id}${d}`}
                      className={`cell${isoWeekday(d) >= 6 ? ' weekend' : ''}`}
                      style={{ gridRow: idx + 2, gridColumn: i + 2 }}
                      title={`${r.unit.name}, ${fmtDate(d)}`}
                      onClick={() => can(me, 'booking.write') && router.push(`/bookings/new?unitId=${r.unit.id}&typeId=${r.unit.type_id}&arrival=${d}`)}
                    />
                  )),
                ]
              ),
            )}
            {data.blocks.flatMap((b) => {
              const [a, z] = range(b.period);
              const sp = span(a, z);
              if (!sp) return [];
              const units = b.unit_id ? [b.unit_id] : layout.unitsOfType.get(b.accommodation_type_id ?? '') ?? [];
              return units.map((u) => (
                <div key={`${b.id}${u}`} className="block" style={{ ...sp, gridRow: layout.rowOfUnit.get(u) }}>
                  {BLOCK_REASON[b.reason] ?? b.reason}
                </div>
              ));
            })}
            {data.stays.map((s) => {
              if (!s.unit_id || !layout.rowOfUnit.has(s.unit_id)) return null;
              const [a, z] = range(s.stay);
              const sp = span(a, z);
              if (!sp) return null;
              const st = STATUS[s.status] ?? { label: s.status, tone: 'muted' };
              const guests = s.adults + (s.children_ages?.length ?? 0);
              return (
                <Link
                  key={s.stay_id}
                  href={`/bookings/${s.booking_id}`}
                  className={`bar tone-${st.tone}`}
                  style={{ ...sp, gridRow: layout.rowOfUnit.get(s.unit_id) }}
                  title={`${s.number} · ${s.last_name} ${s.first_name} · ${fmtDate(a)}–${fmtDate(z)} · ${guests} гост. · ${st.label} · ${CHANNEL[s.channel_code] ?? s.channel_code} · ${rub(s.total_minor)}${s.balance_minor > 0 ? `, долг ${rub(s.balance_minor)}` : ''}`}
                >
                  <b>{s.last_name}</b>
                  <span>{guests}</span>
                  {s.balance_minor > 0 && <span className="debt">{rub(s.balance_minor)}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      )}
      <div className="row muted" style={{ fontSize: 12 }}>
        {Object.entries(STATUS).filter(([k]) => ['pending_payment', 'confirmed', 'checked_in', 'checked_out'].includes(k)).map(([k, v]) => (
          <span key={k} className={`badge tone-${v.tone}`}>{v.label}</span>
        ))}
        <span>Сумма справа на брони: неоплаченный остаток. Клик по свободной клетке создаёт бронь.</span>
      </div>
    </div>
  );
}
