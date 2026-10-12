import info from '../../../../data/kvarc-guest-info.json';
import legal from '../../../../data/legal-documents.json';

export interface LegalDocument {
  code: string;
  title: string;
  version: string;
  issuer: string;
  sections: { title: string; paragraphs: string[] }[];
}

/** О базе, контакты, удобства и ответы на вопросы (data/kvarc-guest-info.json). */
export const guestInfo: { about: string; address: string; phones: string[]; email: string; facilities: string[]; faq: { q: string; a: string }[] } = info;

/** Документы базы для гостя (data/legal-documents.json). Служебное поле source гостю не отдаётся. */
export const legalDocuments: LegalDocument[] = (legal.documents as (LegalDocument & { source?: string })[]).map(
  ({ source: _source, ...d }) => d,
);

export function legalDocument(code: string): LegalDocument | undefined {
  return legalDocuments.find((d) => d.code === code);
}

/** Версия правил проживания: новая версия требует принять правила заново. */
export const RULES_VERSION = legalDocument('rules')!.version;
