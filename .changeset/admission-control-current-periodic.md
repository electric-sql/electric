---
"@core/sync-service": patch
---

Report admission control's in-flight requests and limits periodically, so `electric_admission_control_acquire_current` follows releases and swaps instead of keeping the value of the last admitted request.
