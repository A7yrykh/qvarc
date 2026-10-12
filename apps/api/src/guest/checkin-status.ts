/**
 * Статусы онлайн-заселения и условия выдачи кода от двери.
 * Чистые функции без обращения к базе: одинаково применяются в приложении гостя и в админке.
 */
export const CHECKIN_STATUSES = [
  'booking_confirmed', //        бронь подтверждена, регистрация ещё не открыта
  'registration_not_started',
  'registration_in_progress',
  'admin_approval_required',
  'awaiting_payment',
  'registration_completed',
  'ready_for_checkin', //        номер готов к заселению
  'access_granted', //           код от двери выдан
  'checked_in',
  'stay_completed',
  'cancelled',
] as const;
export type CheckinStatus = (typeof CHECKIN_STATUSES)[number];

export const CHECKIN_STATUS_LABELS: Record<CheckinStatus, string> = {
  booking_confirmed: 'Бронирование подтверждено',
  registration_not_started: 'Регистрация не начата',
  registration_in_progress: 'Регистрация в процессе',
  admin_approval_required: 'Требуется подтверждение администрации',
  awaiting_payment: 'Ожидается оплата',
  registration_completed: 'Регистрация завершена',
  ready_for_checkin: 'Номер готов к заселению',
  access_granted: 'Доступ разрешён',
  checked_in: 'Гость заселён',
  stay_completed: 'Проживание завершено',
  cancelled: 'Бронирование отменено',
};

export interface StayFacts {
  now: Date;
  /** active: confirmed или checked_in; pending: ещё не подтверждена (ждёт оплаты или решения) */
  bookingState: 'active' | 'pending' | 'cancelled' | 'finished';
  arrivalAt: Date;
  departureAt: Date;
  registrationOpensAt: Date;
  balanceDue: number;
  paymentRequiredBeforeAccess: boolean;
  documentsRequired: boolean;
  unitId: string | null;
  checkedInAt: Date | null;
  checkedOutAt: Date | null;
  hasActiveAccess: boolean;
  hasAccessDevice: boolean;
  record: null | {
    guestsSubmittedAt: Date | null;
    documentsSubmittedAt: Date | null;
    rulesAcceptedAt: Date | null;
    consentAt: Date | null;
    adminApprovalRequired: boolean;
    adminApprovedAt: Date | null;
    completedAt: Date | null;
    unitReadyAt: Date | null;
  };
}

const paymentOk = (f: StayFacts) => !f.paymentRequiredBeforeAccess || f.balanceDue <= 0;
const documentsOk = (f: StayFacts) => !f.documentsRequired || !!f.record?.documentsSubmittedAt;
const approvalOk = (f: StayFacts) => !f.record?.adminApprovalRequired || !!f.record.adminApprovedAt;

/** Все условия регистрации выполнены: её можно отметить завершённой. */
export function registrationCanComplete(f: StayFacts): boolean {
  const r = f.record;
  return !!r && !!r.guestsSubmittedAt && documentsOk(f) && !!r.rulesAcceptedAt && !!r.consentAt && approvalOk(f) && paymentOk(f);
}

export function computeCheckinStatus(f: StayFacts): CheckinStatus {
  if (f.bookingState === 'cancelled') return 'cancelled';
  if (f.checkedOutAt || f.bookingState === 'finished') return 'stay_completed';
  if (f.checkedInAt) return 'checked_in';
  if (f.hasActiveAccess) return 'access_granted';
  const r = f.record;
  if (r?.completedAt) return f.unitId && r.unitReadyAt ? 'ready_for_checkin' : 'registration_completed';
  if (r && r.guestsSubmittedAt && documentsOk(f) && r.rulesAcceptedAt && r.consentAt) {
    if (!approvalOk(f)) return 'admin_approval_required';
    if (!paymentOk(f)) return 'awaiting_payment';
    return 'registration_completed';
  }
  if (r?.adminApprovalRequired && !r.adminApprovedAt) return 'admin_approval_required';
  if (r) return 'registration_in_progress';
  if (f.bookingState === 'active' && f.now >= f.registrationOpensAt) return 'registration_not_started';
  return 'booking_confirmed';
}

export type AccessBlocker =
  | 'booking_not_confirmed'
  | 'booking_cancelled'
  | 'registration_incomplete'
  | 'payment_required'
  | 'unit_not_assigned'
  | 'unit_not_ready'
  | 'no_access_device'
  | 'stay_finished';

export const ACCESS_BLOCKER_LABELS: Record<AccessBlocker, string> = {
  booking_not_confirmed: 'Бронирование ещё не подтверждено',
  booking_cancelled: 'Бронирование отменено',
  registration_incomplete: 'Завершите онлайн-регистрацию',
  payment_required: 'Оплатите остаток стоимости проживания',
  unit_not_assigned: 'Администратор ещё не назначил номер',
  unit_not_ready: 'Номер ещё готовится к заселению',
  no_access_device: 'В этом номере нет электронного замка, ключ выдаст администратор',
  stay_finished: 'Проживание завершено',
};

/** Условия выдачи кода от двери. Код не выдаётся, пока список не пуст. */
export function accessBlockers(f: StayFacts): AccessBlocker[] {
  const b: AccessBlocker[] = [];
  if (f.bookingState === 'cancelled') b.push('booking_cancelled');
  if (f.bookingState === 'pending') b.push('booking_not_confirmed');
  if (f.bookingState === 'finished' || f.checkedOutAt || f.now >= f.departureAt) b.push('stay_finished');
  if (!f.record?.completedAt) b.push('registration_incomplete');
  if (!paymentOk(f)) b.push('payment_required');
  if (!f.unitId) b.push('unit_not_assigned');
  else if (!f.record?.unitReadyAt) b.push('unit_not_ready');
  if (f.unitId && !f.hasAccessDevice) b.push('no_access_device');
  return b;
}
