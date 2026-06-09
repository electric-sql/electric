---
'@electric-ax/agents': patch
---

agents: built-in `horton` and `worker` types now seed `principal_kind=service` grants (`spawn` + `manage`) at registration time, alongside the existing `user` grants. Without this, service-principal deployers (e.g. a long-running runtime authenticating as `service:my-bot`) hit `UNAUTHORIZED: Principal is not allowed to manage horton` on first boot against a fresh tenant — there's no way for a service principal to bootstrap the built-in agents without an out-of-band SQL insert or a user-principal admin call. The `user` grants are preserved unchanged.
