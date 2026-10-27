---
'@electric-sql/client': patch
---

Notify subscriber error callbacks when the stream gives up on a rejection value
that is not an `Error`. Every teardown path in `#start` guarded
`sendErrorToSubscribers` with `err instanceof Error`, so a custom `fetchClient`
that rejects with a string, a plain object, or an `Error` from another realm
closed the stream in silence. Consumers that treat the subscriber error callback
as the only signal that the stream stopped — TanStack DB marks an Electric
collection as failed from it — hung instead. Non-`Error` values are now wrapped
with `new Error(String(err), { cause: err })`; the `error` getter still returns
the original rejection value.
