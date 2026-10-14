'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { addDays, errorText, fmtDate, get, post, put, rub, toMinor, todayLocal } from '@/lib/api';
import { can, useMe } from '@/components/Shell';

interface Service {
  id: string; category: string; name: string; description: string | null; pricing: string; price_minor: number; duration_minutes: number | null;
  min_age: number | null; rules: string | null; cancellation_text: string | null; open_time: string; close_time: string; slot_step_minutes: number;
  max_quantity: number; requires_confirmation: boolean; equipment_type_id: string | null; equipment_name: string | null; sort_order: number;
  bookable_online: boolean; is_active: boolean;
}
interface Unit { id: string; inventory_no: string; condition: string; notes: string | null }
interface EqType { id: string; name: string; deposit_minor: number; buffer_minutes: number; is_active: boolean; units: Unit[] }
interface Row {
  id: string; service_name: string; status: string; source: string; starts_at: string | null; ends_at: string | null; quantity: number; amount_minor: number;
  comment: string | null; booking_id: string | null; booking_number: string | null; last_name: string; first_name: string; phone_e164: string | null; units: string | null;
}

const CATEGORIES: Record<string, string> = { rental: 'Прокат', water: 'На воде', excursion: 'Экскурсии', room_extra: 'В номер', food: 'Еда', custom: 'Другое' };
const PRICING: Record<string, string> = { per_item: 'за штуку', per_hour: 'за час', per_day: 'за день', per_person: 'за человека', per_stay: 'за проживание' };
const SB_STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: 'ждёт подтверждения', tone: 'warn' },
  confirmed: { label: 'подтверждена', tone: 'ok' },
  in_use: { label: 'выдано', tone: 'info' },
  done: { label: 'завершена', tone: 'muted' },
  cancelled: { label: 'отменена', tone: 'muted' },
};
const CONDITION: Record<string, string> = { ok: 'исправен', needs_check: 'проверить', damaged: 'повреждён', retired: 'списан' };
const SOURCE: Record<string, string> = { admin: 'админка', guest_app: 'приложение', booking_site: 'сайт' };
const TABS = [['schedule', 'Расписание'], ['catalog', 'Услуги'], ['equipment', 'Оборудование']] as const;
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '');

const EMPTY = {
  id: '', category: 'rental', name: '', description: '', pricing: 'per_item', price: '', durationMinutes: '', minAge: '', rules: '', cancellationText: '',
  openTime: '09:00', closeTime: '21:00', slotStepMinutes: '60', maxQuantity: '1', requiresConfirmation: false, equipmentTypeId: '', sortOrder: '0',
  bookableOnline: true, isActive: true,
};

