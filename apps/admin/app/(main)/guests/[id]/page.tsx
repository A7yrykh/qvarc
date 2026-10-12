import GuestView from './GuestView';

// Демо-сборка статична: одна заготовка страницы, конкретная запись берётся из адреса (см. useRouteId)
export const generateStaticParams = () => (process.env.NEXT_PUBLIC_DEMO === '1' ? [{ id: '_' }] : []);

export default function Page() {
  return <GuestView />;
}
