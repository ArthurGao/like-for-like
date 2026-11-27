---
title: Round in the smallest integer unit, one rounding per stated rule, ties toward +infinity
scope: money and hours arithmetic
source: runs 001-002, feature timesheet, lesson by the migration agent, recorded after the triage of run 001 by the builder session (Claude) on behalf of the owner
---
Rule: Do money and hour arithmetic on BigInt in the smallest exact unit (milliseconds, quarter hours, cents), with one explicit half-up rounding (`floor((2n + d) / 2d)`) at each rounding step the brief states, in its order. For timesheets, round paid time to the quarter first, then multiply the rounded quarters by the rate in cents and round to the cent. Format with exactly two decimals ("8.00").
Why: The brief states two roundings in order (paid hours, then pay), and with that order and integer arithmetic the legacy totals matched to the cent across 914 shifts. Exact half-cent ties are common with quarter hours and two-decimal rates (7.25 h × 25.10 = 181.975 → 181.98). A float product, or a rounding that sends ties toward zero or to even, misses by a cent.
Check: `features/timesheet/calc.test.ts`, describes "computePay: rounding paid hours to the quarter (rule 4)" and "computePay: gross pay to the cent (rule 5)"; harness `totals` and `records` checks (hours and gross per tenant and per shift).