export default function ServicesPage() {
  const me = useMe();
  const writable = can(me, 'rental.manage');
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('schedule');
  const [date, setDate] = useState(todayLocal());
  const [rows, setRows] = useState<Row[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [equipment, setEquipment] = useState<EqType[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [eqForm, setEqForm] = useState({ name: '', deposit: '', buffer: '0' });
  const [unitNo, setUnitNo] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const loadSchedule = useCallback(() => { get<Row[]>(`/service-bookings?date=${date}`).then(setRows, (e) => setError(errorText(e))); }, [date]);
  const loadCatalog = useCallback(() => {
    get<Service[]>('/services').then(setServices, (e) => setError(errorText(e)));
    get<EqType[]>('/equipment').then(setEquipment, (e) => setError(errorText(e)));
  }, []);
  useEffect(loadSchedule, [loadSchedule]);
  useEffect(loadCatalog, [loadCatalog]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); setNotice(ok); } catch (e) { setError(errorText(e)); }
    setBusy(false);
  };

  const act = (r: Row, action: string, label: string, body: Record<string, unknown> = {}) =>
    run(() => post(`/service-bookings/${r.id}/${action}`, body), label).then(loadSchedule);

  const edit = (s: Service) => {
    setForm({
      id: s.id, category: s.category, name: s.name, description: s.description ?? '', pricing: s.pricing, price: String(s.price_minor / 100),
      durationMinutes: s.duration_minutes ? String(s.duration_minutes) : '', minAge: s.min_age != null ? String(s.min_age) : '', rules: s.rules ?? '',
      cancellationText: s.cancellation_text ?? '', openTime: s.open_time.slice(0, 5), closeTime: s.close_time.slice(0, 5), slotStepMinutes: String(s.slot_step_minutes),
      maxQuantity: String(s.max_quantity), requiresConfirmation: s.requires_confirmation, equipmentTypeId: s.equipment_type_id ?? '', sortOrder: String(s.sort_order),
      bookableOnline: s.bookable_online, isActive: s.is_active,
    });
    setNotice(''); setError('');
  };

  const saveService = (e: React.FormEvent) => {
    e.preventDefault();
    const num = (s: string) => (s.trim() === '' ? null : Number(s));
    const body = {
      category: form.category, name: form.name, description: form.description || null, pricing: form.pricing, priceMinor: toMinor(form.price),
      durationMinutes: num(form.durationMinutes), minAge: num(form.minAge), rules: form.rules || null, cancellationText: form.cancellationText || null,
      openTime: form.openTime, closeTime: form.closeTime, slotStepMinutes: Number(form.slotStepMinutes), maxQuantity: Number(form.maxQuantity),
      requiresConfirmation: form.requiresConfirmation, equipmentTypeId: form.equipmentTypeId || null, sortOrder: Number(form.sortOrder),
      bookableOnline: form.bookableOnline, isActive: form.isActive,
    };
    if (Number.isNaN(body.priceMinor)) { setError('Цена: введите число'); return; }
    run(() => (form.id ? put(`/services/${form.id}`, body) : post('/services', body)), form.id ? 'Услуга сохранена' : 'Услуга добавлена').then(() => { setForm(EMPTY); loadCatalog(); });
  };

  const addType = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => post('/equipment-types', { name: eqForm.name, depositMinor: eqForm.deposit ? toMinor(eqForm.deposit) : 0, bufferMinutes: Number(eqForm.buffer) }), 'Тип оборудования добавлен')
      .then(() => { setEqForm({ name: '', deposit: '', buffer: '0' }); loadCatalog(); });
  };
  const addUnit = (t: EqType) => run(() => post(`/equipment-types/${t.id}/units`, { inventoryNo: unitNo[t.id] ?? '' }), 'Единица добавлена').then(() => { setUnitNo({ ...unitNo, [t.id]: '' }); loadCatalog(); });
  const setCondition = (u: Unit, condition: string) => run(() => put(`/equipment-units/${u.id}`, { inventoryNo: u.inventory_no, condition, notes: u.notes }), 'Состояние изменено').then(loadCatalog);

  const f = (k: keyof typeof EMPTY) => ({
    value: form[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value }),
  });
  const check = (k: 'requiresConfirmation' | 'bookableOnline' | 'isActive', label: string) => (
    <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}>
      <input type="checkbox" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} /> {label}
    </label>
  );

  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>Услуги и прокат</h1>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      <div className="row">
        {TABS.map(([k, l]) => <button key={k} className={`btn${tab === k ? ' primary' : ''}`} onClick={() => { setTab(k); setNotice(''); }}>{l}</button>)}
      </div>

      {tab === 'schedule' && (
        <>
          <div className="row" style={{ alignItems: 'center' }}>
            <button className="btn" onClick={() => setDate(addDays(date, -1))}>←</button>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <button className="btn" onClick={() => setDate(addDays(date, 1))}>→</button>
            <span className="muted">{fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}. Заявки без времени показываются каждый день, пока их не подтвердят или не отменят.</span>
          </div>
          {rows.length === 0 ? <div className="card muted">На этот день записей нет</div> : (
            <table className="list">
              <thead><tr><th>Время</th><th>Услуга</th><th>Гость</th><th>Кол-во</th><th>Сумма</th><th>Статус</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.starts_at ? `${time(r.starts_at)}–${time(r.ends_at)}` : <span className="muted">без времени</span>}</td>
                    <td>{r.service_name}{r.units && <div className="muted" style={{ fontSize: 12 }}>{r.units}</div>}{r.comment && <div className="muted" style={{ fontSize: 12 }}>{r.comment}</div>}</td>
                    <td>
                      {r.last_name} {r.first_name}
                      {r.booking_id && <div style={{ fontSize: 12 }}><Link href={`/bookings/${r.booking_id}`}>бронь {r.booking_number}</Link> · <span className="muted">{SOURCE[r.source] ?? r.source}</span></div>}
                    </td>
                    <td>{r.quantity}</td>
                    <td>{rub(r.amount_minor)}</td>
                    <td><span className={`badge tone-${SB_STATUS[r.status]?.tone ?? 'muted'}`}>{SB_STATUS[r.status]?.label ?? r.status}</span></td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {writable && r.status === 'requested' && <button className="btn primary" disabled={busy} onClick={() => act(r, 'confirm', 'Подтверждено')}>Подтвердить</button>}
                      {writable && r.status === 'confirmed' && r.units && <button className="btn primary" disabled={busy} onClick={() => act(r, 'issue', 'Выдано')}>Выдать</button>}
                      {writable && r.status === 'in_use' && (
                        <>
                          <button className="btn primary" disabled={busy} onClick={() => act(r, 'return', 'Возврат принят')}>Принять</button>{' '}
                          <button className="btn" disabled={busy} onClick={() => act(r, 'return', 'Возврат принят, оборудование отправлено на проверку', { needsCheck: true })}>Принять, проверить</button>
                        </>
                      )}
                      {writable && ['requested', 'confirmed'].includes(r.status) && (
                        <> <button className="btn danger" disabled={busy} onClick={() => confirm('Отменить запись? Сумма уйдёт из брони гостя.') && act(r, 'cancel', 'Отменено')}>Отменить</button></>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {tab === 'catalog' && (
        <>
          <table className="list">
            <thead><tr><th>Услуга</th><th>Раздел</th><th>Цена</th><th>Как записаться</th><th>Видна гостю</th><th /></tr></thead>
            <tbody>
              {services.map((s) => (
                <tr key={s.id} className={s.is_active ? '' : 'muted'}>
                  <td>{s.name}{!s.is_active && ' (выключена)'}</td>
                  <td>{CATEGORIES[s.category] ?? s.category}</td>
                  <td>{rub(s.price_minor)} <span className="muted">{PRICING[s.pricing]}</span></td>
                  <td>
                    {s.equipment_type_id ? `на время, ${s.duration_minutes} мин, ${s.equipment_name}` : 'заявка'}
                    {s.requires_confirmation && <span className="muted">, с подтверждением</span>}
                  </td>
                  <td>{s.bookable_online && s.is_active ? 'да' : 'нет'}</td>
                  <td>{writable && <button className="btn" onClick={() => edit(s)}>Изменить</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {writable && (
            <form className="card stack" onSubmit={saveService}>
              <h2>{form.id ? `Изменить: ${form.name}` : 'Новая услуга'}</h2>
              <div className="row">
                <label>Раздел<select {...f('category')}>{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                <label style={{ flex: 1 }}>Название<input {...f('name')} required /></label>
                <label>Цена, ₽<input inputMode="decimal" {...f('price')} required /></label>
                <label>Цена<select {...f('pricing')}>{Object.entries(PRICING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              </div>
              <label>Описание<textarea rows={2} {...f('description')} /></label>
              <div className="row">
                <label>Оборудование
                  <select {...f('equipmentTypeId')}>
                    <option value="">нет — оформляется заявкой</option>
                    {equipment.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.units.filter((u) => u.condition === 'ok').length} шт.)</option>)}
                  </select>
                </label>
                <label>Сеанс, мин<input inputMode="numeric" {...f('durationMinutes')} placeholder={form.equipmentTypeId ? 'обязательно' : ''} /></label>
                <label>Шаг записи, мин<input inputMode="numeric" {...f('slotStepMinutes')} /></label>
                <label>С<input type="time" {...f('openTime')} /></label>
                <label>До<input type="time" {...f('closeTime')} /></label>
                <label>Не больше за раз<input inputMode="numeric" {...f('maxQuantity')} /></label>
                <label>Возраст от<input inputMode="numeric" {...f('minAge')} /></label>
                <label>Порядок<input inputMode="numeric" {...f('sortOrder')} /></label>
              </div>
              <label>Правила для гостя<textarea rows={2} {...f('rules')} /></label>
              <label>Условия отмены<input {...f('cancellationText')} placeholder="Например: бесплатная отмена до начала" /></label>
              <div className="row">
                {check('requiresConfirmation', 'Подтверждает администратор')}
                {check('bookableOnline', 'Гость может записаться в приложении и на сайте')}
                {check('isActive', 'Услуга действует')}
              </div>
              <div className="row">
                <button className="btn primary" disabled={busy}>{form.id ? 'Сохранить' : 'Добавить'}</button>
                {form.id && <button type="button" className="btn" onClick={() => setForm(EMPTY)}>Отмена</button>}
              </div>
            </form>
          )}
        </>
      )}

      {tab === 'equipment' && (
        <>
          {equipment.map((t) => (
            <div key={t.id} className="card stack">
              <div className="row">
                <h2 style={{ margin: 0, marginRight: 'auto' }}>{t.name}</h2>
                <span className="muted">залог {rub(t.deposit_minor)}, перерыв между сеансами {t.buffer_minutes} мин</span>
              </div>
              <table className="list">
                <tbody>
                  {t.units.map((u) => (
                    <tr key={u.id}>
                      <td>{u.inventory_no}</td>
                      <td>
                        {writable ? (
                          <select value={u.condition} onChange={(e) => setCondition(u, e.target.value)}>
                            {Object.entries(CONDITION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        ) : CONDITION[u.condition]}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {writable && (
                <div className="row">
                  <input placeholder="Инвентарный номер" value={unitNo[t.id] ?? ''} onChange={(e) => setUnitNo({ ...unitNo, [t.id]: e.target.value })} />
                  <button className="btn" disabled={busy || !(unitNo[t.id] ?? '').trim()} onClick={() => addUnit(t)}>Добавить единицу</button>
                </div>
              )}
            </div>
          ))}
          {writable && (
            <form className="card stack" onSubmit={addType}>
              <h2>Новый тип оборудования</h2>
              <div className="row">
                <label style={{ flex: 1 }}>Название<input value={eqForm.name} onChange={(e) => setEqForm({ ...eqForm, name: e.target.value })} placeholder="Сап-борд, велосипед, лодка" required /></label>
                <label>Залог, ₽<input inputMode="decimal" value={eqForm.deposit} onChange={(e) => setEqForm({ ...eqForm, deposit: e.target.value })} /></label>
                <label>Перерыв между сеансами, мин<input inputMode="numeric" value={eqForm.buffer} onChange={(e) => setEqForm({ ...eqForm, buffer: e.target.value })} /></label>
              </div>
              <div className="row"><button className="btn primary" disabled={busy}>Добавить</button></div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
