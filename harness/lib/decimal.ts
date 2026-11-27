// Exact decimal handling for comparisons and totals. Never goes through floating point.
const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);
const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

export const isDecimalText = (s: unknown): s is string => typeof s === 'string' && DECIMAL_RE.test(s);

/** Parse decimal text into an integer of millionths. Throws on more than 6 decimal places. */
export function parse(s: string): bigint {
  const m = DECIMAL_RE.exec(s.trim());
  if (!m) throw new Error(`not a decimal: ${JSON.stringify(s)}`);
  const [, sign, whole, frac = ''] = m;
  if (frac.length > SCALE) throw new Error(`more than ${SCALE} decimal places: ${s}`);
  const v = BigInt(whole!) * FACTOR + BigInt(frac.padEnd(SCALE, '0'));
  return sign ? -v : v;
}

/** Format millionths with at least two decimal places and no trailing zeros beyond that. */
export function format(v: bigint): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = abs / FACTOR;
  let frac = (abs % FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '');
  frac = frac.padEnd(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

export const normalize = (s: string) => format(parse(s));
export const equal = (a: string, b: string) => parse(a) === parse(b);
export const sum = (xs: readonly string[]) => format(xs.reduce((acc, x) => acc + parse(x), 0n));
