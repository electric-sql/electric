# Hibernate-Then-Suspend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When consumer suspend is enabled, hibernate first (shorter timeout) to trigger GC, then suspend later (longer timeout) to terminate the process.

**Architecture:** Introduce a two-stage timeout: after `hibernate_after` ms of inactivity, the consumer hibernates and schedules a `:suspend_timeout` message for `suspend_after` ms later. Any activity cancels the pending suspend timer. This ensures GC runs (via hibernation) before eventual process termination (suspend).

**Tech Stack:** Elixir GenServer, `:erlang.send_after/3` for timer scheduling

---

## File Structure

| File                                       | Action | Responsibility                                                    |
| ------------------------------------------ | ------ | ----------------------------------------------------------------- |
| `lib/electric/config.ex`                   | Modify | Add `shape_suspend_after` default (60s)                           |
| `lib/electric/stack_config.ex`             | Modify | Add `shape_suspend_after` to seed config                          |
| `lib/electric/stack_supervisor.ex`         | Modify | Add `shape_suspend_after` to schema and config                    |
| `lib/electric/application.ex`              | Modify | Pass `shape_suspend_after` through                                |
| `lib/electric/shapes/consumer/state.ex`    | Modify | Add `:suspend_timer` and `:suspend_after` fields                  |
| `lib/electric/shapes/consumer.ex`          | Modify | Implement hibernate-then-suspend flow                             |
| `lib/electric/shapes/consumer_registry.ex` | Modify | Update `enable_suspend/3` → `enable_suspend/4` with suspend_after |
| `test/electric/shapes/consumer_test.exs`   | Modify | Add tests for hibernate-then-suspend behavior                     |

---

## Task 1: Add `shape_suspend_after` Configuration

**Files:**

- Modify: `packages/sync-service/lib/electric/config.ex:88-91`
- Modify: `packages/sync-service/lib/electric/stack_config.ex:31-32`
- Modify: `packages/sync-service/lib/electric/stack_supervisor.ex:131-137`
- Modify: `packages/sync-service/lib/electric/application.ex:146-147`

- [ ] **Step 1: Add default to config.ex**

In `lib/electric/config.ex`, add `shape_suspend_after` after `shape_enable_suspend?`:

```elixir
    shape_hibernate_after: :timer.seconds(30),
    # Should we terminate consumer processes after `shape_hibernate_after` ms
    # or just hibernate them?
    shape_enable_suspend?: false,
    # How long after hibernation before suspending (terminating) the consumer
    shape_suspend_after: :timer.seconds(60),
```

- [ ] **Step 2: Add to stack_config.ex seed config**

In `lib/electric/stack_config.ex`, function `default_seed_config/0`:

```elixir
      shape_hibernate_after: Electric.Config.default(:shape_hibernate_after),
      shape_enable_suspend?: Electric.Config.default(:shape_enable_suspend?),
      shape_suspend_after: Electric.Config.default(:shape_suspend_after),
```

- [ ] **Step 3: Add to stack_supervisor.ex schema**

In `lib/electric/stack_supervisor.ex`, in the `:tweaks` schema around line 135:

```elixir
                     shape_enable_suspend?: [
                       type: :boolean,
                       default: Electric.Config.default(:shape_enable_suspend?)
                     ],
                     shape_suspend_after: [
                       type: :non_neg_integer,
                       default: Electric.Config.default(:shape_suspend_after)
                     ],
```

- [ ] **Step 4: Update stack_supervisor.ex config extraction**

In `lib/electric/stack_supervisor.ex`, around line 353-354, add extraction:

```elixir
    shape_hibernate_after = Keyword.fetch!(config.tweaks, :shape_hibernate_after)
    shape_enable_suspend? = Keyword.fetch!(config.tweaks, :shape_enable_suspend?)
    shape_suspend_after = Keyword.fetch!(config.tweaks, :shape_suspend_after)
```

- [ ] **Step 5: Update stack_supervisor.ex config passing**

In `lib/electric/stack_supervisor.ex`, around line 402-403, add to the config map:

```elixir
           shape_hibernate_after: shape_hibernate_after,
           shape_enable_suspend?: shape_enable_suspend?,
           shape_suspend_after: shape_suspend_after,
```

