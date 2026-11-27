# Knowledge base

One file per lesson, written by the migration agent **after** a human has triaged the harness
result. The next feature's migration reads every entry before it starts and says which ones it
applied.

File name: `knowledge/<slug>.md`. Format:

```
---
title: <one line>
scope: <domain or platform area>
source: run <nnn>, feature <name>, triage by <human>
---
Rule: <one or two sentences, stated as a rule>
Why: <what went wrong or what was unclear>
Check: <how the harness or a test proves it>
```

Rules:

- A lesson states a rule that holds beyond the feature it came from, not a description of a fix.
- `Check` names a real harness check or test (file and test name), so the rule stays enforced.
- Entries are only added after triage. They are never edited to make a later run look better.
