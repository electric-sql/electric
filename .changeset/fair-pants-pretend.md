---
"@electric-sql/client": patch
---

refactor: improve error handling with new error classes & stream control

- Add `autoStart` option to ShapeStream constructor enabling two error handling patterns:
  1. try/catch with `autoStart: false`
  2. error handler in subscribe callback
- Add new error classes:
  - MissingShapeUrlError
  - InvalidSignalError
  - MissingShapeHandleError
  - ReservedParamError
  - ParserNullValueError
  - ShapeStreamAlreadyRunningError
