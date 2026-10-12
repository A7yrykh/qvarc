'use client';
import { useCallback, useEffect, useState } from 'react';
import { addDays, sortUnits, errorText, get, post, put, todayLocal } from '@/lib/api';
import { can, useMe } from '@/components/Shell';

interface Type {
  id: string; code: string; name: string; kind: string; area_m2: string | null; base_occupancy: number; max_adults: number;
  max_children: number; max_occupancy: number; description: string | null; sort_order: number; is_active: boolean; active_units: number;
}
interface Unit { id: string; name: string; accommodation_type_id: string; type_name: string; is_active: boolean; lock_system_ref: string | null }

const KIND: Record<string, string> = { room: 'Номер', cottage: 'Коттедж', apartment: 'Апартаменты', other: 'Другое' };
const NEW_TYPE = { code: '', name: '', kind: 'room', areaM2: '', baseOccupancy: 2, maxAdults: 2, maxChildren: 0, maxOccupancy: 2, description: '', sortOrder: 0, isActive: true };

export default function RoomsPage() {
  const me = useMe();
  const writable = can(me, 'inventory.write');
  const [types, setTypes] = useState<Type[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [edit, setEdit] = useState<{ id: string | null; v: typeof NEW_TYPE } | null>(null);
  const [unitForm, setUnitForm] = useState({ id: '', name: '', typeId: '', isActive: true });
  const [block, setBlock] = useState({ unitId: '', from: todayLocal(), to: addDays(todayLocal(), 1), reason: 'out_of_order' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    get<Type[]>('/accommodation-types').then(setTypes, (e) => setError(errorText(e)));
    get<Unit[]>('/units').then((u) => setUnits(sortUnits(u, (x) => x.accommodation_type_id)), (e) => setError(errorText(e)));
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError(''); setNotice('');
    try { await fn(); setNotice(ok); load(); return true; } catch (e) { setError(errorText(e)); return false; }
  };

  const saveType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const v = edit.v;
    const body = { ...v, areaM2: v.areaM2 === '' ? null : Number(String(v.areaM2).replace(',', '.')), description: v.description || null };
    if (await run(() => (edit.id ? put(`/accommodation-types/${edit.id}`, body) : post('/accommodation-types', body)), 'Категория сохранена')) setEdit(null);
  };

  const saveUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { accommodationTypeId: unitForm.typeId, name: unitForm.name, isActive: unitForm.isActive };
    if (await run(() => (unitForm.id ? put(`/units/${unitForm.id}`, body) : post('/units', body)), 'Номер сохранён')) setUnitForm({ id: '', name: '', typeId: '', isActive: true });
  };

  const setV = (k: keyof typeof NEW_TYPE) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    edit && setEdit({ ...edit, v: { ...edit.v, [k]: e.target.type === 'number' ? Number(e.target.value) : e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value } });

  return (
    <div className="stack" style={{ maxWidth: 1000 }}>
      <h1>Номера</h1>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className="row">
        <h2 style={{ margin: 0, marginRight: 'auto' }}>Категории</h2>
        {writable && <button className="btn" onClick={() => setEdit({ id: null, v: { ...NEW_TYPE } })}>Добавить категорию</button>}
      </div>
      <table className="list">
        <thead><tr><th>Название</th><th>Тип</th><th className="num">Площадь</th><th className="num">Мест (осн./макс.)</th><th className="num">Номеров</th><th /></tr></thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.id} style={t.is_active ? undefined : { opacity: 0.55 }}>
              <td>{t.name} <span className="muted">{t.code}</span></td>
              <td>{KIND[t.kind] ?? t.kind}</td>
              <td className="num">{t.area_m2 ? `${Number(t.area_m2)} м²` : ''}</td>
              <td className="num">{t.base_occupancy} / {t.max_occupancy}</td>
              <td className="num">{t.active_units}</td>
              <td>{writable && (
                <button className="btn" onClick={() => setEdit({ id: t.id, v: {
                  code: t.code, name: t.name, kind: t.kind, areaM2: t.area_m2 ?? '', baseOccupancy: t.base_occupancy, maxAdults: t.max_adults,
                  maxChildren: t.max_children, maxOccupancy: t.max_occupancy, description: t.description ?? '', sortOrder: t.sort_order, isActive: t.is_active,
                } })}>Изменить</button>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {edit && (
        <form className="card stack" onSubmit={saveType}>
          <h2>{edit.id ? 'Изменить категорию' : 'Новая категория'}</h2>
          <div className="grid2">
            <label>Название<input required value={edit.v.name} onChange={setV('name')} /></label>
            <label>Код (латиницей)<input required pattern="[a-z0-9_\-]{2,40}" value={edit.v.code} onChange={setV('code')} /></label>
            <label>Тип<select value={edit.v.kind} onChange={setV('kind')}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label>Площадь, м²<input inputMode="decimal" value={edit.v.areaM2} onChange={setV('areaM2')} /></label>
            <label>Основных мест<input type="number" min={1} value={edit.v.baseOccupancy} onChange={setV('baseOccupancy')} /></label>
            <label>Максимум взрослых<input type="number" min={1} value={edit.v.maxAdults} onChange={setV('maxAdults')} /></label>
            <label>Максимум детей<input type="number" min={0} value={edit.v.maxChildren} onChange={setV('maxChildren')} /></label>
            <label>Максимум гостей<input type="number" min={1} value={edit.v.maxOccupancy} onChange={setV('maxOccupancy')} /></label>
            <label>Порядок в списке<input type="number" value={edit.v.sortOrder} onChange={setV('sortOrder')} /></label>
          </div>
          <label>Описание<textarea rows={3} value={edit.v.description} onChange={setV('description')} /></label>
          <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}><input type="checkbox" checked={edit.v.isActive} onChange={setV('isActive')} /> Продаётся</label>
          <div className="row"><button className="btn primary">Сохранить</button><button type="button" className="btn" onClick={() => setEdit(null)}>Отмена</button></div>
        </form>
      )}

      <h2>Номера</h2>
      <table className="list">
        <thead><tr><th>Номер</th><th>Категория</th><th>Статус</th><th /></tr></thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.type_name}</td>
              <td>{u.is_active ? 'в работе' : <span className="muted">выключен</span>}</td>
              <td>{writable && <button className="btn" onClick={() => setUnitForm({ id: u.id, name: u.name, typeId: u.accommodation_type_id, isActive: u.is_active })}>Изменить</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {writable && (
        <div className="grid2">
          <form className="card stack" onSubmit={saveUnit}>
            <h2>{unitForm.id ? 'Изменить номер' : 'Добавить номер'}</h2>
            <label>Название или номер<input required value={unitForm.name} onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })} /></label>
            <label>Категория
              <select required value={unitForm.typeId} onChange={(e) => setUnitForm({ ...unitForm, typeId: e.target.value })}>
                <option value="">Выберите</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="row" style={{ display: 'flex', color: 'var(--text)', fontSize: 14 }}><input type="checkbox" checked={unitForm.isActive} onChange={(e) => setUnitForm({ ...unitForm, isActive: e.target.checked })} /> В работе</label>
            <div className="row">
              <button className="btn primary">Сохранить</button>
              {unitForm.id && <button type="button" className="btn" onClick={() => setUnitForm({ id: '', name: '', typeId: '', isActive: true })}>Отмена</button>}
            </div>
          </form>
          <form className="card stack" onSubmit={async (e) => { e.preventDefault(); await run(() => post('/availability-blocks', { unitId: block.unitId, from: block.from, to: addDays(block.to, 1), reason: block.reason }), 'Номер закрыт на эти даты'); }}>
            <h2>Закрыть номер</h2>
            <label>Номер
              <select required value={block.unitId} onChange={(e) => setBlock({ ...block, unitId: e.target.value })}>
                <option value="">Выберите</option>
                {units.filter((u) => u.is_active).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.type_name})</option>)}
              </select>
            </label>
            <div className="grid2">
              <label>С<input type="date" required value={block.from} onChange={(e) => setBlock({ ...block, from: e.target.value })} /></label>
              <label>По (включительно)<input type="date" required min={block.from} value={block.to} onChange={(e) => setBlock({ ...block, to: e.target.value })} /></label>
            </div>
            <label>Причина
              <select value={block.reason} onChange={(e) => setBlock({ ...block, reason: e.target.value })}>
                <option value="out_of_order">Ремонт</option>
                <option value="owner_use">Для владельца</option>
                <option value="stop_sale">Стоп-продажа</option>
              </select>
            </label>
            <div><button className="btn primary">Закрыть</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
