'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { DEMO, asset, get, post } from '@/lib/api';
import { resetDemo } from '@/lib/demo';

export interface Me { id: string; email: string; fullName: string; permissions: string[] }
const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);
export const can = (me: Me | null, perm: string) => !!me?.permissions.includes(perm);

const NAV = [
  { href: '/calendar', label: 'Шахматка', perm: 'calendar.read' },
  { href: '/bookings', label: 'Брони', perm: 'booking.read' },
  { href: '/guests', label: 'Гости', perm: 'guest.read' },
  { href: '/prices', label: 'Цены и ограничения', perm: 'rates.read' },
  { href: '/services', label: 'Услуги и прокат', perm: 'rental.read' },
  { href: '/settings/rooms', label: 'Номера', perm: 'inventory.read' },
  { href: '/settings/rates', label: 'Тарифы', perm: 'rates.read' },
  { href: '/settings/import', label: 'Перенос из TravelLine', perm: 'users.manage' },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const path = usePathname();
  useEffect(() => {
    get<Me>('/auth/me').then(setMe).catch(() => undefined);
  }, []);
  if (!me) return <div className="main muted">Загрузка…</div>;
  return (
    <MeContext.Provider value={me}>
      <div className="shell">
        <nav className="side">
          <div className="brand"><img src={asset('/brand/kvarc-logo-light.svg')} alt="Кварц" /></div>
          {NAV.filter((n) => can(me, n.perm)).map((n) => (
            <Link key={n.href} href={n.href} className={path.startsWith(n.href) ? 'active' : ''}>{n.label}</Link>
          ))}
          <div className="grow" />
          <div className="who">{me.fullName}</div>
          {!DEMO && <Link href="/settings/account" className={path.startsWith('/settings/account') ? 'active' : ''}>Мой пароль</Link>}
          <a href="#" onClick={async (e) => { e.preventDefault(); await post('/auth/logout'); window.location.href = asset('/login'); }}>Выйти</a>
        </nav>
        <main className="main">
          {DEMO && (
            <div className="notice demo">
              <b>Демо-версия.</b> Брони, гости и цены выдуманы и не связаны с настоящим бронированием. Изменения видны только в вашем браузере.
              <button className="btn" style={{ marginLeft: 12 }} onClick={() => { resetDemo(); window.location.reload(); }}>Начать заново</button>
            </div>
          )}
          {children}
        </main>
      </div>
    </MeContext.Provider>
  );
}
