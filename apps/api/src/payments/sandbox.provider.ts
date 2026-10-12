import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { CreatePaymentRequest, PaymentProvider, ProviderStatus, WebhookEvent } from './provider';

interface SandboxPayment { amountMinor: number; status: ProviderStatus; returnUrl: string; description: string; refundedMinor: number }

/**
 * Тестовый эквайер: деньги не списываются. Страница оплаты отдаётся самим API (/public/v1/sandbox/pay/:id),
 * кнопки на ней отправляют подписанное уведомление так же, как это делает настоящий банк.
 * В рабочей среде запрещён (см. config.ts).
 */
export class SandboxProvider implements PaymentProvider {
  readonly code = 'sandbox';
  private readonly payments = new Map<string, SandboxPayment>();
  private readonly byKey = new Map<string, string>();

  constructor(private readonly secret: string, private readonly apiPublicUrl: string) {}

  async createPayment(req: CreatePaymentRequest) {
    const existing = this.byKey.get(req.idempotencyKey);
    const id = existing ?? `sb_${randomUUID()}`;
    if (!existing) {
      this.byKey.set(req.idempotencyKey, id);
      this.payments.set(id, { amountMinor: req.amountMinor, status: 'pending', returnUrl: req.returnUrl, description: req.description, refundedMinor: 0 });
    }
    return { providerPaymentId: id, confirmationUrl: `${this.apiPublicUrl}/public/v1/sandbox/pay/${id}`, status: 'pending' as const };
  }

  async fetchStatus(id: string): Promise<ProviderStatus> {
    const p = this.payments.get(id);
    if (!p) throw new Error(`Платёж ${id} не найден у провайдера`);
    return p.status;
  }

  async cancel(id: string) {
    const p = this.payments.get(id);
    if (p && p.status === 'pending') p.status = 'cancelled';
  }

  async refund(req: { providerPaymentId: string; amountMinor: number }) {
    const p = this.payments.get(req.providerPaymentId);
    if (!p || p.status !== 'succeeded' || p.refundedMinor + req.amountMinor > p.amountMinor) return { providerRefundId: '', status: 'failed' as const };
    p.refundedMinor += req.amountMinor;
    return { providerRefundId: `sbr_${randomUUID()}`, status: 'succeeded' as const };
  }

  /** Для тестовой страницы: что показать и куда вернуть гостя. */
  view(id: string) {
    return this.payments.get(id) ?? null;
  }

  /** Действие на тестовой странице: меняет статус и возвращает подписанное уведомление. */
  complete(id: string, outcome: 'succeeded' | 'failed') {
    const p = this.payments.get(id);
    if (!p || p.status !== 'pending') return null;
    p.status = outcome;
    const body = Buffer.from(JSON.stringify({ event_id: randomUUID(), type: `payment.${outcome}`, payment_id: id }));
    return { body, signature: this.sign(body) };
  }

  sign(body: Buffer) {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }

  parseWebhook(headers: Record<string, string | undefined>, rawBody: Buffer): WebhookEvent | null {
    const got = headers['x-sandbox-signature'] ?? '';
    const want = this.sign(rawBody);
    if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return null;
    const j = JSON.parse(rawBody.toString('utf8')) as { event_id: string; type: string; payment_id: string };
    return { eventId: j.event_id, providerPaymentId: j.payment_id, type: j.type };
  }
}
