/-
  Formal verification model for PureFileStorage ETS read/write race condition.

  Bug location:
  - lib/electric/shape_cache/pure_file_storage.ex:1115-1156 (stream_main_log)
  - lib/electric/shape_cache/pure_file_storage/write_loop.ex:312-340 (flush_buffer)

  The Race:
  1. Reader reads metadata: `last_persisted = X`, `last_seen = Y`, `ets = ref`
  2. Reader decides to read from ETS (because `min_offset > X` means data is in ETS)
  3. Writer flushes buffer:
     a. Writes data to disk up to offset Y
     b. Updates `last_persisted = Y` in ETS metadata
     c. Calls `trim_ets` - clears ALL ETS data
  4. Reader calls `read_range_from_ets_cache(ets, min_offset, Y)` - gets EMPTY!
  5. Reader misses data in range (X, Y]

  The data IS on disk now, but the reader used stale metadata to decide
  where to read from, and the ETS was cleared before it could access it.
-/

-- Offsets are natural numbers for simplicity
abbrev Offset := Nat

-- ETS state: either contains data up to some offset, or is empty
inductive EtsState where
  | HasData (upTo : Offset)  -- ETS has data from last_persisted to upTo
  | Empty                     -- ETS was cleared
deriving Repr, DecidableEq

-- Metadata visible to readers
structure ReaderMetadata where
  lastPersisted : Offset      -- Data on disk up to this offset
  lastSeen : Offset           -- Data written (on disk or in ETS) up to this offset
  etsRef : Bool               -- Whether ETS exists (not nil)
deriving Repr

-- Full system state
structure SystemState where
  -- Disk state (always consistent)
  diskDataUpTo : Offset
  -- ETS state
  ets : EtsState
  -- Metadata in ETS (can be read by readers)
  metadata : ReaderMetadata
deriving Repr

-- Initial state: some data is persisted, more is in ETS buffer
def mkInitialState (persisted seen : Offset) (h : persisted ≤ seen) : SystemState :=
  { diskDataUpTo := persisted,
    ets := if persisted < seen then .HasData seen else .Empty,
    metadata := {
      lastPersisted := persisted,
      lastSeen := seen,
      etsRef := true
    }
  }

-- Reader's decision based on metadata snapshot
inductive ReadSource where
  | Disk                      -- Read from disk only
  | Ets                       -- Read from ETS only (offset > lastPersisted)
  | DiskThenEts               -- Read from disk then ETS
deriving Repr, DecidableEq

def decideReadSource (readerMeta : ReaderMetadata) (minOffset : Offset) : ReadSource :=
  if minOffset ≤ readerMeta.lastPersisted then
    if readerMeta.lastSeen ≤ readerMeta.lastPersisted then
      .Disk
    else
      .DiskThenEts
  else if readerMeta.etsRef then
    .Ets  -- Data should be in ETS since offset > lastPersisted
  else
    .Disk -- No ETS, fall back to disk (will get empty)

-- Writer flush operation: writes buffer to disk, updates metadata, clears ETS
def writerFlush (s : SystemState) : SystemState :=
  let newPersisted := s.metadata.lastSeen
  { s with
    diskDataUpTo := newPersisted,
    ets := .Empty,  -- trim_ets clears all data!
    metadata := { s.metadata with lastPersisted := newPersisted }
  }

-- What data does reader actually get?
def readerGetsData (source : ReadSource) (s : SystemState) (minOffset maxOffset : Offset) : Bool :=
  match source with
  | .Disk => minOffset < s.diskDataUpTo  -- Can read from disk
  | .Ets =>
    match s.ets with
    | .HasData upTo => minOffset < upTo  -- ETS has the data
    | .Empty => false                     -- ETS was cleared - NO DATA!
  | .DiskThenEts =>
    minOffset < s.diskDataUpTo ||
    match s.ets with
    | .HasData upTo => s.metadata.lastPersisted < upTo
    | .Empty => false

