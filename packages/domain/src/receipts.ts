/**
 * Позиции чека по 54-ФЗ для оплаты проживания.
 * Признак способа расчёта: 100% оплата до оказания услуги — «предоплата 100%»,
 * частичная — «предоплата»; зачёт аванса при выезде — отдельный чек «полный расчёт».
 */
export type PaymentMethodSign = 'full_prepayment' | 'partial_prepayment' | 'full_payment';

export interface ReceiptItem {
  name: string;
  quantity: number;
  amountMinor: number;
  paymentSubject: 'service';
  paymentMethod: PaymentMethodSign;
  vat: 'none' | 'vat0' | 'vat5' | 'vat7' | 'vat10' | 'vat20' | 'vat22';
}

export interface Receipt {
  customer: { email?: string | null; phone?: string | null };
  items: ReceiptItem[];
  totalMinor: number;
}

export function prepaymentReceipt(input: {
  title: string;
  paymentMinor: number;
  bookingTotalMinor: number;
  email?: string | null;
  phone?: string | null;
  vat?: ReceiptItem['vat'];
}): Receipt {
  if (input.paymentMinor <= 0) throw new Error('Сумма чека должна быть больше нуля');
  if (!input.email && !input.phone) throw new Error('Для электронного чека нужен e-mail или телефон покупателя');
  const method: PaymentMethodSign = input.paymentMinor >= input.bookingTotalMinor ? 'full_prepayment' : 'partial_prepayment';
  return {
    customer: { email: input.email ?? null, phone: input.phone ?? null },
    items: [{ name: input.title.slice(0, 128), quantity: 1, amountMinor: input.paymentMinor, paymentSubject: 'service', paymentMethod: method, vat: input.vat ?? 'none' }],
    totalMinor: input.paymentMinor,
  };
}
