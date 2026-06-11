---
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents-runtime': patch
---

Show only uncached input tokens in the per-response token usage label.

The input side previously summed `input + cacheRead + cacheWrite`, so
on warm-cache turns the meta row re-counted the entire conversation on
every step and ballooned into a cumulative number that said nothing
about the work the response actually did. The adapter now surfaces the
uncached side only — fresh prompt tokens plus cache writes, with
prompt-cache reads excluded. (`cacheWrite` is counted because
cache-enabled providers report newly appended prompt tokens there,
with `input` collapsing to ~0.)

Steps recorded before this change keep their stored cache-inclusive
totals — both step fields are optional and the display just sums
what's persisted, so no migration is needed.
