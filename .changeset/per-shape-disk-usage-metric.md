---
"@core/electric-telemetry": patch
"@core/sync-service": patch
---

Export in-app BEAM allocator (`vm.alloc.*`), cgroup (`cgroup.*`), and host/process (`host.mem.*`, `host.proc.beam.*`) metrics for reconciling VM-reported memory/CPU/disk against what the kernel charges. Also emit a new `electric.storage.dir.bytes` stack-level metric reporting on-disk size for the top-N largest shapes (tagged by shape handle), computed during the existing periodic disk-usage walk so it adds no extra filesystem traversal.
