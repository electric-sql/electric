The key to use for JWT verification.

Must be appropriate for the chosen signature algorithm.

For `HS*` algorithms, the symmetric key can be base64-encoded, provided that you also configure `AUTH_JWT_KEY_IS_BASE64_ENCODED`.

For `RS*` and `ES*` algorithms, the public key must be in the PEM format:

    -----BEGIN PUBLIC KEY-----
    MFkwEwYHKoZIzj0CAQY...
    ...
    -----END PUBLIC KEY-----
