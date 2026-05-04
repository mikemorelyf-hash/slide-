import { describe, expect, it } from 'vitest';

import {
  assertPoolTransition,
  canTransitionPool,
  explainBlockedTransition
} from '../src/domain/poolStateMachine.js';
import type { PoolStatus } from '../src/domain/types.js';

describe('pool state machine', () => {
  const allowedTransitions: Array<[PoolStatus, PoolStatus]> = [
    ['open', 'ready'],
    ['open', 'cancelled'],
    ['open', 'expired'],
    ['ready', 'assigned'],
    ['ready', 'cancelled'],
    ['assigned', 'arrival_requested'],
    ['assigned', 'ready'],
    ['assigned', 'cancelled'],
    ['arrival_requested', 'in_progress'],
    ['arrival_requested', 'assigned'],
    ['arrival_requested', 'ready'],
    ['in_progress', 'completed'],
    ['in_progress', 'cancelled']
  ];

  it.each(allowedTransitions)('allows %s -> %s', (from, to) => {
    expect(canTransitionPool(from, to)).toBe(true);
    expect(() => assertPoolTransition(from, to)).not.toThrow();
  });

  it('blocks stale old-button transitions', () => {
    expect(canTransitionPool('completed', 'ready')).toBe(false);
    expect(() => assertPoolTransition('completed', 'ready')).toThrow('Invalid pool transition');
  });

  it('returns user-safe stale action explanations', () => {
    expect(explainBlockedTransition('completed')).toBe('This ride is already completed.');
    expect(explainBlockedTransition('cancelled')).toBe('This ride is no longer active.');
    expect(explainBlockedTransition('expired')).toBe('This ride is no longer active.');
  });
});
