---
'@electric-sql/client': patch
---

Fix memory leak from recursive async functions by upgrading TypeScript target to ES2017.

The ES2016 target caused async/await to be transpiled using the `__async` helper which creates nested Promise chains that cannot be garbage collected when recursive async functions like `requestShape()` call themselves. With ES2017+, native async/await is used which doesn't have this issue.
