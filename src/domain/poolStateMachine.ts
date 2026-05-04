import type { PoolStatus } from './types.js';

const allowedTransitions = new Map<PoolStatus, PoolStatus[]>([
  ['open', ['ready', 'cancelled', 'expired']],
  ['ready', ['assigned', 'cancelled']],
  ['assigned', ['arrival_requested', 'ready', 'cancelled']],
  ['arrival_requested', ['in_progress', 'assigned', 'ready']],
  ['in_progress', ['completed', 'cancelled']],
  ['cancelled', []],
  ['expired', []],
  ['completed', []]
]);

export function canTransitionPool(from: PoolStatus, to: PoolStatus): boolean {
  return allowedTransitions.get(from)?.includes(to) ?? false;
}

export function assertPoolTransition(from: PoolStatus, to: PoolStatus): void {
  if (!canTransitionPool(from, to)) {
    throw new Error(`Invalid pool transition: ${from} -> ${to}`);
  }
}

export function explainBlockedTransition(status: PoolStatus): string {
  if (status === 'completed') {
    return 'This ride is already completed.';
  }

  if (status === 'cancelled' || status === 'expired') {
    return 'This ride is no longer active.';
  }

  return 'This action is no longer available for this ride.';
}