- [ ] **Step 6: Update application.ex**

In `lib/electric/application.ex`, around line 146-147:

```elixir
        shape_hibernate_after: get_env(opts, :shape_hibernate_after),
        shape_enable_suspend?: get_env(opts, :shape_enable_suspend?),
        shape_suspend_after: get_env(opts, :shape_suspend_after),
```

- [ ] **Step 7: Verify compilation**

Run: `cd packages/sync-service && mix compile --warnings-as-errors`
Expected: Compilation succeeds without warnings

- [ ] **Step 8: Commit**

```bash
git add packages/sync-service/lib/electric/config.ex \
        packages/sync-service/lib/electric/stack_config.ex \
        packages/sync-service/lib/electric/stack_supervisor.ex \
        packages/sync-service/lib/electric/application.ex
git commit -m "$(cat <<'EOF'
feat(sync-service): add shape_suspend_after configuration

Add new config option to control the delay between hibernation and
suspension. Default is 60 seconds. This prepares for hibernate-then-suspend
behavior where consumers first hibernate (to trigger GC) before suspending.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add State Fields for Suspend Timer

**Files:**

- Modify: `packages/sync-service/lib/electric/shapes/consumer/state.ex:16-45`
- Modify: `packages/sync-service/lib/electric/shapes/consumer/state.ex:88-100`

- [ ] **Step 1: Add fields to defstruct**

In `lib/electric/shapes/consumer/state.ex`, add to the defstruct (around line 44):

```elixir
    # Timer reference for scheduled suspend, set when entering hibernation
    suspend_timer: nil,
    # How long after hibernation to suspend (in ms)
    suspend_after: nil
```

- [ ] **Step 2: Initialize suspend_after in new/2**

In `lib/electric/shapes/consumer/state.ex`, update `new/2` function to initialize `suspend_after`:

```elixir
  def new(stack_id, shape_handle) do
    %__MODULE__{
      stack_id: stack_id,
      shape_handle: shape_handle,
      hibernate_after:
        Electric.StackConfig.lookup(
          stack_id,
          :shape_hibernate_after,
          Electric.Config.default(:shape_hibernate_after)
        ),
      suspend_after:
        Electric.StackConfig.lookup(
          stack_id,
          :shape_suspend_after,
          Electric.Config.default(:shape_suspend_after)
        ),
      buffering?: true
    }
  end
```

- [ ] **Step 3: Verify compilation**

Run: `cd packages/sync-service && mix compile --warnings-as-errors`
Expected: Compilation succeeds without warnings

- [ ] **Step 4: Commit**

```bash
git add packages/sync-service/lib/electric/shapes/consumer/state.ex
git commit -m "$(cat <<'EOF'
feat(sync-service): add suspend_timer and suspend_after to Consumer.State

Add state fields to track the scheduled suspend timer and the configured
delay between hibernation and suspension.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Implement Hibernate-Then-Suspend Logic in Consumer

**Files:**

- Modify: `packages/sync-service/lib/electric/shapes/consumer.ex:389-423`

- [ ] **Step 1: Add helper to cancel suspend timer**

Add a new private function after `consumer_can_suspend?/1` (around line 423):

```elixir
  defp cancel_suspend_timer(%{suspend_timer: nil} = state), do: state

  defp cancel_suspend_timer(%{suspend_timer: timer_ref} = state) do
    :erlang.cancel_timer(timer_ref)
    receive do
      :suspend_timeout -> :ok
    after
      0 -> :ok
    end
    %{state | suspend_timer: nil}
  end
```

- [ ] **Step 2: Add helper to schedule suspend timer**

Add after the cancel helper:

```elixir
  defp schedule_suspend_timer(%{suspend_after: suspend_after} = state) do
    timer_ref = :erlang.send_after(suspend_after, self(), :suspend_timeout)
    %{state | suspend_timer: timer_ref}
  end
```

- [ ] **Step 3: Modify handle_info(:timeout, ...) for hibernate-then-suspend**

Replace the existing `handle_info(:timeout, state)` function (lines 397-414):

