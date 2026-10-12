import type { Receipt } from '../../../../packages/domain/src';

export type ProviderStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';

export interface CreatePaymentRequest {
  paymentId: string;
  amountMinor: number;
  description: string;
  idempotencyKey: string;
  returnUrl: string;
  receipt: Receipt;
}

export interface WebhookEvent {
  eventId: string;
  providerPaymentId: string;
  type: string;
}

/**
 * Эквайер. Правило для всех реализаций: статус платежа из уведомления не принимается на веру,
 * а перепроверяется запросом к эквайеру (fetchStatus). Данные карт через QVARC не проходят.
 */
export interface PaymentProvider {
  readonly code: string;
  createPayment(req: CreatePaymentRequest): Promise<{ providerPaymentId: string; confirmationUrl: string; status: ProviderStatus }>;
  fetchStatus(providerPaymentId: string): Promise<ProviderStatus>;
  cancel(providerPaymentId: string): Promise<void>;
  /** Проверяет подпись и разбирает уведомление. Неверная подпись → null. */
  parseWebhook(headers: Record<string, string | undefined>, rawBody: Buffer): WebhookEvent | null;
  refund(req: { providerPaymentId: string; amountMinor: number; idempotencyKey: string; receipt: Receipt }): Promise<{ providerRefundId: string; status: 'pending' | 'succeeded' | 'failed' }>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
