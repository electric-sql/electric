---
"@core/electric": patch
---

Revert the change introduced in 0deba4d79de61a31aa19515d055a2a977a8e1b4e (released in version 0.9.3) where the configured signing key would get automatically decoded if it looked like a valid base64-encoded string.

Electric will no longer try to interpet the signing key. A new configuration option named `AUTH_JWT_KEY_IS_BASE64_ENCODED` has been added.
