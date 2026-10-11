import { daysBetween, expiryStatus, warrantyStatus, type PurchasedItem } from '@family-hub/core';
import { formatDate, relativeDays } from '../lib/dates';
import { Badge } from './ui';

export function DueBadge({ due, today, done = false }: { due: string; today: string; done?: boolean }) {
  const left = daysBetween(today, due);
  const tone = done ? 'neutral' : left < 0 ? 'bad' : left <= 1 ? 'warn' : 'neutral';
  return (
    <Badge tone={tone} title={formatDate(due)}>
      {left < 0 && !done ? `Overdue · ${formatDate(due)}` : Math.abs(left) <= 7 ? relativeDays(due, today) : formatDate(due)}
    </Badge>
  );
}

export function ExpiryBadge({ expiryDate, today }: { expiryDate: string | null; today: string }) {
  const status = expiryStatus(expiryDate, today);
  if (status === 'none' || !expiryDate) return null;
  const until = formatDate(expiryDate);
  if (status === 'expired') return <Badge tone="bad">Expired {until}</Badge>;
  if (status === 'expiring') {
    const left = daysBetween(today, expiryDate);
    return <Badge tone="warn">Expires {left === 0 ? 'today' : `in ${left} days`}</Badge>;
  }
  return <Badge>Valid until {until}</Badge>;
}

export function WarrantyBadge({ item, today }: { item: PurchasedItem; today: string }) {
  const status = warrantyStatus(item, today);
  if (status === 'none' || !item.warrantyExpiryDate) return <Badge>No warranty</Badge>;
  const until = formatDate(item.warrantyExpiryDate);
  if (status === 'expired') return <Badge tone="bad">Warranty expired {until}</Badge>;
  if (status === 'expiring') {
    const left = daysBetween(today, item.warrantyExpiryDate);
    return <Badge tone="warn">Warranty ends {left === 0 ? 'today' : `in ${left} days`}</Badge>;
  }
  return <Badge tone="ok">Warranty until {until}</Badge>;
}
