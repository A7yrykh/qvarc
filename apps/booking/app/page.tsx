'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { MEAL, OFFER_URL, PRIVACY_URL, RULES_URL, PROPERTY, addDays, api, cancellationText, depositText, diffDays, errorText, fmtDate, nightsWord, rub, type DepositRule, type Tier } from '@/lib/api';

interface Info { name: string; checkInTime: string; checkOutTime: string; today: string; holdMinutes: number }
interface Offer {
  ratePlan: { id: string; name: string; mealPlan: string; isRefundable: boolean };
  bookable: boolean; restrictions: { code: string; value?: number; night?: string }[];
  nights: { night: string; amountMinor: number }[]; totalMinor: number; prepaymentDueMinor: number; cancellationPolicy: Tier[] | null; depositRule: DepositRule | null;
}
interface Room {
  accommodationType: { id: string; name: string; kind: string; areaM2: number | null; maxOccupancy: number; amenities: string[]; photos: { url: string; alt?: string }[]; description: string | null };
  soldOut: boolean; lastOne: boolean; offers: Offer[];
}
interface Search { arrival: string; departure: string; adults: number; children: number[] }

/** Почему тариф нельзя забронировать на эти даты — для гостя */
/** Фото категории: большое и ряд миниатюр для переключения. Без фото — фирменная иллюстрация. */
function Photos({ photos, name }: { photos: { url: string; alt?: string }[]; name: string }) {
  const [i, setI] = useState(0);
  if (photos.length === 0) return <div className="photo"><img className="ill" src="/brand/lake.png" alt="" /></div>;
  const cur = photos[Math.min(i, photos.length - 1)];
  return (
    <div className="gallery">
      <div className="photo"><img src={cur.url} alt={cur.alt || name} loading="lazy" /></div>
      {photos.length > 1 && (
        <div className="thumbs">
          {photos.slice(0, 6).map((p, j) => (
            <button key={p.url} type="button" className={j === i ? 'on' : ''} onClick={() => setI(j)} aria-label={`Фото ${j + 1} из ${photos.length}`}>
              <img src={p.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function whyNot(o: Offer) {
  const r = o.restrictions[0];
  if (!r) return 'Нет мест';
  switch (r.code) {
    case 'min_stay': return `Минимальный срок проживания на эти даты — ${nightsWord(r.value ?? 2)}`;
    case 'max_stay': return `Максимальный срок — ${nightsWord(r.value ?? 1)}`;
    case 'closed_to_arrival': return 'Заезд в этот день недоступен';
    case 'closed_to_departure': return 'Выезд в этот день недоступен';
    case 'min_lead_days': return `Бронирование не позднее чем за ${r.value} дн. до заезда`;
    case 'arrival_in_past': return 'Дата заезда уже прошла';
    default: return 'Недоступно на эти даты';
  }
}

export default function Page() {
  return <Suspense fallback={null}><Booking /></Suspense>;
}

function Booking() {
  const sp = useSearchParams();
  const router = useRouter();
  const [info, setInfo] = useState<Info | null>(null);
  const [form, setForm] = useState<Search | null>(null);
  const [searched, setSearched] = useState<Search | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [chosen, setChosen] = useState<{ room: Room; offer: Offer } | null>(null);

  useEffect(() => {
    api<Info>('GET', `/${PROPERTY}/info`).then((i) => {
      setInfo(i);
      // Параметры из ссылки с сайта: ?arrival=2027-07-01&departure=2027-07-03&adults=2&children=5,10
      const arrival = sp.get('arrival') && sp.get('arrival')! >= i.today ? sp.get('arrival')! : addDays(i.today, 1);
      const departure = sp.get('departure') && sp.get('departure')! > arrival ? sp.get('departure')! : addDays(arrival, 1);
      const f = {
        arrival, departure,
        adults: Math.min(10, Math.max(1, Number(sp.get('adults')) || 2)),
        children: (sp.get('children') ?? '').split(',').filter(Boolean).map(Number).filter((a) => a >= 0 && a <= 17).slice(0, 6),
      };
      setForm(f);
      if (sp.get('arrival')) search(f);
    }, (e) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = async (f: Search) => {
    setBusy(true); setError(''); setChosen(null);
    try {
      const q = new URLSearchParams({ arrival: f.arrival, departure: f.departure, adults: String(f.adults) });
      if (f.children.length) q.set('children', f.children.join(','));
      setRooms(await api<Room[]>('GET', `/${PROPERTY}/offers?${q}`));
      setSearched(f);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  if (!form || !info) return error ? <div className="error">{error}</div> : <div className="muted">Загрузка…</div>;
  const nights = searched ? diffDays(searched.arrival, searched.departure) : 0;

  if (chosen && searched) {
    return <Checkout info={info} search={searched} room={chosen.room} offer={chosen.offer} onBack={() => setChosen(null)} onDone={(url) => router.push(url)} />;
  }

  return (
    <div className="stack">
      <div>
        <h1>Бронирование на Увильдах</h1>
        <div className="muted small">Заезд с {info.checkInTime}, выезд до {info.checkOutTime}. Цены указаны за весь номер.</div>
      </div>
      <form className="card search" onSubmit={(e) => { e.preventDefault(); search(form); }}>
        <label className="f">Заезд
          <input type="date" required min={info.today} value={form.arrival}
            onChange={(e) => e.target.value && setForm({ ...form, arrival: e.target.value, departure: e.target.value >= form.departure ? addDays(e.target.value, 1) : form.departure })} />
        </label>
        <label className="f">Выезд
          <input type="date" required min={addDays(form.arrival, 1)} value={form.departure} onChange={(e) => e.target.value && setForm({ ...form, departure: e.target.value })} />
        </label>
        <label className="f">Взрослых
          <select value={form.adults} onChange={(e) => setForm({ ...form, adults: Number(e.target.value) })}>
            {Array.from({ length: 10 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}
          </select>
        </label>
        <div className="f kidsf" style={{ display: 'grid', gap: 4 }}>
          <span className="muted small">Дети и их возраст</span>
          <div className="kids">
            {form.children.map((a, i) => (
              <select key={i} value={a} aria-label={`Возраст ребёнка ${i + 1}`} onChange={(e) => setForm({ ...form, children: form.children.map((x, j) => (j === i ? Number(e.target.value) : x)) })}>
                {Array.from({ length: 18 }, (_, y) => <option key={y} value={y}>{y === 0 ? 'до 1 года' : `${y} лет`}</option>)}
              </select>
            ))}
            {form.children.length < 6 && <button type="button" className="btn" onClick={() => setForm({ ...form, children: [...form.children, 7] })}>+ ребёнок</button>}
            {form.children.length > 0 && <button type="button" className="btn" aria-label="Убрать ребёнка" onClick={() => setForm({ ...form, children: form.children.slice(0, -1) })}>−</button>}
          </div>
        </div>
        <button className="btn primary go" disabled={busy}>{busy ? 'Ищем…' : 'Найти'}</button>
      </form>

      {error && <div className="error">{error}</div>}

      {rooms && searched && (
        <div className="stack">
          <div className="muted">
            {fmtDate(searched.arrival)} – {fmtDate(searched.departure, { day: 'numeric', month: 'long', year: 'numeric' })}, {nightsWord(nights)},{' '}
            {searched.adults} взр.{searched.children.length > 0 && `, ${searched.children.length} дет.`}
          </div>
          {rooms.length === 0 && <div className="warn">На эти даты нет подходящих вариантов. Попробуйте другие даты или меньше гостей.</div>}
          {rooms.map((r) => (
            <div key={r.accommodationType.id} className="card room">
              <Photos photos={r.accommodationType.photos ?? []} name={r.accommodationType.name} />
              <div className="stack" style={{ gap: 10 }}>
                <div>
                  <h2>{r.accommodationType.name}</h2>
                  <div className="tags">
                    {r.accommodationType.areaM2 && <span className="tag">{r.accommodationType.areaM2} м²</span>}
                    <span className="tag">до {r.accommodationType.maxOccupancy} гостей</span>
                    {r.accommodationType.amenities.slice(0, 6).map((a) => <span key={a} className="tag">{a}</span>)}
                  </div>
                  {r.accommodationType.description && <p className="muted small" style={{ margin: '8px 0 0' }}>{r.accommodationType.description}</p>}
                </div>
                {r.soldOut && <div className="warn">На эти даты мест нет</div>}
                {!r.soldOut && r.lastOne && <div className="small" style={{ color: 'var(--bad)' }}>Остался последний номер</div>}
                {!r.soldOut && r.offers.map((o) => (
                  <div key={o.ratePlan.id} className="offer">
                    <div className="stack" style={{ gap: 2 }}>
                      <h3>{o.ratePlan.name}</h3>
                      <div className="small">{MEAL[o.ratePlan.mealPlan] ?? ''}</div>
                      <div className="small muted">{cancellationText(o.cancellationPolicy)}</div>
                      {depositText(o.depositRule) && <div className="small muted">{depositText(o.depositRule, true)}</div>}
                      {o.bookable && o.prepaymentDueMinor > 0 && <div className="small muted">Предоплата при бронировании {rub(o.prepaymentDueMinor)}, остальное при заезде</div>}
                      {o.bookable && o.prepaymentDueMinor === 0 && <div className="small muted">Без предоплаты, оплата при заезде</div>}
                    </div>
                    <div className="price">
                      {o.bookable ? (
                        <>
                          <b>{rub(o.totalMinor)}</b>
                          <div className="small muted">за {nightsWord(nights)}</div>
                          <button className="btn primary" style={{ marginTop: 8 }} onClick={() => setChosen({ room: r, offer: o })}>Забронировать</button>
                        </>
                      ) : (
                        <div className="small" style={{ color: 'var(--warn)', maxWidth: 220 }}>{whyNot(o)}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Checkout({ info, search, room, offer, onBack, onDone }: {
  info: Info; search: Search; room: Room; offer: Offer; onBack: () => void; onDone: (url: string) => void;
}) {
  const [g, setG] = useState({ lastName: '', firstName: '', middleName: '', phone: '', email: '', requests: '' });
  const [pd, setPd] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Один ключ на попытку оформления: повторное нажатие не создаёт вторую бронь
  const [key] = useState(() => crypto.randomUUID());
  const nights = diffDays(search.arrival, search.departure);

  const phone = (raw: string) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('8') && digits.length === 11) return `+7${digits.slice(1)}`;
    return `+${digits}`;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const utm = Object.fromEntries([...new URLSearchParams(window.location.search)].filter(([k]) => k.startsWith('utm_')));
      const r = await api<{ manageToken: string; confirmationUrl: string | null }>('POST', `/${PROPERTY}/bookings`, {
        accommodationTypeId: room.accommodationType.id, ratePlanId: offer.ratePlan.id,
        arrival: search.arrival, departure: search.departure, adults: search.adults, childrenAges: search.children,
        guest: { lastName: g.lastName, firstName: g.firstName, middleName: g.middleName || null, phone: phone(g.phone), email: g.email },
        specialRequests: g.requests || null,
        consents: { pdProcessing: pd, marketing },
        idempotencyKey: key,
        utm: Object.keys(utm).length ? utm : undefined,
      });
      if (r.confirmationUrl) window.location.href = r.confirmationUrl;
      else onDone(`/b/${r.manageToken}`);
    } catch (err) { setError(errorText(err)); setBusy(false); }
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div><button type="button" className="btn link" onClick={onBack}>← Назад к выбору</button></div>
      <h1>Оформление брони</h1>
      <div className="card summary">
        <h2>{room.accommodationType.name}</h2>
        <div className="muted">{offer.ratePlan.name}{MEAL[offer.ratePlan.mealPlan] ? `, ${MEAL[offer.ratePlan.mealPlan].toLowerCase()}` : ''}</div>
        <div className="line"><span>Заезд</span><span>{fmtDate(search.arrival, { weekday: 'short', day: 'numeric', month: 'long' })}, с {info.checkInTime}</span></div>
        <div className="line"><span>Выезд</span><span>{fmtDate(search.departure, { weekday: 'short', day: 'numeric', month: 'long' })}, до {info.checkOutTime}</span></div>
        <div className="line"><span>Гости</span><span>{search.adults} взр.{search.children.length > 0 && `, дети: ${search.children.map((a) => (a === 0 ? 'до 1 года' : `${a} лет`)).join(', ')}`}</span></div>
        <div className="line"><span>Стоимость за {nightsWord(nights)}</span><b>{rub(offer.totalMinor)}</b></div>
        {offer.prepaymentDueMinor > 0 && <div className="line"><span>Предоплата сейчас</span><b>{rub(offer.prepaymentDueMinor)}</b></div>}
        <div className="small muted">{cancellationText(offer.cancellationPolicy)}</div>
        {depositText(offer.depositRule) && <div className="small muted">{depositText(offer.depositRule)}</div>}
      </div>

      <div className="card stack">
        <h2>Контактные данные</h2>
        <div className="grid2">
          <label className="f">Фамилия<input required autoComplete="family-name" value={g.lastName} onChange={(e) => setG({ ...g, lastName: e.target.value })} /></label>
          <label className="f">Имя<input required autoComplete="given-name" value={g.firstName} onChange={(e) => setG({ ...g, firstName: e.target.value })} /></label>
          <label className="f">Отчество<input autoComplete="additional-name" value={g.middleName} onChange={(e) => setG({ ...g, middleName: e.target.value })} /></label>
          <label className="f">Телефон<input required type="tel" autoComplete="tel" placeholder="+7 900 000-00-00" value={g.phone} onChange={(e) => setG({ ...g, phone: e.target.value })} /></label>
          <label className="f">E-mail для подтверждения и чека<input required type="email" autoComplete="email" value={g.email} onChange={(e) => setG({ ...g, email: e.target.value })} /></label>
        </div>
        <label className="f">Пожелания (необязательно)<textarea rows={2} maxLength={1000} value={g.requests} onChange={(e) => setG({ ...g, requests: e.target.value })} /></label>
        <label className="check">
          <input type="checkbox" required checked={pd} onChange={(e) => setPd(e.target.checked)} />
          <span>
            Даю согласие на обработку персональных данных{PRIVACY_URL ? <> по <a href={PRIVACY_URL} target="_blank" rel="noreferrer">политике конфиденциальности</a></> : ''}
            {RULES_URL ? <>, принимаю <a href={RULES_URL} target="_blank" rel="noreferrer">правила проживания</a></> : ''}
            {OFFER_URL ? <> и <a href={OFFER_URL} target="_blank" rel="noreferrer">договор-оферту</a></> : ''}
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
          <span>Хочу получать по почте специальные предложения (можно отписаться в любой момент)</span>
        </label>
      </div>

      {error && <div className="error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy || !pd}>
          {busy ? 'Оформляем…' : offer.prepaymentDueMinor > 0 ? `Перейти к оплате ${rub(offer.prepaymentDueMinor)}` : 'Забронировать'}
        </button>
        {offer.prepaymentDueMinor > 0 && <span className="small muted">Номер закрепляется за вами на {info.holdMinutes} минут, пока идёт оплата</span>}
      </div>
    </form>
  );
}
