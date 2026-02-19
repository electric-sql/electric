---
'@electric-sql/client': patch
---

Fix BigInt values in subset loading parameters causing `JSON.stringify` to throw "Do not know how to serialize a BigInt". Values from parsed int8 columns can now be passed directly as `requestSnapshot`/`fetchSnapshot` params without manual conversion.
