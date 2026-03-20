# Progress log

## 2026-03-20

### Initial analysis
- Read FlushTracker, ShapeLogCollector, Consumer, ConsumerRegistry, ShapeCleaner source
- Read existing test files for both FlushTracker and ShapeLogCollector
- Identified the exact code path: Consumer.handle_materializer_down → {:stop, :shutdown, state} → terminate → handle_writer_termination clause 3 (:ok, no cleanup)
- Existing tests cover: consumer crash during broadcast (detected by ConsumerRegistry), multi-fragment crash between fragments
- Missing: consumer dying out-of-band AFTER successful broadcast delivery, with no subsequent transactions to that shape

### Implementation plan
- Write tests at SLC level using the existing test infrastructure (Support.TransactionConsumer)
- Test 1: Consumer receives txn, dies out-of-band with :shutdown, no more txns for that shape → FlushTracker stuck
- Test 2: Similar but consumer dies between fragments of a multi-fragment txn, with the death reason being :shutdown (not :kill)
- Test 3: Higher-level test showing that handle_materializer_down path produces the stale condition
