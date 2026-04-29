---
"electric-ax": patch
---

Replace the abrupt `ANTHROPIC_API_KEY is required` fatal error in `agents quickstart` and `agents start-builtin` with a friendly interactive prompt that explains how the key is used (it never leaves the local machine) and lets the user choose between setting up `.env` manually or pasting the key once to have the CLI write `.env` for them. Non-interactive runs still fail fast with the original error.
