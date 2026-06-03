---
'@electric-ax/agents-runtime': patch
---

Promote `skills/types` to a first-class tsdown entry so its `.d.ts` is a stable
named output, avoiding an intermittent dts generation failure under CI's
parallel build.
