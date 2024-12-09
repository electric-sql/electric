---
title: Encryption
description: >-
  Example of how to implement encryption with Electric.
source_url: https://github.com/electric-sql/electric/tree/main/examples/encryption
example: true
---

# {{ $frontmatter.title }}

{{ $frontmatter.description }}

<DemoCTAs :demo="$frontmatter" />

## Encrypting local-first data with Electric

This is an example of encryption with Electric.

Electric syncs ciphertext as well as it syncs plaintext. You can encrypt data on and off the local client, i.e.:

- encrypting data before it leaves the client
- decrypting data after it syncs in to the client through Electric

It's a React app with a very simple Express API server. The Electric-specific code is in [`./src/Example.tsx`](https://github.com/electric-sql/electric/blog/main/examples/encryption/src/Example.tsx):

<<< @../../examples/encryption/src/Example.tsx{tsx}

<DemoCTAs :demo="$frontmatter" />