```elixir
  def handle_info(:timeout, state) do
    state = cancel_suspend_timer(state)

    if consumer_suspend_enabled?(state) and consumer_can_suspend?(state) do
      state = %{state | writer: ShapeCache.Storage.hibernate(state.writer)}
      state = schedule_suspend_timer(state)
      {:noreply, state, :hibernate}
    else
      state = %{state | writer: ShapeCache.Storage.hibernate(state.writer)}
      {:noreply, state, :hibernate}
    end
  end
```

- [ ] **Step 4: Add handle_info(:suspend_timeout, ...) handler**

Add a new handler after the `:timeout` handler:

```elixir
  def handle_info(:suspend_timeout, state) do
    state = %{state | suspend_timer: nil}

    if consumer_suspend_enabled?(state) and consumer_can_suspend?(state) do
      Logger.debug(fn -> ["Suspending consumer ", to_string(state.shape_handle)] end)
      {:stop, ShapeCleaner.consumer_suspend_reason(), state}
    else
      {:noreply, state, state.hibernate_after}
    end
  end
```

- [ ] **Step 5: Cancel suspend timer on activity**

Find all places that return `{:noreply, state, state.hibernate_after}` and ensure they cancel the suspend timer. Create a helper that wraps the common pattern. Add this helper near the cancel_suspend_timer function:

```elixir
  defp reply_with_timeout(state) do
    state = cancel_suspend_timer(state)
    {state, state.hibernate_after}
  end
```

Update handle_continue(:consume_buffer, ...) at line 167-175:

```elixir
  def handle_continue(:consume_buffer, state) do
    state = process_buffered_txn_fragments(state)

    if state.terminating? do
      {:noreply, state, {:continue, :stop_and_clean}}
    else
      {state, timeout} = reply_with_timeout(state)
      {:noreply, state, timeout}
    end
  end
```

- [ ] **Step 6: Update remaining handlers to cancel timer on activity**

Update each handler that returns `state.hibernate_after` to use the pattern `{state, timeout} = reply_with_timeout(state)`:

For `handle_call({:monitor, pid}, ...)` at line 178:

```elixir
  def handle_call({:monitor, pid}, _from, %{monitors: monitors} = state) do
    ref = make_ref()
    {state, timeout} = reply_with_timeout(%{state | monitors: [{pid, ref} | monitors]})
    {:reply, ref, state, timeout}
  end
```

For `handle_call(:await_snapshot_start, ...)` at line 183:

```elixir
  def handle_call(:await_snapshot_start, _from, state) when is_snapshot_started(state) do
    {state, timeout} = reply_with_timeout(state)
    {:reply, :started, state, timeout}
  end
```

For `handle_call(:await_snapshot_start, from, state)` at line 187:

```elixir
  def handle_call(:await_snapshot_start, from, state) do
    Logger.debug("Starting a wait on the snapshot #{state.shape_handle} for #{inspect(from)}}")
    state = State.add_waiter(state, from)
    {state, timeout} = reply_with_timeout(state)
    {:noreply, state, timeout}
  end
```

For `handle_call({:handle_event, ...})` at line 193:

```elixir
  def handle_call({:handle_event, event, trace_context}, _from, state) do
    OpenTelemetry.set_current_context(trace_context)

    case handle_event(event, state) do
      %{terminating?: true} = state ->
        {:reply, :ok, state, {:continue, :stop_and_clean}}

      state ->
        {state, timeout} = reply_with_timeout(state)
        {:reply, :ok, state, timeout}
    end
  end
```

For `handle_call({:subscribe_materializer, ...})` at line 205:

```elixir
  def handle_call({:subscribe_materializer, pid}, _from, state) do
    Logger.debug("Subscribing materializer for #{state.shape_handle}")
    Process.monitor(pid, tag: :materializer_down)
    state = %{state | materializer_subscribed?: true}
    {state, timeout} = reply_with_timeout(state)
    {:reply, {:ok, state.latest_offset}, state, timeout}
  end
```

For `handle_cast({:snapshot_started, ...})` at line 230:

```elixir
  def handle_cast({:snapshot_started, shape_handle}, %{shape_handle: shape_handle} = state) do
    Logger.debug("Snapshot started shape_handle: #{shape_handle}")
    state = State.mark_snapshot_started(state)
    {state, timeout} = reply_with_timeout(state)
    {:noreply, state, timeout}
  end
```

