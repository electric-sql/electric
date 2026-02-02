---
title: 'Configurancy: Keeping Systems Intelligible When Agents Write All the Code'
description: >-
  Formal specifications become tractable when agents handle the propagation. Configurancy is the shared intelligibility layer that lets multiple bounded agents—human and AI—coherently co-evolve a system.
excerpt: >-
  What changed isn't the principle—it's the economics. Agents can propagate spec changes through implementations at machine speed. Conformance suites verify correctness. The spec becomes the source of truth again.
authors: [kyle]
image: /img/blog/configurancy/hero.png
tags: [agentic, AI, development]
outline: [2, 3]
post: true
---

Last week we [simplified SSE binary handling](https://github.com/durable-streams/durable-streams/pull/231) in durable-streams. The change: remove a query parameter, have servers auto-detect binary content types, signal via response header.

The PR touched **67 files**: protocol spec, both servers (TypeScript + Go), all 10 client implementations across 10 languages, and conformance tests. One agent propagated the change through the entire stack in 20-30 minutes. Every implementation now handles the new behavior correctly—verified by the conformance suite.

This would have taken days manually. **Formal specifications become tractable when agents handle the propagation**.

We've always known specifications, types, and contracts were valuable. But specs cost too much to write and more to maintain. So we invested sparingly, specs drifted, and eventually we just read the code.

What changed isn't the principle—it's the economics. Agents can propagate spec changes through implementations at machine speed. Conformance suites verify correctness. The spec becomes the source of truth again, because maintenance is now cheap.

I've been calling this **configurancy**—borrowing from [Venkatesh Rao](https://contraptions.venkateshrao.com/p/configurancy). The word matters because it names what we must build, not what we hope will emerge.

## The Bounded Agents Problem

**Everyone has limited context windows**. Humans can hold roughly 4-7 concepts in working memory. AI agents have literal context limits. Neither can hold a full system.

We live in a world of *multiple bounded agents*—human and AI—trying to co-evolve a shared system. The human can't see everything. The agent can't see everything. They can't even see the same things.

Steve Yegge recently wrote about [software survival in the agentic era](https://steve-yegge.medium.com/software-survival-3-0-97a2a6255f7b)—agents are becoming primary consumers AND producers of software. They're actors that make choices about the system's evolution. Not tools we wield, but collaborators we coordinate with.

The problem is **coordination between bounded agents** who are all operating on partial views of a shared reality. Without a written contract, small divergences compound. Tests pass. Coherence collapses.

## What Configurancy Actually Means

Rao's definition: "the way things and people fit together over time so that a world takes shape."

For software: **the shared intelligibility layer that allows agents with limited context to coherently co-evolve a system.**

Think of it like a contract that establishes shared facts:
- These affordances exist (what you can do) — *streams can be paused and resumed*
- These invariants hold (what you can rely on) — *messages are delivered exactly once*
- These constraints apply (what you can't do) — *max 100 concurrent streams per client*

High configurancy means the contract is clear enough for any agent—human or AI—to act coherently.

Low configurancy means the contract is implicit, outdated, or contradicted by reality. Agents make changes that seem locally correct but violate unstated assumptions.

This is distinct from code quality. You can have pristine implementation and collapsed configurancy. The code works; no one knows what it promises.

## The Formal Systems Connection

This isn't new. We've been building configurancy infrastructure for decades—we just didn't call it that.

**Types** make certain states unrepresentable—a shared contract about what the world can look like. You don't need to read all the code to know a `User` can't be null here; the type tells you.

**Interfaces** stabilize relations between components; agents on one side need not know the other.

**Invariants**—"this balance is never negative," "these IDs are unique," "this operation is idempotent"—let bounded agents coordinate.

**Specifications** like HTML5 or HTTP define what implementations must do, not how. Any agent can build a conforming implementation.

**Conformance suites** enforce all of the above. The html5lib-tests suite, protocol conformance tests—any implementation that passes meets the spec.

What changes in the agentic era is *scale* and *velocity*. When AI agents modify thousands of lines per day across dozens of PRs, implicit configurancy collapses. The unwritten rules that coordinated a small team don't survive when the team includes tireless, context-limited AI agents making changes faster than humans can review.

We need to make configurancy explicit. Not as documentation—which drifts—but as a living artifact that agents can read, update, and enforce.

## Finding External Hardness

The best configurancy enforcement relies on **verifiable ground truth that exists outside your system**.

At ElectricSQL, we've been building what we call "Oracle testing." When [fixing PG expression execution](https://github.com/electric-sql/electric/pull/2862), instead of writing test cases, we generate hundreds of SQL expressions and compare Electric's results against Postgres. Postgres *is* the spec—we don't need to write it. When someone reports a bug, we feed that description to AI, generate 100 test variations, and find edge cases we'd never think of.

This connects to **Reinforcement Learning with Verifiable Rewards (RLVR)**. Model companies discovered that AI learns faster when it can verify its own outputs—math problems with checkable answers, code with test suites. Verifiable rewards enable rapid iteration.

Configurancy is the same idea applied to systems. When you can verify against external hardness:
- Agents iterate rapidly (generate attempts, check against oracle)
- The system catches failures automatically, not when humans happen to notice
- The spec never drifts—you don't maintain documentation, you compare against behavior

Find an existing source of truth, generate tests against it, let agents iterate until they pass. Don't write the spec if someone else already has.

## Configurancy Requires Enforcement

A markdown file listing invariants is worthless if nothing enforces them.

The best examples I've seen make the configurancy *executable*:

**JustHTML**: Emil Stenström built a complete HTML5 parser using AI agents by hooking in the [html5lib-tests conformance suite](https://github.com/html5lib/html5lib-tests)—9,200 tests used by browser vendors—almost from the start. The suite *is* the configurancy. It defines what the system guarantees, independent of implementation. As Emil put it: ["The agent did the typing; I did the thinking."](https://simonwillison.net/2025/Dec/14/justhtml/)

Then Simon Willison [ported it to JavaScript in 4.5 hours](https://simonwillison.net/2025/Dec/15/porting-justhtml/) by pointing a different agent at the same conformance suite. The conformance suite enabled coordination across humans, AI agents, and even programming languages—same shared understanding, completely different implementations.

**Durable Streams**: We've been building [durable-streams](https://github.com/durable-streams/durable-streams) the same way—a [protocol specification](https://github.com/durable-streams/spec) with server and client conformance suites. The spec is the configurancy; the conformance suites are the enforcement. Any implementation that passes the suite implements the protocol correctly.

**Organizational Process**: At ElectricSQL, we've evolved our product/engineering workflow around this pattern. PRDs (product requirements), RFCs (technical design), and PRs (implementation) are all markdown in our repos. Agents double-check that PRDs and RFCs stay in sync, that PRs conform to both, and that when implementation reveals the spec needs to change, the docs get updated—not just the code. Requirements, design, and code all have explicit contracts, enforced by agents.

The same pattern appears at the function level: [Cheng Huang](https://zfhuang99.github.io/rust/claude%20code/codex/contracts/spec-driven%20development/2025/12/01/rust-with-ai.html) built 130K lines of Rust using code contracts as configurancy—preconditions, postconditions, and invariants that AI generates tests from. One contract caught a subtle Paxos safety violation.

## Formal Systems That Actually Evolve

In the agentic era, **formal systems are cheap to change**.

Traditional specifications, type systems, and contracts were expensive to write and slow to maintain. Changing an interface rippled through the codebase manually. So we invested sparingly, and specs drifted, and we accumulated technical debt when requirements shifted faster than our formal systems could follow.

Configurancy solves this by making the formal layer *agentic too*. Write a precise change to the spec, and agents propagate it through implementations. Conformance suites verify correctness. The 67-file change I opened with? That's the pattern—surgical spec change, automated propagation, verified result.

This approach builds on decades of work in Design by Contract and executable specifications. What's new is the economics: agent propagation makes it tractable.

The trade-off between formality and agility doesn't disappear, but it shrinks dramatically. You can have precise specifications AND rapid evolution—if you have agents to handle the propagation and conformance suites to verify correctness.

## How Enforcement Works

The configurancy model only matters if it's backed by formal mechanisms:
- **Conformance suites** that verify implementations meet the spec
- **Types** that make invalid states unrepresentable
- **Tests** that verify invariants
- **Runtime checks** that enforce constraints
- **API boundaries** that preserve affordances

The review question isn't just "did the configurancy change?" It's **bidirectional**:

1. **Doc → Code**: If the configurancy model claims an invariant, is it actually enforced? Is there a conformance test? A type? A runtime check?

2. **Code → Doc**: If a test or type encodes an invariant, is it documented in the configurancy model? Or is it implicit knowledge that will be lost?

This is where the formal systems connection becomes practical. Conformance suites, types, tests, and runtime checks are *enforcement mechanisms* for configurancy. The configurancy document is the *shared readable layer* that makes those enforcement mechanisms discoverable.

```
CONFIGURANCY REVIEW CHECKLIST

For each invariant in the model:
  [ ] Is it enforced by types?
  [ ] Is it covered by tests or conformance suite?
  [ ] Are violations caught at runtime?
  [ ] If not enforced, why not? (document the gap)

For each new test/type/check in the PR:
  [ ] Does it encode an invariant?
  [ ] Is that invariant in the configurancy model?
  [ ] If not, should it be added?
```

The goal isn't documentation. It's maintaining **bidirectional sync** between what the system claims and what it enforces. A configurancy model that drifts from enforcement is worse than no model—it actively misleads.

## Practical Artifacts

Once you have enforcement, you can build useful artifacts on top:

**Configurancy Delta**: Instead of "what lines changed," track "how did the shared understanding change?"

```
Affordances:
  + [NEW] Users can now pause streams
  ~ [MODIFIED] Delete requires confirmation

Invariants:
  ↑ [STRENGTHENED] Delivery: at-least-once → exactly-once (via idempotency keys)

Constraints:
  + [NEW] Max 100 concurrent streams
```

This is what all agents need to know. Not the diff. The delta in what they should expect.

**The 30-Day Test**: Could any agent—human or AI—picking up this system after 30 days accurately predict its behavior from the configurancy model? If not, either the change is too complex or the model needs updating.

**Invisible Changes Are Good**: Bug fixes and refactors should be invisible at the configurancy layer. If your "bug fix" requires updating the shared model, it's a behavior change. Call it what it is.

## Where This Breaks Down

This approach has costs and failure modes:

**Upfront investment**: Building conformance suites takes time. For throwaway prototypes or rapidly pivoting products, the overhead isn't worth it.

**Not everything is specifiable**: Some systems have emergent behavior—a neural network's edge cases, a simulation's chaotic output—that resists clean specification. The configurancy layer can describe inputs and outputs, but the interesting part happens in between.

**Conformance suite quality is critical**: A weak conformance suite gives false confidence. JustHTML works because html5lib-tests is comprehensive and battle-tested over years by browser vendors. Rolling your own suite requires expertise and iteration.

**Agents can propagate mistakes fast**: If you update the spec incorrectly, agents will dutifully propagate that mistake across 67 files. The velocity cuts both ways. The mitigation is the conformance suite itself—spec changes that break tests get caught before propagation completes. But this only works if your suite is comprehensive. A spec error that passes a weak suite spreads everywhere.

**Cultural change is hard**: Teams need to treat spec updates as first-class changes. If developers bypass the spec and edit code directly, you're back to documentation drift—now with extra steps.

**The meta-problem**: Who maintains the spec maintainers? This approach shifts complexity from "keep code in sync" to "keep spec accurate." The bet is that a good spec is smaller and more stable than the implementation, so it's easier to maintain. That holds for protocols; it fails for rapidly evolving products.

This approach pays off for stable protocols, clear-contract libraries, and systems that must evolve without breaking. For experiments, one-off scripts, and domains where the spec is unknowable—it's overhead.

## The Toolkit

We've been building [tools to make configurancy explicit](https://github.com/electric-sql/configurancy-review-toolkit):

1. **configurancy-analyzer**: Reviews changes for impact on shared intelligibility. Tracks affordances, invariants, constraints. Produces configurancy deltas.

2. **configurancy-modeler**: Generates and maintains the configurancy model—a predictive model any agent can use to answer "what happens if?"

3. **configurancy-review**: A review workflow that treats configurancy as a first-class concern. Implementation issues block. Configurancy issues also block.

Make the implicit explicit. If an invariant matters, write it down with its enforcement mechanism. If an affordance exists, document it. If a constraint applies, make it visible. These artifacts aren't for humans to read after the fact—they're coordination surfaces for all agents (human and otherwise).

The velocity problem is real. An AI agent can generate six months of technical debt in an afternoon. Systems with collapsed configurancy become unsteerable—tests pass, but every modification is a gamble.

Configurancy is the antidote. Make the coordination primitives explicit, enforce them with types and tests, let agents propagate changes. Without this, the implicit understanding that held your system together will collapse before you notice.

---

Sources and related reading:
- [Venkatesh Rao's "Configurancy"](https://contraptions.venkateshrao.com/p/configurancy) — the philosophical foundation: how agents and worlds co-emerge into intelligibility
- [Steve Yegge's "Software Survival 3.0"](https://steve-yegge.medium.com/software-survival-3-0-97a2a6255f7b) — what makes software survive when AI writes everything
- [Cheng Huang's "Learnings from 100K Lines of Rust with AI"](https://zfhuang99.github.io/rust/claude%20code/codex/contracts/spec-driven%20development/2025/12/01/rust-with-ai.html) — code contracts + property-based tests as configurancy enforcement
- [Simon Willison on JustHTML](https://simonwillison.net/2025/Dec/14/justhtml/) — conformance suites as the coordination primitive for agentic development
- [Simon Willison porting JustHTML to JavaScript](https://simonwillison.net/2025/Dec/15/porting-justhtml/) — same configurancy, different agent, different language, 4.5 hours
- [Durable Streams](https://github.com/durable-streams/durable-streams) — protocol spec + conformance suites in practice
- [ElectricSQL Oracle testing](https://github.com/electric-sql/electric/pull/2862) — using Postgres as external oracle for property-based testing

I'd love to hear from others thinking about this. How do you maintain coordination as agents multiply? What does the configurancy layer look like for your systems?

The answer probably isn't "more documentation." Static documentation is just configuration—a snapshot. We need configurancy: the living structure that evolves with the system and makes coordination possible.
