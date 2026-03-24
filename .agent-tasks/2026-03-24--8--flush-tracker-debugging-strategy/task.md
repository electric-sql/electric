# Task: FlushTracker Production Debugging Strategy

## Issue
GitHub issue: electric-sql/alco-agent-tasks#8
Related: electric-sql/electric#3980, electric-sql/electric#4013

## Context
FlushTracker can get stuck waiting for notifications from consumers that have died out-of-band.
PR #4011 fixed the most obvious cause (ShapeLogCollector adding dead consumers), but production
incidents continue. Two customers have experienced this, neither with subqueries enabled. One has
`suspend_consumers` enabled.

## Objective
Propose a comprehensive data gathering strategy: what tracing functions, process messages, ETS tables,
and other runtime data to capture in production to definitively identify the specific condition causing
the stuck state.

## Deliverables
1. Analysis of production state dumps from two affected customers
2. Synthesis with previous investigation findings
3. Detailed strategy document for production data gathering
4. PR with the strategy document
