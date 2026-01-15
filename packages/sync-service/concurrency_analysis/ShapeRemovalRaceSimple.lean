/-
  Simplified Formal Verification Model for Electric Sync Service Shape Removal Race

  This model demonstrates a race condition in the shape removal flow where
  the ordering of operations can lead to a crash.

  The Bug (discovered in code analysis):
  - ShapeCleaner.remove_shape_immediate removes from ShapeStatus FIRST
  - ShapeLogCollector EventRouter removal happens LAST (async)
  - Window: ShapeStatus empty, EventRouter still has shape
  - If transaction arrives: ConsumerRegistry.publish crashes with Process.monitor(nil)

  Files:
  - lib/electric/shape_cache/shape_cleaner.ex:156-177
  - lib/electric/shapes/consumer_registry.ex:81-89, 125-147
-/

-- Simple set representation using lists
def Set (α : Type) := List α

namespace Set

def empty : Set α := []

def insert (x : α) (s : Set α) : Set α := x :: s

def member [DecidableEq α] (x : α) (s : Set α) : Bool := s.contains x

def remove [DecidableEq α] (x : α) (s : Set α) : Set α := s.filter (· ≠ x)

def singleton (x : α) : Set α := [x]

end Set

-- Shape handle is just a natural number for simplicity
abbrev ShapeHandle := Nat

-- System state: three components tracking shape presence
structure SystemState where
  shapeStatus : Set ShapeHandle      -- SQLite-backed metadata
  eventRouter : Set ShapeHandle      -- Routes events to shapes
  consumerRegistry : Set ShapeHandle -- Maps handles to consumer PIDs

-- Initial well-formed state where all components are in sync
def mkWellFormed (h : ShapeHandle) : SystemState :=
  { shapeStatus := Set.singleton h,
    eventRouter := Set.singleton h,
    consumerRegistry := Set.singleton h }

-- The SAFETY INVARIANT:
-- For any shape in EventRouter, we can either:
-- 1. Find its consumer in ConsumerRegistry, OR
-- 2. Look it up in ShapeStatus to start a new consumer
-- Violation means Process.monitor(nil) crash
def safeToPublish (s : SystemState) (h : ShapeHandle) : Bool :=
  if Set.member h s.eventRouter then
    Set.member h s.consumerRegistry || Set.member h s.shapeStatus
  else
    true

-- Individual removal operations

def removeFromShapeStatus (s : SystemState) (h : ShapeHandle) : SystemState :=
  { s with shapeStatus := Set.remove h s.shapeStatus }

def removeFromConsumerRegistry (s : SystemState) (h : ShapeHandle) : SystemState :=
  { s with consumerRegistry := Set.remove h s.consumerRegistry }

def removeFromEventRouter (s : SystemState) (h : ShapeHandle) : SystemState :=
  { s with eventRouter := Set.remove h s.eventRouter }

-- The CURRENT removal sequence (as in ShapeCleaner.remove_shape_immediate)
-- Returns the state after Steps 1+2, but before Step 4 (the async one)
def currentRemovalUnsafeWindow (s : SystemState) (h : ShapeHandle) : SystemState :=
  let s1 := removeFromShapeStatus s h        -- Step 1: ShapeStatus FIRST
  let s2 := removeFromConsumerRegistry s1 h  -- Step 2: Consumer stop
  -- Step 4 (removeFromEventRouter) happens LATER, asynchronously
  s2

-- THE BUG: After currentRemovalUnsafeWindow, safeToPublish is violated
-- This means a transaction arriving during this window causes a crash
-- (specifically: send(nil, msg) raises ArgumentError: "invalid destination")

-- Concrete test case
def testShape : ShapeHandle := 42

def initialState : SystemState := mkWellFormed testShape

-- Check initial state is safe
#eval safeToPublish initialState testShape  -- Should be: true

-- Check state after Steps 1+2 (the unsafe window)
def unsafeWindowState : SystemState := currentRemovalUnsafeWindow initialState testShape

#eval safeToPublish unsafeWindowState testShape  -- Should be: false (BUG!)

-- Let's also check intermediate states to see exactly when it breaks

def afterStep1 : SystemState := removeFromShapeStatus initialState testShape
#eval safeToPublish afterStep1 testShape  -- true (consumer still there)

def afterStep2 : SystemState := removeFromConsumerRegistry afterStep1 testShape
#eval safeToPublish afterStep2 testShape  -- false (BUG MANIFESTS!)

-- VERIFICATION: Prove the invariant violation
-- This would be the full proof, but we can demonstrate with decidable computation

-- The unsafe window exists
theorem unsafe_window_exists : safeToPublish unsafeWindowState testShape = false := by
  native_decide

-- Initial state was safe
theorem initial_was_safe : safeToPublish initialState testShape = true := by
  native_decide

-- After step 1 alone, still safe (consumer still registered)
theorem after_step1_still_safe : safeToPublish afterStep1 testShape = true := by
  native_decide

-- After step 2, UNSAFE - this is the race window
theorem after_step2_unsafe : safeToPublish afterStep2 testShape = false := by
  native_decide

-- THE FIX: Remove from EventRouter FIRST, then ShapeStatus
def fixedRemovalSequence (s : SystemState) (h : ShapeHandle) : SystemState :=
  let s1 := removeFromEventRouter s h        -- Step 1: EventRouter FIRST
  let s2 := removeFromConsumerRegistry s1 h  -- Step 2: Consumer stop
  let s3 := removeFromShapeStatus s2 h       -- Step 3: ShapeStatus LAST
  s3

-- With the fix, at every intermediate point, safeToPublish holds
def fixedAfterStep1 : SystemState := removeFromEventRouter initialState testShape
def fixedAfterStep2 : SystemState := removeFromConsumerRegistry fixedAfterStep1 testShape
def fixedAfterStep3 : SystemState := removeFromShapeStatus fixedAfterStep2 testShape

-- The shape is no longer routed to, so no crash possible
#eval safeToPublish fixedAfterStep1 testShape  -- true (not in router anymore)
#eval safeToPublish fixedAfterStep2 testShape  -- true (not in router)
#eval safeToPublish fixedAfterStep3 testShape  -- true (not in router)

theorem fixed_step1_safe : safeToPublish fixedAfterStep1 testShape = true := by
  native_decide

theorem fixed_step2_safe : safeToPublish fixedAfterStep2 testShape = true := by
  native_decide

theorem fixed_step3_safe : safeToPublish fixedAfterStep3 testShape = true := by
  native_decide

-- SUMMARY OF FINDINGS:
-- 1. Current code: ShapeStatus removed BEFORE EventRouter
--    - Creates window where h ∈ EventRouter but h ∉ ShapeStatus ∧ h ∉ ConsumerRegistry
--    - safeToPublish violated → Process.monitor(nil) crash
--
-- 2. Fixed code: EventRouter removed FIRST
--    - Shape is never routed to after it starts being removed
--    - safeToPublish always holds → no crash possible
--
-- Code location for the bug:
-- lib/electric/shape_cache/shape_cleaner.ex:156-177
--   Line 159: ShapeStatus.remove_shape (FIRST - should be LAST)
--   Line 170: ShapeLogCollector.remove_shape (LAST - should be FIRST)
