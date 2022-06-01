# Todo

Step 1:

- [ ] two Postgres database nodes (same single table schema for now)
- [ ] setup logical replication between them

Step 2:

- [ ] consume and decode logical replication stream from Postgres A
- [ ] implement enough of the backend server logical replication protocol in order to replicate through Elixir
- [ ] encode and produce logical replication stream for Postgres B

Step 3:

- [ ] write changes into Antidote
- [ ] somehow handle `LSN` polling / pull from Postgres B
- [ ] query relevant materialised values from Antidote
- [ ] construct into encodable stream

Step 4:

- [ ] add a third Postgres
- [ ] pair each Postgres with an Antidote
- [ ] replicate between Antidotes
- [ ] demonstrate Postgres replication working with TCC+
