/-
  Formal verification model for Electric Sync Service shape removal race condition.

  This model captures a race condition identified in the ConsumerRegistry.publish flow
  where the sequence of operations during shape removal can lead to a crash when
  a transaction arrives during the removal window.

  The Bug:
  - ShapeStatus.remove_shape happens FIRST (immediate)
  - ShapeLogCollector.remove_shape happens LAST (async via RequestBatcher)
  - Between these, a transaction can be routed to a shape that no longer exists
    in ShapeStatus, causing Process.monitor(nil) to crash.

  Files involved:
  - lib/electric/shape_cache/shape_cleaner.ex:156-177 (remove_shape_immediate)
  - lib/electric/shapes/consumer_registry.ex:81-89 (publish)
  - lib/electric/shapes/consumer_registry.ex:125-147 (broadcast)
-/

import Mathlib.Data.Finset.Basic
import Mathlib.Data.Option.Basic

-- Shape handles are abstract identifiers
structure ShapeHandle where
  id : Nat
deriving DecidableEq, Repr

-- System state consists of three components
-- Each tracks which shapes are "present" in that component
structure SystemState where
  -- ShapeStatus: SQLite-backed metadata (knows if shape exists)
  shapeStatus : Finset ShapeHandle
  -- EventRouter: Routes events to shapes (inside ShapeLogCollector)
  eventRouter : Finset ShapeHandle
  -- ConsumerRegistry: Maps shape handles to consumer PIDs
  -- A shape in this set means it has a running consumer
  consumerRegistry : Finset ShapeHandle
deriving Repr

-- A well-formed initial state has all components in sync
def wellFormed (s : SystemState) : Prop :=
  s.eventRouter ⊆ s.shapeStatus ∧
  s.consumerRegistry ⊆ s.shapeStatus

-- The INVARIANT we need for safe operation:
-- For any shape in EventRouter, we must be able to either:
-- 1. Find its consumer in ConsumerRegistry, OR
-- 2. Start a new consumer via ShapeStatus lookup
-- This means: EventRouter shapes must be in (ConsumerRegistry ∪ ShapeStatus)
def safeToPublish (s : SystemState) : Prop :=
  ∀ h ∈ s.eventRouter, h ∈ s.consumerRegistry ∨ h ∈ s.shapeStatus

-- Model the individual removal steps as operations

-- Step 1: Remove from ShapeStatus (happens immediately)
def removeFromShapeStatus (s : SystemState) (h : ShapeHandle) : SystemState :=
  { s with shapeStatus := s.shapeStatus.erase h }

-- Step 2: Stop Consumer (removes from ConsumerRegistry)
-- In reality this also involves stopping the process, but for our model
-- we just care about the registry state
def removeFromConsumerRegistry (s : SystemState) (h : ShapeHandle) : SystemState :=
  { s with consumerRegistry := s.consumerRegistry.erase h }

-- Step 4: Remove from EventRouter (happens LAST, via async cast)
def removeFromEventRouter (s : SystemState) (h : ShapeHandle) : SystemState :=
  { s with eventRouter := s.eventRouter.erase h }

-- The actual removal sequence from ShapeCleaner.remove_shape_immediate
-- Returns intermediate states showing the progression
def removalSequence (s : SystemState) (h : ShapeHandle) :
    SystemState × SystemState × SystemState :=
  let s1 := removeFromShapeStatus s h        -- Step 1: ShapeStatus first
  let s2 := removeFromConsumerRegistry s1 h  -- Step 2: Consumer stop
  let s3 := removeFromEventRouter s2 h       -- Step 4: EventRouter last (async!)
  (s1, s2, s3)

-- THEOREM 1: Starting from a well-formed state with a shape present in all components,
-- after Step 2 (but before Step 4), the safeToPublish invariant is VIOLATED.
theorem removal_creates_unsafe_window
    (h : ShapeHandle)
    (s : SystemState)
    (hWellFormed : wellFormed s)
    (hInAll : h ∈ s.shapeStatus ∧ h ∈ s.eventRouter ∧ h ∈ s.consumerRegistry) :
    let (s1, s2, _) := removalSequence s h
    ¬ safeToPublish s2 := by
  -- After removal sequence, let's check state s2
  simp only [removalSequence, removeFromShapeStatus, removeFromConsumerRegistry]
  intro hSafe
  -- In s2:
  -- - shapeStatus has h removed (Step 1)
  -- - consumerRegistry has h removed (Step 2)
  -- - eventRouter still has h (Step 4 not yet executed!)
  have h_still_in_router : h ∈ s.eventRouter := hInAll.2.1
  -- The shape h is in eventRouter of s2 (unchanged from s)
  have h_in_s2_router : h ∈ s.eventRouter := h_still_in_router
  -- By safeToPublish, h must be in consumerRegistry or shapeStatus of s2
  specialize hSafe h h_in_s2_router
  -- But h was erased from both!
  cases hSafe with
  | inl h_in_cr =>
    simp only [Finset.mem_erase] at h_in_cr
    exact h_in_cr.1 rfl
  | inr h_in_ss =>
    simp only [Finset.mem_erase] at h_in_ss
    exact h_in_ss.1 rfl

