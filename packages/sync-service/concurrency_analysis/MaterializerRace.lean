/-
  Formal verification model for Materializer startup race condition.

  Bug location:
  - lib/electric/shapes/consumer/materializer.ex:105-119 (handle_continue :start_materializer)
  - lib/electric/shapes/consumer.ex:57-61 (subscribe_materializer)

  The Race:
  1. Materializer calls Consumer.await_snapshot_start() - Consumer is alive, returns :started
  2. Consumer terminates (cleanup, error, timeout, etc.)
  3. Materializer calls Consumer.subscribe_materializer() - calls GenServer.call(nil, ...)
  4. ArgumentError raised - Materializer crashes!

  The Consumer was alive at step 1, but dead at step 3. No check was performed
  between these steps to verify the Consumer is still alive.
-/

-- Process state
inductive ProcessState where
  | Alive
  | Dead
deriving Repr, DecidableEq

-- Result of a GenServer call
inductive CallResult where
  | Success
  | ArgumentError  -- GenServer.call(nil, ...) raises ArgumentError
deriving Repr, DecidableEq

-- Result of await_snapshot_start
inductive AwaitResult where
  | Started
  | Error
deriving Repr, DecidableEq

-- System state
structure SystemState where
  consumerState : ProcessState
  materializerState : ProcessState
  snapshotReady : Bool
  materializerSubscribed : Bool
deriving Repr

-- Initial state: Consumer alive with snapshot ready, Materializer starting up
def initialState : SystemState :=
  { consumerState := .Alive,
    materializerState := .Alive,
    snapshotReady := true,
    materializerSubscribed := false }

-- await_snapshot_start: blocks until snapshot is ready, returns :started if Consumer alive
def awaitSnapshotStart (s : SystemState) : AwaitResult × SystemState :=
  if s.consumerState == .Alive && s.snapshotReady then
    (.Started, s)
  else
    (.Error, s)

-- Consumer termination event
def consumerTerminates (s : SystemState) : SystemState :=
  { s with consumerState := .Dead }

-- subscribe_materializer: calls GenServer.call(consumer_pid, ...) where consumer_pid may be nil
def subscribeToMaterializer (s : SystemState) : CallResult × SystemState :=
  match s.consumerState with
  | .Alive => (.Success, { s with materializerSubscribed := true })
  | .Dead => (.ArgumentError, s)  -- GenServer.call(nil, ...) raises!

-- The current buggy sequence
def buggyStartupSequence (s : SystemState) : CallResult × SystemState :=
  -- Step 1: await_snapshot_start
  let (awaitResult, s1) := awaitSnapshotStart s
  match awaitResult with
  | .Error => (.ArgumentError, s1)  -- Would pattern match fail
  | .Started =>
    -- Step 2: Consumer terminates (race condition!)
    let s2 := consumerTerminates s1
    -- Step 3: subscribe_materializer - CRASH!
    subscribeToMaterializer s2

-- Execute the buggy sequence and check if it crashes
#eval buggyStartupSequence initialState  -- Should be: (.ArgumentError, ...)

-- PROOF: The buggy sequence results in ArgumentError (crash)
theorem buggy_sequence_crashes :
    (buggyStartupSequence initialState).fst = .ArgumentError := by
  native_decide

-- The fixed sequence with existence check
def fixedStartupSequence (s : SystemState) : CallResult × SystemState :=
  -- Step 1: await_snapshot_start
  let (awaitResult, s1) := awaitSnapshotStart s
  match awaitResult with
  | .Error => (.ArgumentError, s1)
  | .Started =>
    -- Step 2: Consumer terminates (race condition!)
    let s2 := consumerTerminates s1
    -- Step 3 (FIX): Check if Consumer is still alive before calling
    if s2.consumerState == .Alive then
      subscribeToMaterializer s2
    else
      -- Gracefully shut down instead of crashing
      (.Success, s2)  -- Return success to indicate graceful handling

-- Execute the fixed sequence
#eval fixedStartupSequence initialState  -- Should be: (.Success, ...)

-- PROOF: The fixed sequence does NOT crash
theorem fixed_sequence_does_not_crash :
    (fixedStartupSequence initialState).fst = .Success := by
  native_decide

-- Additional scenario: What if Consumer doesn't die?
def noRaceScenario : SystemState :=
  { consumerState := .Alive,
    materializerState := .Alive,
    snapshotReady := true,
    materializerSubscribed := false }

def normalStartupSequence (s : SystemState) : CallResult × SystemState :=
  -- Step 1: await_snapshot_start
  let (awaitResult, s1) := awaitSnapshotStart s
  match awaitResult with
  | .Error => (.ArgumentError, s1)
  | .Started =>
    -- Step 2: Consumer stays alive (no race)
    -- Step 3: subscribe_materializer - SUCCESS
    subscribeToMaterializer s1

#eval normalStartupSequence noRaceScenario  -- Should be: (.Success, {materializerSubscribed := true, ...})

-- PROOF: Normal sequence (no race) succeeds
theorem normal_sequence_succeeds :
    (normalStartupSequence noRaceScenario).fst = .Success := by
  native_decide

-- PROOF: Normal sequence results in subscription
theorem normal_sequence_subscribes :
    (normalStartupSequence noRaceScenario).snd.materializerSubscribed = true := by
  native_decide

/-
  SUMMARY:

  Bug: Materializer startup has a TOCTOU (time-of-check-time-of-use) race condition.
  The await_snapshot_start confirms Consumer is alive, but subscribe_materializer
  assumes it still is without re-checking. If Consumer dies in between, the
  GenServer.call(nil, ...) raises ArgumentError.

  Root cause: No atomicity guarantee between checking Consumer liveness (implicit
  in await_snapshot_start returning) and using the Consumer (subscribe_materializer).

  Fix options:
  1. Check Consumer existence before each call that requires it
  2. Wrap the sequence in try/catch to handle ArgumentError gracefully
  3. Use an atomic "subscribe and monitor" operation that handles the race internally

  Code locations:
  - lib/electric/shapes/consumer/materializer.ex:105-119
    The handle_continue(:start_materializer) performs await, subscribe, monitor
    in sequence without handling Consumer death between steps.

  - lib/electric/shapes/consumer.ex:57-61
    subscribe_materializer calls GenServer.call on consumer_pid without
    checking if it's nil first.
-/