For `handle_cast({:snapshot_exists, ...})` at line 251:

```elixir
  def handle_cast({:snapshot_exists, shape_handle}, %{shape_handle: shape_handle} = state) do
    state = State.mark_snapshot_started(state)
    {state, timeout} = reply_with_timeout(state)
    {:noreply, state, timeout}
  end
```

For `handle_info({ShapeCache.Storage, :flushed, ...})` at line 277:

```elixir
  def handle_info({ShapeCache.Storage, :flushed, flushed_offset}, state) do
    state =
      if is_write_unit_txn(state.write_unit) or is_nil(state.pending_txn) do
        confirm_flushed_and_notify(state, flushed_offset)
      else
        updated_offset = more_recent_offset(state.pending_flush_offset, flushed_offset)
        %{state | pending_flush_offset: updated_offset}
      end

    {state, timeout} = reply_with_timeout(state)
    {:noreply, state, timeout}
  end
```

For `handle_info({:global_last_seen_lsn, ...})` at line 294:

```elixir
  def handle_info({:global_last_seen_lsn, _lsn} = event, state) do
    case handle_event(event, state) do
      %{terminating?: true} = state ->
        {:noreply, state, {:continue, :stop_and_clean}}

      state ->
        {state, timeout} = reply_with_timeout(state)
        {:noreply, state, timeout}
    end
  end
```

For `handle_info({ShapeCache.Storage, message}, state)` at line 305:

```elixir
  def handle_info({ShapeCache.Storage, message}, state) do
    writer = ShapeCache.Storage.apply_message(state.writer, message)
    state = %{state | writer: writer}
    {state, timeout} = reply_with_timeout(state)
    {:noreply, state, timeout}
  end
```

For `handle_apply_event_result/2` at line 847:

```elixir
  defp handle_apply_event_result(_old_state, {state, notification, _num_changes, _total_size}) do
    if notification do
      :ok = notify_new_changes(state, notification)
    end

    {state, timeout} = reply_with_timeout(state)
    {:noreply, state, timeout}
  end
```

- [ ] **Step 7: Update handle_info({:configure_suspend, ...})**

Update the configure_suspend handler at line 392:

```elixir
  def handle_info({:configure_suspend, hibernate_after, suspend_after, jitter_period}, state) do
    state = cancel_suspend_timer(state)
    state = %{state | hibernate_after: hibernate_after, suspend_after: suspend_after}
    {:noreply, state, Enum.random(hibernate_after..jitter_period)}
  end
```

- [ ] **Step 8: Verify compilation**

Run: `cd packages/sync-service && mix compile --warnings-as-errors`
Expected: Compilation succeeds without warnings

- [ ] **Step 9: Commit**

```bash
git add packages/sync-service/lib/electric/shapes/consumer.ex
git commit -m "$(cat <<'EOF'
feat(sync-service): implement hibernate-then-suspend in Consumer

When suspend is enabled, consumers now:
1. Hibernate first on timeout (triggering GC)
2. Schedule a suspend timer for suspend_after ms later
3. Suspend (terminate) when the suspend timer fires

Any activity cancels the pending suspend timer, restarting the cycle.
This ensures GC runs before eventual process termination.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Update ConsumerRegistry.enable_suspend

**Files:**

- Modify: `packages/sync-service/lib/electric/shapes/consumer_registry.ex:213-253`

- [ ] **Step 1: Update enable_suspend function signature and implementation**

Replace the `enable_suspend/3` function:

```elixir
  @doc """
  Dynamically (re-)enable consumer suspension on all running consumers.

  This allows for dynamically re-configuring consumer suspension even if it was
  disabled, because the configuration message will have the side-effect of
  waking all consumers from hibernation.

  The `jitter_period` value allows for spreading the suspension of existing
  consumers over a large time period to avoid a sudden rush of consumer
  shutdowns after `hibernate_after` ms.

  To re-enable consumer suspend:

      # set the hibernation timeout to 1 minute, suspend timeout to 5 minutes,
      # and phase the suspension of existing consumers over a 20 minute period
      Electric.Shapes.ConsumerRegistry.enable_suspend(stack_id, 60_000, 300_000, 60_000 * 20)

  Disabling suspension is as easy as:

      Electric.StackConfig.put(stack_id, :shape_enable_suspend?, false)

  """
  @spec enable_suspend(stack_id(), pos_integer(), pos_integer(), pos_integer()) ::
          consumer_count :: non_neg_integer()
  def enable_suspend(stack_id, hibernate_after, suspend_after, jitter_period)
      when is_integer(hibernate_after) and is_integer(suspend_after) and
             is_integer(jitter_period) and jitter_period > hibernate_after do
    Electric.StackConfig.put(stack_id, :shape_hibernate_after, hibernate_after)
    Electric.StackConfig.put(stack_id, :shape_suspend_after, suspend_after)
    Electric.StackConfig.put(stack_id, :shape_enable_suspend?, true)

    :ets.foldl(
      fn {_shape_handle, pid}, n ->
        if Process.alive?(pid),
          do: send(pid, {:configure_suspend, hibernate_after, suspend_after, jitter_period})

        n + 1
      end,
      0,
      ets_name(stack_id)
    )
  end
