import './globals.css';
import type { Metadata, Viewport } from 'next';

export const metadata: Metadata = { title: 'Бронирование — Кварц, Увильды' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#343C43' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <header className="top">
          <div className="top-in">
            <img className="logo" src="/brand/kvarc-logo-light.svg" alt="Кварц, место отдыха" width={130} height={45} />
            <span className="place">оз. Увильды</span>
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="foot">
          <img src="/brand/trees.png" alt="" width={104} height={62} />
          <div>Место отдыха «Кварц», озеро Увильды</div>
        </footer>
      </body>
    </html>
  );
}
