The key to use for JWT verification.

Must be appropriate for the chosen signature algorithm.

For `HS*` algorithms, the symmetric key can be Base64-encoded.

For `RS*` and `ES*` algorithms, the public key must be in the PEM format:

    -----BEGIN PUBLIC KEY-----
    MFkwEwYHKoZIzj0CAQY...
    ...
    -----END PUBLIC KEY-----
