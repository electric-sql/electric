---
'@electric-ax/agents-runtime': patch
---

Stop a wake whose failure never reached its stream from consuming its trigger: when the wake's writes failed and the error event recording that failure was itself lost with the producer, the done is sent without acks so the backend re-wakes the entity instead of marking a message answered that no run answered. The runtime also ignores a redelivery of a wake already in flight for the same stream and generation (the backend's retry of a delivery whose 2xx it never saw), and adopts a `write_token` delivered with the wake notification when the claim callback returns none.
