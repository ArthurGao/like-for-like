import { describe, expect, it } from 'vitest';
import { sumMoney } from './active-employees.ts';

describe('sumMoney', () => {
  it('adds amounts exactly to the cent', () => {
    expect(sumMoney(['0.10', '0.20'])).toBe('0.30');
    expect(sumMoney(['25.10', '30.05', '19.99'])).toBe('75.14');
  });

  it('returns 0.00 for no amounts and keeps the sign', () => {
    expect(sumMoney([])).toBe('0.00');
    expect(sumMoney(['-1.25', '0.50'])).toBe('-0.75');
  });

  it('refuses amounts that are not two-decimal text', () => {
    expect(() => sumMoney(['1.5'])).toThrow('not a money amount: 1.5');
  });
});