-- The SAFETY invariant: if reader decides to read from ETS based on metadata,
-- they should actually get the data
def safeRead (s : SystemState) (snapshotMeta : ReaderMetadata) (minOffset : Offset) : Bool :=
  let source := decideReadSource snapshotMeta minOffset
  let maxOffset := snapshotMeta.lastSeen
  source != .Ets || readerGetsData source s minOffset maxOffset

-- Concrete example showing the bug
def exampleInitial : SystemState := mkInitialState 100 150 (by decide)

-- Reader reads metadata, decides to read from ETS for offset 120
def readerMeta : ReaderMetadata := exampleInitial.metadata
def readerMinOffset : Offset := 120  -- Wants data after offset 100 (lastPersisted)

-- Reader decides to read from ETS
#eval decideReadSource readerMeta readerMinOffset  -- Should be: .Ets

-- Before writer flush, reading is safe
#eval safeRead exampleInitial readerMeta readerMinOffset  -- Should be: true

-- Writer flushes (happens between reader's metadata read and ETS read)
def afterFlush : SystemState := writerFlush exampleInitial

-- After writer flush, ETS is empty!
#eval afterFlush.ets  -- Should be: .Empty

-- Reader still has stale metadata, still decides to read from ETS
#eval decideReadSource readerMeta readerMinOffset  -- Still: .Ets

-- But now the read is UNSAFE - ETS is empty!
#eval safeRead afterFlush readerMeta readerMinOffset  -- Should be: false (BUG!)

-- PROOF: The race condition causes data loss
theorem race_causes_data_invisibility :
    safeRead afterFlush readerMeta readerMinOffset = false := by
  native_decide

-- PROOF: Initial state was safe
theorem initial_was_safe :
    safeRead exampleInitial readerMeta readerMinOffset = true := by
  native_decide

-- The problem: Reader used stale metadata to decide read source,
-- but the actual state changed between decision and read.

-- PROPOSED FIX: Re-check metadata after deciding to read from ETS
-- If lastPersisted changed, the data might now be on disk instead

def safeReadWithRecheck (currentState : SystemState) (oldMeta : ReaderMetadata) (minOffset : Offset) : Bool :=
  let source := decideReadSource oldMeta minOffset
  match source with
  | .Ets =>
    -- Re-check: if lastPersisted moved past our minOffset, read from disk instead
    if currentState.metadata.lastPersisted ≥ minOffset then
      readerGetsData .Disk currentState minOffset oldMeta.lastSeen
    else
      readerGetsData .Ets currentState minOffset oldMeta.lastSeen
  | other => readerGetsData other currentState minOffset oldMeta.lastSeen

-- With the fix, even after flush, reader gets data (from disk)
#eval safeReadWithRecheck afterFlush readerMeta readerMinOffset  -- Should be: true

theorem fixed_read_is_safe :
    safeReadWithRecheck afterFlush readerMeta readerMinOffset = true := by
  native_decide

/-
  SUMMARY:

  Bug: Reader reads metadata snapshot, decides to read from ETS, but writer
  flushes and clears ETS before reader can access it. Reader gets empty results
  even though data exists (now on disk).

  Root cause: Stale metadata used to decide read source, no re-check before
  actual ETS access.

  Fix options:
  1. Re-check lastPersisted before reading from ETS
  2. Don't clear ETS immediately - let readers drain first
  3. Use a read-copy-update pattern for ETS access

  Code locations:
  - lib/electric/shape_cache/pure_file_storage.ex:1142-1143
    The condition `is_log_offset_lte(last_persisted, min_offset)` uses stale
    lastPersisted value. Should re-check after deciding to read from ETS.

  - lib/electric/shape_cache/pure_file_storage/write_loop.ex:339
    `trim_ets(state)` immediately clears ETS. Could delay clearing or use
    a different synchronization mechanism.
-/
