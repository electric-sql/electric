---
'@core/sync-service': patch
---

Add standard OCI labels (`org.opencontainers.image.*`) to the published Docker image:
title, description, URLs, license, vendor, and the version, git revision and commit
timestamp of the build. The unused `maintainer` label, which was set on the builder
stage and never reached the final image, is removed.
