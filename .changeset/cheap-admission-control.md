---
'@core/sync-service': patch
---

Cheap admission control for shape requests. `:check_admission` now runs at the front of the request pipeline and classifies requests using a single `:ets.member/2` lookup on `?handle=`, removing the SQLite-backed `:resolve_existing_shape` step that previously ran before admission and saturated the read pool under thundering herd (bottleneck 1 of #4266). Once `load_shape` returns, the in-flight permit atomically swaps from the `:initial` bucket to `:existing` via the new `AdmissionControl.try_swap/4`, so the `:initial` cap bounds validate-and-load concurrency rather than full request lifetime. No HTTP protocol change.
