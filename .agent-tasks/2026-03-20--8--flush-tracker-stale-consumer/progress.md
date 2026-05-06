# Progress log

## 2026-03-20

### Initial analysis
- Read FlushTracker, ShapeLogCollector, Consumer, ConsumerRegistry, ShapeCleaner source
- Read existing test files for both FlushTracker and ShapeLogCollector
- Identified the exact code path: Consumer.handle_materializer_down → {:stop, :shutdown, state} → terminate → handle_writer_termination clause 3 (:ok, no cleanup)
- Existing tests cover: consumer crash during broadcast (detected by ConsumerRegistry), multi-fragment crash between fragments
- Missing: consumer dying out-of-band AFTER successful broadcast delivery, with no subsequent transactions to that shape

### Implementation
- Wrote 3 FlushTracker unit tests showing stale entries blocking advancement indefinitely
- Wrote 3 SLC integration tests:
  - Main bug test: kill consumer with :kill (skips terminate/remove_shape), send txns only to other shapes, verify flush stuck
  - Contrast test: graceful termination (runs terminate → remove_shape) allows flush to advance
  - Recovery test: when a txn finally touches the dead shape's table, undeliverable detection cleans up
- Key design decisions:
  - Used two separate tables (table_a, table_b) so transactions can selectively target one shape
  - Used :kill to simulate the end state of handle_materializer_down path (dead process, no cleanup)
  - The @describetag is needed (not @tag) to propagate inspector config to setup functions

### Operational issues
- Initially edited files in ~/code/electric-sql/electric instead of ~/agents/github/erik/repos/electric
  - Had to create a patch and git apply it to the correct repo
- Used @tag instead of @describetag, which doesn't propagate to setup functions
- First version of tests used `refute_receive` for the initial flush notification, but FlushTracker does partially advance when one shape catches up (to one below the stuck shape's offset). Fixed to `assert_receive` the partial advance, then `refute_receive` further advances.

### PR
- Created PR #4035: https://github.com/electric-sql/electric/pull/4035
- Added "claude" label for automated review
