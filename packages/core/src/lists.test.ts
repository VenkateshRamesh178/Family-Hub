import { describe, expect, it } from 'vitest';
import { daysBetween, purchasedItemInputSchema, todayIso, warrantyAlerts, warrantyStatus } from './lists';

describe('warrantyStatus', () => {
  const today = '2026-10-03';
  const w = (date: string | null, has = true) => ({ hasWarranty: has, warrantyExpiryDate: date });

  it('is none without a warranty', () => {
    expect(warrantyStatus(w(null, false), today)).toBe('none');
    expect(warrantyStatus(w('2026-10-04', false), today)).toBe('none');
  });

  it('counts the expiry day itself as still covered', () => {
    expect(warrantyStatus(w('2026-10-03'), today)).toBe('expiring');
    expect(warrantyStatus(w('2026-10-02'), today)).toBe('expired');
  });

  it('uses the window', () => {
    expect(warrantyStatus(w('2026-12-02'), today, 60)).toBe('expiring');
    expect(warrantyStatus(w('2026-12-03'), today, 60)).toBe('active');
    expect(warrantyStatus(w('2026-12-03'), today, 90)).toBe('expiring');
  });
});

describe('warrantyAlerts', () => {
  it('returns expired and expiring items, soonest first', () => {
    const items = [
      { id: 'far', hasWarranty: true, warrantyExpiryDate: '2028-01-01' },
      { id: 'soon', hasWarranty: true, warrantyExpiryDate: '2026-10-20' },
      { id: 'none', hasWarranty: false, warrantyExpiryDate: null },
      { id: 'past', hasWarranty: true, warrantyExpiryDate: '2026-09-01' },
    ];
    const alerts = warrantyAlerts(items, '2026-10-03');
    expect(alerts.map((a) => [a.id, a.status, a.daysLeft])).toEqual([
      ['past', 'expired', -32],
      ['soon', 'expiring', 17],
    ]);
  });
});

describe('dates', () => {
  it('daysBetween crosses DST and month ends', () => {
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
    expect(daysBetween('2026-10-03', '2026-10-01')).toBe(-2);
  });

  it('todayIso uses local date parts', () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('purchasedItemInputSchema', () => {
  const base = { itemName: 'Fridge', boughtDate: '2026-03-10', hasWarranty: false };

  it('requires an expiry date when there is a warranty', () => {
    const r = purchasedItemInputSchema.safeParse({ ...base, hasWarranty: true });
    expect(r.success).toBe(false);
    expect(purchasedItemInputSchema.safeParse({ ...base, hasWarranty: true, warrantyExpiryDate: '2028-03-10' }).success).toBe(true);
  });

  it('only accepts http(s) links', () => {
    expect(purchasedItemInputSchema.safeParse({ ...base, purchaseLink: 'javascript:alert(1)' }).success).toBe(false);
    expect(purchasedItemInputSchema.safeParse({ ...base, purchaseLink: 'https://shop.example' }).success).toBe(true);
    expect(purchasedItemInputSchema.safeParse({ ...base, purchaseLink: '' }).success).toBe(true);
  });
});