-- For concreteness, let's also show a specific counterexample
-- A single-shape system where the race manifests

def exampleShape : ShapeHandle := ⟨42⟩

def exampleInitialState : SystemState := {
  shapeStatus := {exampleShape},
  eventRouter := {exampleShape},
  consumerRegistry := {exampleShape}
}

-- The initial state is well-formed and safe
theorem example_initial_wellFormed : wellFormed exampleInitialState := by
  simp [wellFormed, exampleInitialState]
  constructor <;> intro x hx <;> simp_all

theorem example_initial_safe : safeToPublish exampleInitialState := by
  simp [safeToPublish, exampleInitialState]
  intro h hMem
  right
  exact hMem

-- After Steps 1 and 2, the state is UNSAFE
def exampleUnsafeState : SystemState :=
  let (_, s2, _) := removalSequence exampleInitialState exampleShape
  s2

theorem example_unsafe : ¬ safeToPublish exampleUnsafeState := by
  simp only [safeToPublish, exampleUnsafeState, removalSequence,
             removeFromShapeStatus, removeFromConsumerRegistry]
  push_neg
  use exampleShape
  constructor
  · simp [exampleInitialState]
  · constructor
    · simp [Finset.mem_erase]
    · simp [Finset.mem_erase]

-- THEOREM 2: The race condition is unavoidable with the current ordering.
-- Any interleaving where ShapeStatus removal precedes EventRouter removal
-- creates a window where safeToPublish can be violated.

-- Model concurrent operations
inductive Operation where
  | RemoveFromShapeStatus (h : ShapeHandle)
  | RemoveFromConsumerRegistry (h : ShapeHandle)
  | RemoveFromEventRouter (h : ShapeHandle)
  | ProcessTransaction  -- A transaction arrives and tries to publish to active shapes
deriving DecidableEq, Repr

def applyOp (s : SystemState) (op : Operation) : SystemState :=
  match op with
  | .RemoveFromShapeStatus h => removeFromShapeStatus s h
  | .RemoveFromConsumerRegistry h => removeFromConsumerRegistry s h
  | .RemoveFromEventRouter h => removeFromEventRouter s h
  | .ProcessTransaction => s  -- Transaction doesn't modify state, but reads it

-- The bug manifests when a transaction is processed after ShapeStatus removal
-- but before EventRouter removal
def bugManifests (s : SystemState) : Prop :=
  ∃ h ∈ s.eventRouter, h ∉ s.shapeStatus ∧ h ∉ s.consumerRegistry

-- Show that the specific interleaving creates the bug
theorem interleaving_creates_bug
    (h : ShapeHandle)
    (s : SystemState)
    (hInAll : h ∈ s.shapeStatus ∧ h ∈ s.eventRouter ∧ h ∈ s.consumerRegistry) :
    let s' := applyOp (applyOp s (.RemoveFromShapeStatus h)) (.RemoveFromConsumerRegistry h)
    bugManifests s' := by
  simp only [applyOp, removeFromShapeStatus, removeFromConsumerRegistry, bugManifests]
  use h
  constructor
  · exact hInAll.2.1  -- h still in eventRouter
  · constructor
    · simp [Finset.mem_erase]  -- h removed from shapeStatus
    · simp [Finset.mem_erase]  -- h removed from consumerRegistry

-- CONCLUSION: The formal model proves that:
-- 1. The removal sequence creates a window where safeToPublish is violated
-- 2. During this window, if a transaction arrives and the EventRouter routes
--    events to the shape, ConsumerRegistry.publish will fail because:
--    - consumer_pid returns nil (consumer stopped)
--    - start_consumer! returns nil (ShapeStatus says shape doesn't exist)
--    - Process.monitor(nil) crashes
--
-- FIX SUGGESTION:
-- Option A: Remove from EventRouter BEFORE removing from ShapeStatus
-- Option B: Filter out nil pids in broadcast before calling Process.monitor
-- Option C: Use a "tombstone" marker in ShapeStatus instead of immediate deletion

end
