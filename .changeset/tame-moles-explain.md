---
"@electric-sql/client": patch
"@core/sync-service": patch
---

feat: add support for `changes_only` mode, subset snapshots, and `offset=now`

- `changes_only` - in this mode the server will not create initial snapshot for the shape, the clients will start receiving changes without seeing base data. Best paired with...
- Subset snapshots - the server now accepts a `subset__*` set of parameters, which when provided result in a special-form response containing a snapshot of a subset (may be full) of a shape, and information on how to position this response in the stream. The client exposes a new method `requestSnapshot` which will make this request and then inject the response into the correct place in the subscribed messages stream, bounded with a `snapshot-end` control message.
- `offset=now` - the server now accepts a `offset=now` special value, in which case the client will receive an immediate up-to-date response with the latest possible continuation offset, allowing it to skip all historical data and start "from scratch". This works best with `changes_only` and subset snapshots where a client doesn't keep state and upon a reload needs to start fresh without historical data.
