import { createHmac, timingSafeEqual } from 'node:crypto';
import type { CreatePaymentRequest, PaymentProvider, ProviderStatus, WebhookEvent } from './provider';

export interface SberConfig {
  /** Адрес REST API шлюза, заканчивается на «/». Тест: https://ecomtest.sberbank.ru/ecomm/gw/partner/api/v1/ */
  apiUrl: string;
  userName: string;
  password: string;
  /** json для шлюза ecommerce.sberbank.ru, form для старого securepayments.sberbank.ru/payment/rest/ */
  format: 'json' | 'form';
  /** Ключ для проверки контрольной суммы уведомлений (симметричный). Пусто — уведомление только запускает сверку. */
  callbackSecret?: string;
  /** Адрес для уведомлений по каждому заказу. Пусто — используется адрес из личного кабинета Сбера. */
  callbackUrl?: string;
  /** Сколько секунд живёт страница оплаты. По умолчанию 20 минут, как удержание номера. */
  sessionTimeoutSecs: number;
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type SberResponse = Record<string, unknown> & { errorCode?: string | number; errorMessage?: string };

/**
 * Интернет-эквайринг Сбербанка, одностадийная оплата: register.do → страница оплаты банка →
 * уведомление → getOrderStatusExtended.do. Номер заказа в банке (orderNumber) — id платежа QVARC,
 * поэтому повторная регистрация того же платежа не создаёт второй заказ.
 * Чеки 54-ФЗ здесь не передаются: они идут через отдельную онлайн-кассу.
 */
export class SberProvider implements PaymentProvider {
  readonly code = 'sber';

  constructor(private readonly cfg: SberConfig, private readonly http: Fetch = fetch as unknown as Fetch) {}

  private async call(method: string, params: Record<string, string | number | undefined>): Promise<SberResponse> {
    const all: Record<string, string> = { userName: this.cfg.userName, password: this.cfg.password };
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') all[k] = String(v);
    const body = this.cfg.format === 'json' ? JSON.stringify(all) : new URLSearchParams(all).toString();
    const res = await this.http(this.cfg.apiUrl + method, {
      method: 'POST',
      headers: { 'Content-Type': this.cfg.format === 'json' ? 'application/json' : 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Сбер ${method}: HTTP ${res.status}`);
    return (await res.json()) as SberResponse;
  }

  private static failed(r: SberResponse) {
    return r.errorCode !== undefined && String(r.errorCode) !== '0';
  }

  async createPayment(req: CreatePaymentRequest) {
    const r = await this.call('register.do', {
      orderNumber: req.paymentId,
      amount: req.amountMinor,
      currency: 643,
      returnUrl: req.returnUrl,
      failUrl: req.returnUrl,
      description: req.description.slice(0, 99),
      language: 'ru',
      sessionTimeoutSecs: this.cfg.sessionTimeoutSecs,
      email: req.receipt.customer.email ?? undefined,
      phone: req.receipt.customer.phone?.replace(/\D/g, '') || undefined,
      dynamicCallbackUrl: this.cfg.callbackUrl,
    });
    if (!SberProvider.failed(r) && r.orderId && r.formUrl) {
      return { providerPaymentId: String(r.orderId), confirmationUrl: String(r.formUrl), status: 'pending' as const };
    }
    // Заказ с таким номером уже зарегистрирован (повтор после сбоя связи): берём его из банка
    if (String(r.errorCode) === '1') {
      const s = await this.call('getOrderStatusExtended.do', { orderNumber: req.paymentId });
      if (!SberProvider.failed(s) && s.orderId) {
        return { providerPaymentId: String(s.orderId), confirmationUrl: String(r.formUrl ?? ''), status: SberProvider.mapStatus(s.orderStatus) };
      }
    }
    throw new Error(`Сбер register.do: ${r.errorCode} ${r.errorMessage ?? ''}`.trim());
  }

  /** orderStatus: 0 зарегистрирован, 1 сумма захолдирована, 2 оплачен, 3 отменён, 4 возвращён, 5 идёт 3-D Secure, 6 отклонён */
  static mapStatus(orderStatus: unknown): ProviderStatus {
    switch (Number(orderStatus)) {
      case 2:
      case 4: // возврат учитывается отдельно, сам платёж был проведён
        return 'succeeded';
      case 3:
        return 'cancelled';
      case 6:
        return 'failed';
      default:
        return 'pending';
    }
  }

  async fetchStatus(providerPaymentId: string): Promise<ProviderStatus> {
    const r = await this.call('getOrderStatusExtended.do', { orderId: providerPaymentId });
    if (SberProvider.failed(r)) throw new Error(`Сбер getOrderStatusExtended.do: ${r.errorCode} ${r.errorMessage ?? ''}`.trim());
    return SberProvider.mapStatus(r.orderStatus);
  }

  /** Неоплаченный заказ закрывается в банке; если не вышло, он истечёт сам по sessionTimeoutSecs. */
  async cancel(providerPaymentId: string) {
    await this.call('decline.do', { orderId: providerPaymentId }).catch(() => undefined);
  }

  async refund(req: { providerPaymentId: string; amountMinor: number; idempotencyKey: string }) {
    const r = await this.call('refund.do', { orderId: req.providerPaymentId, amount: req.amountMinor });
    if (SberProvider.failed(r)) return { providerRefundId: '', status: 'failed' as const };
    return { providerRefundId: `${req.providerPaymentId}:${req.idempotencyKey}`, status: 'succeeded' as const };
  }

  /** Контрольная сумма: параметры без checksum и sign_alias, по алфавиту, «имя;значение;», HMAC-SHA256 в hex. */
  static checksum(params: Record<string, string>, secret: string) {
    const data = Object.keys(params)
      .filter((k) => k !== 'checksum' && k !== 'sign_alias')
      .sort()
      .map((k) => `${k};${params[k]};`)
      .join('');
    return createHmac('sha256', secret).update(data).digest('hex').toUpperCase();
  }

  /**
   * Уведомление приходит параметрами запроса (GET) или формой (POST): mdOrder, orderNumber, operation, status, checksum.
   * Контроллер передаёт сюда строку параметров. Статус из уведомления не используется: его перепроверяет fetchStatus.
   */
  parseWebhook(_headers: Record<string, string | undefined>, rawBody: Buffer): WebhookEvent | null {
    const params = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
    if (!params.mdOrder || !params.operation) return null;
    if (this.cfg.callbackSecret) {
      const got = (params.checksum ?? '').toUpperCase();
      const want = SberProvider.checksum(params, this.cfg.callbackSecret);
      if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return null;
    }
    return { eventId: `${params.mdOrder}:${params.operation}:${params.status ?? ''}`, providerPaymentId: params.mdOrder, type: params.operation };
  }
}
