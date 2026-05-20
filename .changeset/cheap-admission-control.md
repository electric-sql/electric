---
'@core/sync-service': patch
---

Cheap admission control for shape requests. `:check_admission` now runs at the front of the request pipeline and classifies requests using a single `:ets.member/2` lookup on `?handle=`, removing the SQLite-backed `:resolve_existing_shape` step that previously ran before admission and saturated the read pool under thundering herd (bottleneck 1 of #4266).