```

- [ ] **Step 2: Verify compilation**

Run: `cd packages/sync-service && mix compile --warnings-as-errors`
Expected: Compilation succeeds without warnings

- [ ] **Step 3: Commit**

```bash
git add packages/sync-service/lib/electric/shapes/consumer_registry.ex
git commit -m "$(cat <<'EOF'
feat(sync-service): update enable_suspend to include suspend_after

Change enable_suspend/3 to enable_suspend/4, adding the suspend_after
parameter to configure the delay between hibernation and suspension.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add Tests for Hibernate-Then-Suspend

**Files:**

- Modify: `packages/sync-service/test/electric/shapes/consumer_test.exs`

- [ ] **Step 1: Add test for hibernate-then-suspend flow**

Add a new test in the "transactions" describe block, after the existing suspend tests (around line 1504):

```elixir
    @tag hibernate_after: 10, suspend_after: 50, with_pure_file_storage_opts: [flush_period: 1]
    @tag suspend: true
    test "should hibernate first then suspend after suspend_after ms", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      txn =
        complete_txn_fragment(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 300}, 1_000

      # Wait for hibernate_after (10ms) + small buffer
      Process.sleep(30)

      # Should be hibernated, not suspended yet
      assert {:current_function, {:gen_server, :loop_hibernate, 4}} =
               Process.info(consumer_pid, :current_function)

      refute_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}, 0

      # Wait for suspend_after (50ms from hibernate) to complete
      Process.sleep(80)

      # Now should be suspended
      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}

      refute Consumer.whereis(ctx.stack_id, shape_handle)
    end
```

- [ ] **Step 2: Add test that activity cancels suspend timer**

Add another test:

```elixir
    @tag hibernate_after: 10, suspend_after: 100, with_pure_file_storage_opts: [flush_period: 1]
    @tag suspend: true
    test "activity during hibernation cancels pending suspend", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)
      lsn2 = Lsn.from_integer(301)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      txn1 =
        complete_txn_fragment(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn1, ctx.stack_id)
      assert_receive {:flush_boundary_updated, 300}, 1_000

      # Wait for hibernate
      Process.sleep(30)

      # Should be hibernated
      assert {:current_function, {:gen_server, :loop_hibernate, 4}} =
               Process.info(consumer_pid, :current_function)

      # Send another transaction - this should cancel the suspend timer
      txn2 =
        complete_txn_fragment(3, lsn2, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "22"},
            log_offset: LogOffset.new(lsn2, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn2, ctx.stack_id)
      assert_receive {:flush_boundary_updated, 301}, 1_000

      # Wait past original suspend_after window
      Process.sleep(150)

      # Should NOT have suspended because activity reset the timer
      refute_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}, 0

      # Process should still be alive (hibernated again)
      assert Process.alive?(consumer_pid)
    end
```

- [ ] **Step 3: Update the setup to handle suspend_after tag**

In the setup block around line 594, add handling for `suspend_after`:

