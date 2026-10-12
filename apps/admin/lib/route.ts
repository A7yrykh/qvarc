'use client';
import { useParams, usePathname } from 'next/navigation';

/** id из адреса /bookings/<id>. В демо-сборке все такие адреса отдаёт одна заготовка «_», поэтому id читается из пути. */
export function useRouteId(): string {
  const { id } = useParams<{ id: string }>();
  const path = usePathname();
  if (id !== '_') return id;
  const parts = path.split('/').filter(Boolean);
  return decodeURIComponent(parts[parts.length - 1] ?? '');
}
