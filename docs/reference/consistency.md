---
title: Consistency
description: >-
  ElectricSQL consistency model and convergence semantics.
---

import useBaseUrl from '@docusaurus/useBaseUrl'

ElectricSQL provides transactional causal+ consistency with rich-CRDTs.

Transactional causal+ consistency (TCC+) combies causal consistency, CRDTs, highly available transactions and sticky availability. It is formally proven to be the strongest possible consistency mode for an local-first database system.

ElectricSQL also extends TCC+ with [Rich-CRDT techniques](#rich-crdts) to preserve relational invariants.

## TCC+

### Causal consistency

[Causal consistency](https://jepsen.io/consistency/models/causal) guarantees that if a read or write depends on the effects of a previous write then the causal order between them will be respected. However, if two operations are concurrent and have not seen each other, then it's fine for them to be applied in any order. It also implies that you read your own writes. As per the [Jepsen Consistency](https://jepsen.io/consistency) diagramme below:

<div className="my-6">
  <div className="tile">
    <div className="p-4">
      <a href="https://jepsen.io/consistency" class="no-visual w-100">
        <img src={useBaseUrl('/img/reference/consistency-map.dark.svg')}
            class="consistency-map"
        />
      </a>
    </div>
  </div>
</div>

Martin Kleppmann has some great videos (on [causal consistency](https://www.youtube.com/watch?v=OKHIdpOAxto) and on [logical time](https://www.youtube.com/watch?v=x-D8iFU1d-o)) and you can read [the original "don't settle for eventual" paper here](https://www.cs.cmu.edu/~dga/papers/cops-sosp2011.pdf).

### CRDTs

ElectricSQL provides conflict-free replication using [CRDTs](https://crdt.tech). In fact, CRDTs were invented by two of our team [Marc Shapiro and Nuno Preguiça](/about/team#advisors), along with Carlos Baquero.

CRDTs are data types that can merge concurrent writes without conflicts. They allow clusters to accept writes without cross-region synchronization / replication consensus. Instead, writes can be accepted with low latency and replicated asynchronously, with commutative merge operations ensuring that all clusters converge on strong eventual consistency.

### Highly available transactions

[Highly available transactions](https://doi.org/10.14778/2732232.2732237) guarantee the atomic application of a set of operations. I.e: you can wrap multiple writes within a transaction and those writes will either all be applied or none will be applied. See [the paper](https://doi.org/10.14778/2732232.2732237) for more information about the guarantees available under high availability and sticky availability.

### Sticky availability

High availability allows writes to be accepted at every server, wherever it is in the world. [Sticky availability](http://www.bailis.org/blog/stickiness-and-client-server-session-guarantees) is a mode of high availability where clients always talk to the same server. When this condition is true, it allows high-availability systems to provide additional consistency guarantees, including read-your-own-writes and causal consistency.

## Rich-CRDTs

[Rich-CRDTs](/blog/2022/05/03/introducing-rich-crdts) were invented by ElectricSQL's CTO and co-founder, [Valter Balegas](/about/team) and colleagues at Universidade NOVA de Lisboa under the supervision of Professor Nuno Preguiça.

Rich-CRDT extend TCC+ with additional techniques to preserve relational invariants. This is key to supporting relational data models from existing Postgres-backed applications.

The primary techniques are:

- **composition** &mdash; composing CRDTs into higher-order data types
- **compensations** &mdash; applying additional operations during concurrent merge logic
- **reservations** &mdash; runtime coordination via shared, distributed locks

Currently, we apply compensations to preserve referential integrity. In future, we will implement more techniques to support additional relational constraints.

See [the blog post introducing rich-CRDTs](/blog/2022/05/03/introducing-rich-crdts) and the [Literature](./literature.md) page for more information.
