'use client';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PROPERTY, api, errorText } from '@/lib/api';

interface LegalDocument { code: string; title: string; version: string; issuer: string; sections: { title: string; paragraphs: string[] }[] }

/** Документ объекта: правила проживания или политика конфиденциальности. Открывается из формы брони. */
export default function DocumentPage() {
  const { code } = useParams<{ code: string }>();
  const [doc, setDoc] = useState<LegalDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<LegalDocument>('GET', `/${PROPERTY}/documents/${encodeURIComponent(code)}`).then((d) => {
      setDoc(d);
      document.title = d.title;
    }, (e) => setError(errorText(e)));
  }, [code]);

  if (error) return <div className="card">{error}</div>;
  if (!doc) return <div className="muted">Загружаем документ…</div>;
  return (
    <article className="card doc">
      <h1>{doc.title}</h1>
      <p className="muted">{doc.issuer}, редакция от {doc.version.slice(0, 10).split('-').reverse().join('.')}</p>
      {doc.sections.map((s) => (
        <section key={s.title}>
          <h2>{s.title}</h2>
          {s.paragraphs.map((p, i) => (p.startsWith('• ') ? <p key={i} className="bullet">{p.slice(2)}</p> : <p key={i}>{p}</p>))}
        </section>
      ))}
    </article>
  );
}
