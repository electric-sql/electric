---
title: "Amdahl's Law for AI Agents"
description: >-
  The maximum speedup from AI agents is bounded by the fraction of the workflow that requires human judgment. The highest-leverage investment isn't making agents faster — it's making every human intervention self-liquidating.
excerpt: >-
  If 10% of your work is inherently serial, you will never exceed 10x speedup. The question isn't "how smart is your agent?" — it's "when a human touches your system, does it learn something that makes the next touch unnecessary?"
authors: [kyle]
image: /img/blog/amdahls-law-for-ai-agents/header.jpg
tags: [agentic, AI, development]
outline: [2, 3]
post: true
---

The hot question in AI right now is "how many agents can you run in parallel?" Geoffrey Huntley's [Ralph Loop](https://ghuntley.com/loop/) runs autonomous coding agents in a while-loop until every PRD item is complete. Steve Yegge's [Gas Town](https://steve-yegge.medium.com/welcome-to-gas-town-4f25ee16dd04) orchestrates 20-30 concurrent agents across seven specialized roles, like "Kubernetes mated with Temporal" for agent swarms. Cursor ships an 8-agent parallel system. Tools like Claude Squad and Vibe Kanban exist specifically to orchestrate parallel agents in isolated git worktrees. The pitch is intuitive: if one agent makes you 2x more productive, five agents should make you 10x.

But practitioners are pushing back. Flask creator Armin Ronacher: "I sometimes kick off parallel agents, but not as much as I used to do. The thing is: it's only so much my mind can review!" Throughput gains are real but sublinear, and there's a hard ceiling. The reason has been well understood since 1967.

## The Original Insight

In 1967, Gene Amdahl made a deceptively simple observation about parallel computing: the speedup of a program is limited by the fraction that must run sequentially.

His formula: **speedup = 1 / (S + (1-S)/N)**

Where S is the serial fraction and N is the number of parallel processors. The key insight isn't in the formula — it's in the limit. As N approaches infinity, speedup converges to 1/S. If 10% of your work is inherently serial, you will never exceed 10x speedup. Not with 100 cores. Not with a million.

This was heresy in the "just add more processors" era. It's heresy again now, in the "just add more agents" era.

## The Agent Version

The equivalent law for AI agents:

> **The maximum speedup from AI agents is bounded by 1/H, where H is the fraction of the workflow that requires human judgment.**

H includes every moment the system blocks on a human: clarifying intent ("Did you mean the admin dashboard or the user-facing one?"), making judgment calls ("Should we refund this customer or offer credit?"), review cycles ("This isn't quite what I wanted, try again"), approval gates, resolving ambiguity ("The policy says 'handle escalations appropriately' — what does that mean?"), and applying taste ("This is technically correct but feels wrong").

If H = 40% of your total workflow time, no improvement in agent capability can ever get you past 2.5x speedup. At 50%, the ceiling is 2x. Even an optimistic 20% only gets you to 5x.

| Human fraction (H) | Max possible speedup |
|---|---|
| 50% | 2x |
| 30% | 3.3x |
| 20% | 5x |
| 10% | 10x |
| 5%  | 20x |

**H dominates the speedup equation, not agent capability.** In practice, H is a composite of different types of human involvement — verification, clarification, specification, taste, novel decisions — each with different costs and different reduction dynamics. But the bounding relationship holds regardless of how you decompose it.

## Self-Liquidating H

The highest-leverage investment isn't making agents faster or smarter. It's changing the character of H.

The goal isn't to minimize human involvement. It's to make it **self-liquidating**: every human intervention should produce the artifact — the test, the spec update, the documented decision — that makes the same type of intervention unnecessary next time. (The term comes from finance: a self-liquidating loan generates the revenue to pay itself off. A self-liquidating intervention generates the artifact that eliminates its own recurrence.)

The conformance suite that makes human review unnecessary didn't appear from nothing. It's **crystallized cognition** — hard-won knowledge compressed into executable form so agents don't have to rediscover it. Each test case is a past human judgment about correctness, encoded at the moment it was made. The AGENTS.md file that prevents agents from re-discovering gotchas is the same thing. Every good piece of scaffolding is human judgment captured at the moment it occurred.

A team where 40% of workflow time is human but it's all taste and strategy is in a fundamentally different position than a team where 40% is human but it's all "did you mean X or Y?" and "let me re-check this output." Self-liquidating practices convert the second type into the first.

How do you decide which human involvement to eliminate? You don't need a theory of what's "friction" vs. what's "valuable." You need a simpler question: **"Is this intervention encodable?"** When a human catches a bug, can that catch become a test case? When a human clarifies an ambiguity, can that clarification update the spec? When a human makes a taste call, can that call become a documented precedent? "Is this encodable?" is a concrete engineering question, not an epistemological one. And it has a built-in test: if agents keep requiring the same type of human intervention, your [configurancy](https://electric-sql.com/blog/2026/02/02/configurancy) layer (the explicit, machine-readable self-knowledge of a system) is incomplete.

Three levers make this practical:

1. **Make human-in-the-loop moments efficient.** A human review that takes 30 seconds because the conformance suite already verified correctness is very different from a 2-hour review where you're reverse-engineering what the agent did and why.
2. **Capture the signal.** When a human intervenes — catching a bug, clarifying a spec, making a taste call — the system should generate the artifact that encodes that intervention. A review that catches a bug but doesn't update the test suite is wasted signal. A clarification that doesn't update the spec will recur. Think of each human review step as a sensor: it exists not just to catch issues, but to detect gaps in the system's self-knowledge. Every detection should close the gap it found.
3. **Maintain high configurancy so agents operate autonomously everywhere else.** When the system's knowledge is explicit — specs, invariants, conformance suites, documented rationale — agents don't block on humans for things that could have been encoded upfront.

## Accumulate, Then Compress

Capturing is only half the cycle. Naively appending every intervention creates its own problem — an AGENTS.md that's 400 lines of contradictory gotchas nobody reads, a test suite full of overlapping cases that encode conflicting assumptions. Raw accumulation creates noise, not knowledge.

The real pattern is **accumulate, then compress**: individual judgments pile up, then periodically get integrated into coherent higher-level artifacts. Common law accumulates individual case decisions, then periodically synthesizes them into principles and statutes. Science accumulates individual papers, then compresses them into review articles and textbooks.

In practice, the self-liquidation cycle has two phases: accumulate (capture every intervention as a local artifact — a test case, an AGENTS.md entry, a decision record) and compress (periodically integrate those local artifacts into higher-level configurancy — updated specs, refactored test suites, revised skills). Teams that only accumulate end up with drift and contradiction. Teams that only try to compress end up over-engineering upfront. The cycle needs both.

Now, an important caveat about the Amdahl's analogy. In the original formulation, the serial fraction S is a property of the algorithm, fixed regardless of processor speed. H isn't quite like that. Better models *do* shrink some components of H. An agent that needs less clarification and makes fewer errors directly reduces human time.

But the components of H that models reduce aren't the ones that dominate at scale. Model improvements shrink clarification and some verification. Taste and novel-decision H — the components that become dominant once you've automated the mechanical parts — are largely irreducible. Meanwhile, the self-liquidation mechanism targets exactly the right components: verification is highly encodable (catches become test cases), clarification is highly encodable (resolutions become spec updates), specification is partially encodable (patterns become reusable templates). Taste and novel decisions are the least encodable — which is fine, because they're the components where human judgment genuinely creates value. The system naturally converges toward a state where humans do only the work that can't be encoded, because everything encodable has been.

**Agent scaffolding is the serial code optimization of the AI era.** It concentrates human time where it has maximum leverage, and captures the signal from every intervention as durable knowledge the system can reuse.

## What Scaffolding Looks Like

"Scaffolding" sounds abstract. It isn't. It's what I've been calling [configurancy](https://electric-sql.com/blog/2026/02/02/configurancy):

> *Configurancy is the smallest set of explicit behavioral commitments (and rationales) that allow a bounded agent to safely modify the system without rediscovering invariants.*

Specs, invariants, conformance suites, documented rationale. The contracts that let a bounded agent — human or AI — act coherently without holding the entire system in its head. **Every implicit assumption in your system is a future human-blocking event.** When an agent encounters something it can't verify against an explicit contract, it has two choices: guess (and risk breaking things) or ask a human (and block).

The examples are concrete. At ElectricSQL, an agent recently propagated a protocol change through 67 files — the spec, two server implementations, 10 client libraries across 10 languages — in 20-30 minutes. No human reviewed 67 files. The conformance suite *is* the review. Without it, that's hours of careful manual review across 10 languages. With it, I spent a few minutes reviewing the PR. The suite didn't appear from nothing. It's the accumulated output of human decisions about what "correct behavior" means, each one encoded as a test case at the moment it was made. The human designed the protocol change; the suite automated everything downstream. And each new decision about correctness becomes another test case, making the next change even more autonomous.

Emil Stenström built a complete HTML5 parser with agents by hooking in the html5lib-tests conformance suite from the start. Then Simon Willison ported it to JavaScript in 4.5 hours by pointing a *different* agent at the *same* suite. The conformance suite made human review unnecessary because the spec was already encoded as executable verification.

The model handles the task; the configurancy handles the trust. Together they compound.

Teams that treat agent deployment as "pick a model and write some prompts" plateau quickly. They haven't touched H. The teams seeing real speedup have invested heavily in the scaffolding layer — often spending more engineering effort on configurancy than on the agent integration itself.

## The Perception Shift

As agents get faster, **H *feels* like it's growing.**

When an agent takes 2 hours to research a topic and you spend 30 minutes reviewing its output, that 30 minutes is background noise. When the agent takes 30 seconds and you still spend 30 minutes reviewing, suddenly *you* are the bottleneck. The absolute time hasn't changed, but the relative weight has shifted dramatically.

People often report feeling *busier* when using agents, even as their throughput increases. The human work becomes more concentrated and more visible. You're never waiting anymore — which means you're always the one being waited on.

## The Multi-Agent Trap

Amdahl's Law tells you there's a ceiling. Donald Reinertsen's *[The Principles of Product Development Flow](https://www.amazon.com/Principles-Product-Development-Flow-Generation/dp/1935401009)* tells you something worse: **adding parallel agents can actively degrade performance.**

Reinertsen applied queueing theory to product development and showed that capacity utilization increases queue size exponentially. At 50% utilization, the queue is manageable. At 80%, it's 4x larger. At 90%, 9x. At 95%, 19x.

Think about what happens when you spin up five agents in parallel. The human is a single server in a queue. Every agent output that needs review, approval, or clarification is a job arriving at that queue. Five parallel agents don't reduce H — they *increase the arrival rate* at the human queue, driving utilization toward 100% and queue times toward infinity.

Gas Town is the most vivid illustration. Yegge describes "palpable stress" as 20-30 agents run simultaneously at speeds too fast to comprehend. Early users describe their role as "keep your Tamagotchi alive" and note that "your management span of control is directly correlated to your attention span and memory." One user went from 5 PRs in 3 hours to 36 PRs in 4 hours — but at $100/hour in Claude tokens and with intense, unbroken cognitive engagement. The throughput is real, but so is the human queue saturation.

More agents don't solve a human bottleneck. They amplify it.

Reinertsen's prescription: manage queue size directly — WIP limits, smaller batch sizes, faster feedback loops — rather than maximizing utilization. The agent equivalent: don't maximize the number of parallel agents. **Eliminate the friction that causes agents to block on humans in the first place** — invest in scaffolding that lets agents verify their own work, so that when they do need a human, it's for judgment that actually matters.

The Ralph Loop gets this right. It works not because it runs agents in parallel but because it's a self-liquidation engine: a well-defined PRD as the spec, automated test verification as the acceptance criteria, and AGENTS.md files that accumulate discovered patterns across iterations. Each iteration where a human corrects an agent crystallizes that correction as cognition the next iteration can consume. The same pattern shows up at every scale. [shadcn](https://x.com/shadcn/status/2023812711151259772) describes running a `/done` skill after every agent session that dumps key decisions, questions, and follow-ups into a markdown file tagged with the session ID and branch name. Every session's human context becomes a durable artifact the next session can consume. The intervention encoded itself.

## Where the Value Accrues

The metric that makes this concrete: **recurrence rate.** How often does the same type of human intervention happen twice? If a human catches a class of bug that the conformance suite missed, does that catch become a new test case — or does the same class of bug require human review again next month? If a human clarifies an ambiguous spec, does that clarification update the spec — or does the next agent hit the same ambiguity?

Declining recurrence means your system is learning. Flat recurrence means you're paying the same human tax repeatedly. This is the same logic behind Toyota's defect tracking: every defect triggers root cause analysis and a process change that prevents recurrence. The metric isn't "how many defects did we find?" — it's "is the same type of defect happening less often?"

And there's a compounding effect. The core thesis from [configurancy](https://electric-sql.com/blog/2026/02/02/configurancy): **AI makes code cheap; therefore the scarce asset is the system's self-knowledge.** Specifications, conformance suites, and documented invariants were always valuable but expensive to maintain. Agents flip this calculus. They make maintaining explicit contracts cheap — write a spec change, agents propagate it through implementations, conformance suites verify correctness. The very thing that reduces H has itself become cheaper to produce.

We're entering a flywheel: agents make it cheap to crystallize human judgment as durable artifacts → crystallized cognition reduces future human interventions → fewer recurring interventions means agents deliver more value per cycle → which justifies more agent investment. The teams that recognize this early will compound their way to genuine 10x while everyone else argues about which model to use.

## The Real Question

Amdahl's Law doesn't say parallelism is useless. It tells you where to focus.

The question isn't "how smart is your agent?" or "how many agents can I run?" It's: **"when a human touches my system, does the system learn something that makes the next touch unnecessary?"**

If you're verification-bound (spending most human time checking agent output), invest in conformance suites and oracles. If you're clarification-bound (agents keep asking what you meant), invest in explicit specs and contracts. If you're specification-bound (you know what you want but it takes forever to express), invest in skills, templates, and reusable configurancy. And if you're taste-bound (the agent's output is technically correct but not *right*), that's the kind of human involvement that deserves to stay human. That's where your judgment creates value.

Most teams spend the majority of their human time on friction, not judgment. And most of that friction is recurring — the same interventions, over and over, because nobody encoded the signal from the last one.

Design your system so that every time a human touches agent output, it produces the artifact that makes the next touch unnecessary. The scaffolding is never done. The speedup follows.
