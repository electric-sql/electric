---
"@electric-sql/client": patch
---

refactor: improve error handling with new error classes & stream control

- Add `onError` handler to ShapeStream for centralized error handling
- Add new error classes:
  - MissingShapeUrlError
  - InvalidSignalError
  - MissingShapeHandleError
  - ReservedParamError
  - ParserNullValueError
  - ShapeStreamAlreadyRunningError
- Improve error propagation through ShapeStream lifecycle
