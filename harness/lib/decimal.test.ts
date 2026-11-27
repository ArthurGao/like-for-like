import { describe, expect, it } from 'vitest';
import { equal, format, isDecimalText, normalize, parse, sum } from './decimal.ts';

describe('decimal', () => {
  it('treats different spellings of the same value as equal', () => {
    expect(equal('8.5', '8.50')).toBe(true);
    expect(equal('8.50', '8.51')).toBe(false);
    expect(normalize('007.250000')).toBe('7.25');
    expect(normalize('3')).toBe('3.00');
  });

  it('sums without floating-point error', () => {
    expect(sum(['0.1', '0.2'])).toBe('0.30');
    expect(sum(Array.from({ length: 1000 }, () => '0.01'))).toBe('10.00');
    expect(sum([])).toBe('0.00');
  });

  it('keeps sub-cent precision and the sign', () => {
    expect(format(parse('-197.925'))).toBe('-197.925');
  });

  it('rejects numbers and malformed text', () => {
    expect(isDecimalText(8.5)).toBe(false);
    expect(isDecimalText('8,50')).toBe(false);
    expect(isDecimalText('1e3')).toBe(false);
    expect(() => parse('abc')).toThrow('not a decimal');
    expect(() => parse('1.0000001')).toThrow('more than 6 decimal places');
  });
});