```elixir
    setup(ctx) do
      Electric.StackConfig.put(
        ctx.stack_id,
        :shape_hibernate_after,
        Map.get(ctx, :hibernate_after, 10_000)
      )

      Electric.StackConfig.put(
        ctx.stack_id,
        :shape_suspend_after,
        Map.get(ctx, :suspend_after, 60_000)
      )

      if not Map.get(ctx, :allow_subqueries, true) do
        Electric.StackConfig.put(ctx.stack_id, :feature_flags, [])
      end

      :ok
    end
```

- [ ] **Step 4: Update the enable_suspend test**

Update the existing `ConsumerRegistry.enable_suspend` test at line 1466:

```elixir
    @tag with_pure_file_storage_opts: [flush_period: 1]
    @tag suspend: false
    test "ConsumerRegistry.enable_suspend should suspend hibernated consumers", ctx do
      register_as_replication_client(ctx.stack_id)

      {shape_handle, _} = ShapeCache.get_or_create_shape_handle(@shape1, ctx.stack_id)
      lsn1 = Lsn.from_integer(300)

      :started = ShapeCache.await_snapshot_start(shape_handle, ctx.stack_id)

      consumer_pid = Consumer.whereis(ctx.stack_id, shape_handle)
      assert is_pid(consumer_pid)
      ref = Process.monitor(consumer_pid)

      txn =
        complete_txn_fragment(2, lsn1, [
          %Changes.NewRecord{
            relation: {"public", "test_table"},
            record: %{"id" => "21"},
            log_offset: LogOffset.new(lsn1, 0)
          }
        ])

      assert :ok = ShapeLogCollector.handle_event(txn, ctx.stack_id)

      assert_receive {:flush_boundary_updated, 300}, 1_000

      Process.sleep(60)

      refute_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}

      assert Consumer.whereis(ctx.stack_id, shape_handle)

      # hibernate_after=5, suspend_after=5, jitter_period=10
      Shapes.ConsumerRegistry.enable_suspend(ctx.stack_id, 5, 5, 10)

      Process.sleep(60)

      assert_receive {:DOWN, ^ref, :process, ^consumer_pid, {:shutdown, :suspend}}

      refute Consumer.whereis(ctx.stack_id, shape_handle)
    end
```

- [ ] **Step 5: Run the tests**

Run: `cd packages/sync-service && mix test test/electric/shapes/consumer_test.exs --seed 0 --only suspend`
Expected: All suspend-related tests pass

- [ ] **Step 6: Run full consumer test suite**

Run: `cd packages/sync-service && mix test test/electric/shapes/consumer_test.exs`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/sync-service/test/electric/shapes/consumer_test.exs
git commit -m "$(cat <<'EOF'
test(sync-service): add tests for hibernate-then-suspend behavior

Add tests verifying:
- Consumer hibernates first, then suspends after suspend_after ms
- Activity during hibernation cancels the pending suspend timer
- Update enable_suspend test for new 4-arity function

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update Documentation Comment in Config

**Files:**

- Modify: `packages/sync-service/lib/electric/config.ex`

- [ ] **Step 1: Update the config comment**

Update the comment at lines 88-91:

```elixir
    # After this duration of inactivity, consumer processes will hibernate
    # to allow garbage collection
    shape_hibernate_after: :timer.seconds(30),
    # If enabled, terminate (suspend) consumer processes after hibernating.
    # This frees memory more aggressively than hibernation alone.
    shape_enable_suspend?: false,
    # After hibernating, wait this duration before suspending (terminating).
    # Only applies when shape_enable_suspend? is true.
    shape_suspend_after: :timer.seconds(60),
```

- [ ] **Step 2: Commit**

```bash
git add packages/sync-service/lib/electric/config.ex
git commit -m "$(cat <<'EOF'
docs(sync-service): clarify hibernate/suspend config comments

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd packages/sync-service && mix test`
Expected: All tests pass

- [ ] **Step 2: Run formatter**

Run: `cd packages/sync-service && mix format`
Expected: No changes (code already formatted) or auto-formats

- [ ] **Step 3: Run dialyzer (if available)**

Run: `cd packages/sync-service && mix dialyzer`
Expected: No errors

- [ ] **Step 4: Final commit if any formatting changes**

```bash
git add -A
git diff --cached --quiet || git commit -m "$(cat <<'EOF'
chore(sync-service): format code

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```
