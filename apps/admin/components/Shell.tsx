'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { get, post } from '@/lib/api';

export interface Me { id: string; email: string; fullName: string; permissions: string[] }
const MeContext = createContext<Me | null>(null);
export const useMe = () => useContext(MeContext);
export const can = (me: Me | null, perm: string) => !!me?.permissions.includes(perm);

const NAV = [
  { href: '/calendar', label: 'Шахматка', perm: 'calendar.read' },
  { href: '/bookings', label: 'Брони', perm: 'booking.read' },
  { href: '/guests', label: 'Гости', perm: 'guest.read' },
  { href: '/prices', label: 'Цены и ограничения', perm: 'rates.read' },
  { href: '/settings/rooms', label: 'Номера', perm: 'inventory.read' },
  { href: '/settings/rates', label: 'Тарифы', perm: 'rates.read' },
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
          <div className="brand"><img src="/brand/kvarc-logo-light.svg" alt="Кварц" /></div>
          {NAV.filter((n) => can(me, n.perm)).map((n) => (
            <Link key={n.href} href={n.href} className={path.startsWith(n.href) ? 'active' : ''}>{n.label}</Link>
          ))}
          <div className="grow" />
          <div className="who">{me.fullName}</div>
          <a href="#" onClick={async (e) => { e.preventDefault(); await post('/auth/logout'); window.location.href = '/login'; }}>Выйти</a>
        </nav>
        <main className="main">{children}</main>
      </div>
    </MeContext.Provider>
  );
}
