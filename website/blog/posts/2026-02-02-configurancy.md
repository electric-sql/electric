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

At Electric, we build sync engines, embedded databases, messaging systems—software where correctness matters. Over the past few months, we've shifted to nearly 100% AI-written code.

Every team has critical systems like this. Maybe it's your payments flow, your auth layer, your data pipeline.

How do you let agents write these systems without everything falling apart?

Last week we [simplified SSE binary handling](https://github.com/durable-streams/durable-streams/pull/231) in durable-streams. The change: remove a query parameter, have servers auto-detect binary content types, signal via response header.

The PR touched **67 files**: protocol spec, both servers (TypeScript + Go), all 10 client implementations across 10 languages, and conformance tests. One agent propagated the change through the entire stack in *20-30 minutes*. Every implementation now handles the new behavior correctly—verified by the conformance suite.

It felt like a type-driven refactor at system scale: change the contract, propagate fixes until the suite is green.

Here's the thesis: **when agents propagate changes at machine speed, implementation becomes cheap—so specification quality becomes what matters.** We've always known specs and contracts were valuable—but they cost too much to maintain. So we invested sparingly, specs drifted, and we just read the code.

That calculus has flipped. Explicit contracts—specs, invariants, conformance suites—become the cheapest way to keep a fast-moving system coherent. The spec becomes the source of truth again.

I've been calling this **configurancy**—borrowing from [Venkatesh Rao](https://contraptions.venkateshrao.com/p/configurancy). The meaningful shape of a project isn't the commit history; it's the intelligibility that emerges through that history. The goal is maintaining that intelligibility under rapid change.

## The Bounded Agents Problem

**Everyone has limited context windows**. Humans hold 4-7 concepts in working memory. AI agents have literal context limits. Neither can hold a full system.

We live in a world of *multiple bounded agents*—human and AI—trying to co-evolve a shared system. The human can't see everything. The agent can't see everything. They can't even see the same things.

Steve Yegge recently wrote about [software survival in the agentic era](https://steve-yegge.medium.com/software-survival-3-0-97a2a6255f7b)—agents are becoming primary consumers AND producers of software. They're actors that make choices about the system's evolution. Not tools we wield, but collaborators we coordinate with.

The problem is **coordination between bounded agents** who are all operating on partial views of a shared reality. Without a written contract, small divergences compound. Tests pass but coherence collapses.

## What Configurancy Means

Rao describes configurancy as "the ongoing, relational process through which agents and worlds *co-emerge* as intelligible configurations." Agents don't just act on the system; it shapes them in return. Software has always been co-evolutionary—the codebase you inherit constrains what you build next. But now AI agents are participants in this process, and it moves faster than any human can track.

For software, configurancy is **the explicit contract that lets bounded agents coherently co-evolve a system.**

Concretely: configurancy is the smallest set of explicit behavioral commitments (and rationales) that allow a bounded agent to safely modify the system without rediscovering invariants. This is falsifiable—if agents routinely break invariants, your configurancy surface is missing something.

It's a contract that establishes shared facts:
- These affordances exist (what you can do) — *streams can be paused and resumed*
- These invariants hold (what you can assume) — *messages are delivered exactly once*
- These constraints apply (what you cannot do) — *max 100 concurrent streams per client*

Formal contracts are bones. Intelligibility needs flesh—the memory of why we don't do X anymore, the rationale behind trade-offs. What Yegge calls "crystallized cognition"—hard-won knowledge compressed so agents don't have to rediscover it.

High configurancy means the contract is clear enough for any agent—human or AI—to act coherently.

Low configurancy means the contract is implicit, outdated, or contradicted by reality. Agents make changes that seem locally correct but violate unstated assumptions.

This is distinct from code quality. You can have pristine implementation and collapsed configurancy. The code works; no one knows what it promises.

## The System-Level Typechecker

We've been building configurancy infrastructure for decades—we just didn't call it that. **Types** make illegal states unrepresentable. **Interfaces** stabilize relations between components. **Invariants** let bounded agents coordinate. **Specifications** like HTML5 or HTTP define what implementations must do, not how. **Conformance suites** enforce all of the above.

Here's the reframe: **specification enforcement is the system-level typechecker**. Types prevent illegal states in a module. Specification enforcement prevents illegal behaviors across a system. "Make illegal states unrepresentable" scales up to "make illegal behaviors unimplementable."

The problem was always economics. Specifications were expensive to write and slow to maintain. Changing an interface rippled through the codebase manually. So we invested sparingly, specs drifted, and technical debt accumulated.

Agents change this. Write a precise change to the spec, and agents propagate it through implementations. Conformance suites verify correctness. The 67-file change I opened with? That's the pattern—surgical spec change, automated propagation, verified result. It's the same shape as proof assistants: change a lemma, the compiler fails, you repair downstream proofs. Agents make downstream repair cheap enough to treat large systems as if they had stronger behavioral typing.

When AI agents modify thousands of lines per day across dozens of PRs, implicit configurancy collapses. The unwritten rules that coordinated a small team don't survive. We need to make configurancy explicit—not as documentation that drifts, but as a living artifact that agents can read, update, and enforce.

## Examples

A markdown file listing invariants is worthless without enforcement. The best examples make the configurancy *executable*:

**JustHTML**: Emil Stenström built a complete HTML5 parser using AI agents by hooking in the [html5lib-tests conformance suite](https://github.com/html5lib/html5lib-tests)—9,200 tests used by browser vendors—from the start. The suite *is* the configurancy. As Emil put it: ["The agent did the typing; I did the thinking."](https://simonwillison.net/2025/Dec/14/justhtml/) Then Simon Willison [ported it to JavaScript in 4.5 hours](https://simonwillison.net/2025/Dec/15/porting-justhtml/) by pointing a different agent at the same conformance suite—same shared understanding, completely different implementations.

**Durable Streams**: We've been building [durable-streams](https://github.com/durable-streams/durable-streams) the same way—a [protocol specification](https://github.com/durable-streams/spec) with server and client conformance suites. Any implementation that passes the suite implements the protocol correctly.

**Code Contracts**: [Cheng Huang](https://zfhuang99.github.io/rust/claude%20code/codex/contracts/spec-driven%20development/2025/12/01/rust-with-ai.html) built 130K lines of Rust using preconditions, postconditions, and invariants that AI generates tests from. One contract caught a subtle Paxos safety violation.

**Organizational Process**: At ElectricSQL, PRDs, RFCs, and PRs are all markdown in our repos. Agents double-check that they stay in sync, and that when implementation reveals the spec needs to change, the docs get updated—not just the code.

## External Oracles

The best configurancy enforcement relies on **verifiable ground truth that exists outside your system**. Don't write the spec if someone else already has.

At ElectricSQL, we use "Oracle testing." When [fixing PG expression execution](https://github.com/electric-sql/electric/pull/2862), instead of writing test cases, we generate hundreds of SQL expressions and compare Electric's results against Postgres. Postgres *is* the spec. When someone reports a bug, we feed that description to AI, generate 100 test variations, and find edge cases we'd never think of.

This connects to **Reinforcement Learning with Verifiable Rewards (RLVR)**—AI learns faster when it can verify its own outputs. Configurancy is the same idea applied to systems: find an existing source of truth, generate tests against it, let agents iterate until they pass.

## Suite Design Is the New Frontier

A conformance suite can be a convincing liar. For distributed systems, the problem isn't "did we implement the rules?" but "did we cover the space of interleavings and failure modes?" Jepsen exists because "tests passed" means nothing.

Different problems need different suites:

- **Deterministic scenario suites**: Good for crisp invariants with known inputs/outputs
- **Fuzz / property-based testing**: Good for combinatorial spaces too large to enumerate
- **History-based checkers**: Good for weak consistency models where "correct" depends on observed order
- **Model checking / state exploration**: Good for concurrency interleavings
- **Differential testing**: Good when multiple implementations exist (like our Postgres oracle)

The html5lib-tests suite works because HTML parsing is deterministic—same input, same tree. Distributed consensus is harder. Your suite must sample failure modes that only appear under specific timing, network partitions, or crash sequences.

Suite design becomes the engineering frontier. The configurancy layer tells you *what* to verify; the suite determines *whether you actually verified it*.

## Keeping Spec and Code in Sync

The review question is **bidirectional**:

1. **Doc → Code**: If the configurancy model claims an invariant, is it enforced? Is there a conformance test? A type? A runtime check?

2. **Code → Doc**: If a test or type encodes an invariant, is it documented? Or is it implicit knowledge that will be lost?

A configurancy model that drifts from enforcement is worse than no model—it actively misleads.

**The 30-Day Test**: Could any agent—human or AI—picking up this system after 30 days accurately predict its behavior from the configurancy model?

Why 30 days? Your implicit context—why you chose that name, what edge case prompted that check—has evaporated. You operate with the same bounded context as any other agent. The test is about *prediction*, not comprehension. "Can you read this code?" is easy. "Can you predict what happens when two transactions both increment the same key concurrently?" is hard. If they can't answer from your configurancy layer, you have a gap.

The most dangerous bugs come from assumptions that "everyone knows"—but 30 days from now, nobody knows.

**Configurancy Delta**: Instead of "what lines changed," track "how did the shared understanding change?"

```
Affordances:
  + [NEW] Users can now pause streams

Invariants:
  ↑ [STRENGTHENED] Delivery: at-least-once → exactly-once

Constraints:
  + [NEW] Max 100 concurrent streams
```

This is what agents need to know. Not the diff. The delta in what they should expect. Bug fixes and refactors should be invisible at the configurancy layer—if your "bug fix" requires updating the shared model, it's a behavior change.

## Where This Breaks Down

**Upfront cost**: Building conformance suites takes time. Not worth it for throwaway prototypes.

**Not everything is specifiable**: Emergent behavior—neural networks, chaotic simulations—resists clean specification.

**Suite quality is critical**: A weak conformance suite gives false confidence. JustHTML works because html5lib-tests is battle-tested by browser vendors. Rolling your own requires expertise.

**Velocity cuts both ways**: Agents propagate spec mistakes as fast as correct changes. Comprehensive conformance suites catch errors before they spread—weak suites don't.

**Cultural change**: Teams must treat spec updates as first-class changes, or you're back to documentation drift.

This pays off for stable protocols and clear-contract libraries. For experiments and rapidly evolving products, it's overhead—*for now*. But if agents continue making spec maintenance cheaper, the calculus shifts. Starting with a lightweight spec might become the default, not the exception.

## The Toolkit

We've been building [tools to make configurancy explicit](https://github.com/electric-sql/configurancy-review-toolkit):

1. **configurancy-analyzer**: Reviews changes for impact on shared intelligibility. Tracks affordances, invariants, constraints. Produces configurancy deltas.

2. **configurancy-modeler**: Generates and maintains the configurancy model—a predictive model any agent can use to answer "what happens if?"

3. **configurancy-review**: A review workflow that treats configurancy as a first-class concern. Implementation issues block. Configurancy issues also block.

Make the implicit explicit. If an invariant matters, write it down with its enforcement mechanism. If an affordance exists, document it. If a constraint applies, make it visible. These artifacts aren't for humans to read after the fact—they're coordination surfaces for all agents (human and otherwise).

The velocity problem is real. An AI agent can generate six months of technical debt in an afternoon. Systems with collapsed configurancy become unsteerable—tests pass, but every modification is a gamble.

Configurancy is the antidote. Make the coordination primitives explicit, enforce them with types and tests, let agents propagate changes. Without this, the implicit understanding holding your system together collapses before you notice.

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

The answer isn't more documentation. Static documentation is just configuration—a snapshot. We need configurancy: the living structure that evolves with the system and makes coordination possible.
