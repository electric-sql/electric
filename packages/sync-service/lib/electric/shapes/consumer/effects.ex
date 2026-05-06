defmodule Electric.Shapes.Consumer.Effects do
  @moduledoc false
  # These are the runtime effects emitted by event handlers after functional
  # event processing. Consumer bootstrapping and other imperative setup steps
  # live in SetupEffects rather than being mixed into this runtime effect layer.

  alias Electric.Connection.Manager
  alias Electric.Postgres.SnapshotQuery
  alias Electric.Shapes.Filter.Indexes.SubqueryIndex
  alias Electric.ShapeCache.Storage
  alias Electric.LogItems
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache
  alias Electric.Shapes.Querying
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  defmodule AppendChanges do
    @moduledoc false
    defstruct changes: [], xid: nil
  end

  defmodule AppendControl do
    @moduledoc false
    defstruct message: nil
  end

  defmodule AppendMoveInSnapshot do
    @moduledoc false
    defstruct [:snapshot_name, :snapshot, row_count: 0, row_bytes: 0]
  end

  defmodule NotifyFlushed do
    @moduledoc false
    defstruct [:log_offset]
  end

  defmodule StartMoveInQuery do
    @moduledoc false
    defstruct [:dnf_plan, :trigger_dep_index, :values, :views_before_move, :views_after_move]

    @type t() :: %__MODULE__{
            dnf_plan: Electric.Shapes.DnfPlan.t(),
            trigger_dep_index: non_neg_integer(),
            values: list(),
            views_before_move: Electric.Shapes.Consumer.Subqueries.Views.t(),
            views_after_move: Electric.Shapes.Consumer.Subqueries.Views.t()
          }
  end

  defmodule SubscribeGlobalLsn do
    @moduledoc false
    defstruct []
  end

  defmodule UnsubscribeGlobalLsn do
    @moduledoc false
    defstruct []
  end

  defmodule AddToSubqueryIndex do
    @moduledoc false
    defstruct [:dep_index, :subquery_ref, :values]
  end

  defmodule RemoveFromSubqueryIndex do
    @moduledoc false
    defstruct [:dep_index, :subquery_ref, :values]
  end

  @type t() ::
          %AppendChanges{}
          | %AppendControl{}
          | %AppendMoveInSnapshot{}
          | %NotifyFlushed{}
          | %StartMoveInQuery{}
          | %SubscribeGlobalLsn{}
          | %UnsubscribeGlobalLsn{}
          | %AddToSubqueryIndex{}
          | %RemoveFromSubqueryIndex{}

  @type execution_result() :: %{
          state: term(),
          num_changes: non_neg_integer(),
          total_size: non_neg_integer(),
          pending_written_offset: LogOffset.t() | nil
        }

  @spec execute([t()], term(), keyword()) :: execution_result()
  def execute(effects, state, _opts \\ []) when is_list(effects) do
    Enum.reduce(
      effects,
      %{state: state, num_changes: 0, total_size: 0, pending_written_offset: nil},
      fn effect, acc ->
        execute_effect(effect, acc)
      end
    )
  end

  defp execute_effect(%AppendChanges{changes: [], xid: _}, acc), do: acc

  defp execute_effect(%AppendChanges{changes: changes, xid: xid}, acc) do
    state = acc.state

    {lines, total_size, state} =
      Enum.reduce(changes, {[], 0, state}, fn change, {lines, size, state} ->
        {new_lines, line_size} = change_to_log_lines(change, xid, state.shape)
        last_offset = new_lines |> List.last() |> elem(0)
        {lines ++ new_lines, size + line_size, %{state | latest_offset: last_offset}}
      end)

    writer = ShapeCache.Storage.append_to_log!(lines, state.writer)
    state = %{state | writer: writer}

    %{
      acc
      | state: state,
        num_changes: acc.num_changes + length(lines),
        total_size: acc.total_size + total_size,
        pending_written_offset: state.latest_offset
    }
  end

  defp execute_effect(%AppendControl{message: message}, acc) do
    state = acc.state
    encoded = Jason.encode!(message)

    {{_, offset}, writer} =
      ShapeCache.Storage.append_control_message!(encoded, state.writer)

    state = %{state | writer: writer, latest_offset: offset}

    %{
      acc
      | state: state,
        num_changes: acc.num_changes + 1,
        total_size: acc.total_size + byte_size(encoded),
        pending_written_offset: state.latest_offset
    }
  end

  defp execute_effect(
         %AppendMoveInSnapshot{
           snapshot_name: snapshot_name,
           row_count: row_count,
           row_bytes: row_bytes,
           snapshot: snapshot
         },
         acc
       ) do
    state = acc.state

    {{_, inserted_offset}, writer} =
      ShapeCache.Storage.append_move_in_snapshot_to_log!(
        snapshot_name,
        state.writer,
        fn _, _ -> false end
      )

    state = %{state | writer: writer, latest_offset: inserted_offset}

    if row_count == 0 do
      %{acc | state: state}
    else
      snapshot_end =
        snapshot
        |> snapshot_end_message()
        |> Jason.encode!()

      {{_, offset}, writer} =
        ShapeCache.Storage.append_control_message!(snapshot_end, state.writer)

      state = %{state | writer: writer, latest_offset: offset}

      %{
        acc
        | state: state,
          num_changes: acc.num_changes + row_count + 1,
          total_size: acc.total_size + row_bytes + byte_size(snapshot_end),
          pending_written_offset: state.latest_offset
      }
    end
  end

  defp execute_effect(%NotifyFlushed{log_offset: log_offset}, acc) do
    state = acc.state

    state =
      if acc.pending_written_offset do
        %{
          state
          | txn_offset_mapping:
              state.txn_offset_mapping ++ [{acc.pending_written_offset, log_offset}]
        }
      else
        consider_flushed(state, log_offset)
      end

    %{acc | state: state, pending_written_offset: nil}
  end

  defp execute_effect(%StartMoveInQuery{} = effect, acc) do
    state = acc.state
    supervisor = Electric.ProcessRegistry.name(state.stack_id, Electric.StackTaskSupervisor)
    query_move_in_async(supervisor, state, effect, self())
    acc
  end

  defp execute_effect(%SubscribeGlobalLsn{}, acc) do
    {:ok, _} = Electric.LsnTracker.subscribe_to_global_lsn_updates(acc.state.stack_id)

    acc
  end

  defp execute_effect(%UnsubscribeGlobalLsn{}, acc) do
    :ok = Electric.LsnTracker.unsubscribe_from_global_lsn_updates(acc.state.stack_id)
    acc
  end

  defp execute_effect(%AddToSubqueryIndex{} = effect, acc) do
    update_subquery_index(acc, effect.dep_index, effect.subquery_ref, effect.values, :add)
  end

  defp execute_effect(%RemoveFromSubqueryIndex{} = effect, acc) do
    update_subquery_index(acc, effect.dep_index, effect.subquery_ref, effect.values, :remove)
  end

  defp update_subquery_index(acc, dep_index, subquery_ref, values, op) do
    state = acc.state
    index = SubqueryIndex.for_stack(state.stack_id)
    fun = if op == :add, do: &SubqueryIndex.add_value/5, else: &SubqueryIndex.remove_value/5

    for {value, _original} <- values do
      fun.(index, state.shape_handle, subquery_ref, dep_index, value)
    end

    acc
  end

  @spec query_move_in_async(pid() | atom(), map(), StartMoveInQuery.t(), pid()) :: :ok
  def query_move_in_async(
        supervisor,
        consumer_state,
        %StartMoveInQuery{} = request,
        consumer_pid
      ) do
    {where, params} =
      Querying.move_in_where_clause(
        request.dnf_plan,
        request.trigger_dep_index,
        request.views_before_move,
        request.views_after_move,
        consumer_state.shape.where.used_refs
      )

    pool = Manager.pool_name(consumer_state.stack_id, :snapshot)
    stack_id = consumer_state.stack_id
    shape = consumer_state.shape
    shape_handle = consumer_state.shape_handle

    :telemetry.execute([:electric, :subqueries, :move_in_triggered], %{count: 1}, %{
      stack_id: stack_id
    })

    # Propagate OTel context so spans created inside the task are linked to the
    # caller's trace. OTel context is per-process, so without this any
    # `with_child_span` calls in the task would be silently dropped.
    trace_context = OpenTelemetry.get_current_context()

    Task.Supervisor.start_child(supervisor, fn ->
      OpenTelemetry.set_current_context(trace_context)

      snapshot_name = Electric.Utils.uuid4()

      try do
        SnapshotQuery.execute_for_shape(pool, shape_handle, shape,
          stack_id: stack_id,
          query_reason: "move_in_query",
          snapshot_info_fn: fn _, pg_snapshot, _lsn ->
            send(consumer_pid, {:pg_snapshot_known, pg_snapshot})
          end,
          query_fn: fn conn, _pg_snapshot, lsn ->
            task_pid = self()

            Querying.query_move_in(conn, stack_id, shape_handle, shape, {where, params},
              dnf_plan: request.dnf_plan,
              views: request.views_after_move
            )
            |> Stream.transform(
              fn -> {0, 0} end,
              fn [_, _, json] = row, {row_count, row_bytes} ->
                {[row], {row_count + 1, row_bytes + IO.iodata_length(json)}}
              end,
              fn {row_count, row_bytes} ->
                send(task_pid, {:move_in_snapshot_stats, row_count, row_bytes})
              end
            )
            |> Storage.write_move_in_snapshot!(snapshot_name, consumer_state.storage)

            {row_count, row_bytes} =
              receive do
                {:move_in_snapshot_stats, row_count, row_bytes} -> {row_count, row_bytes}
              end

            send(
              consumer_pid,
              {:query_move_in_complete, snapshot_name, row_count, row_bytes, lsn}
            )
          end
        )
      rescue
        error ->
          send(consumer_pid, {:query_move_in_error, error, __STACKTRACE__})
      end
    end)

    :ok
  end

  defp consider_flushed(state, log_offset) do
    alias Electric.Replication.ShapeLogCollector

    if state.txn_offset_mapping == [] do
      ShapeLogCollector.notify_flushed(state.stack_id, state.shape_handle, log_offset)
      state
    else
      new_boundary = log_offset

      {head, tail} =
        Enum.split_while(
          state.txn_offset_mapping,
          &(LogOffset.compare(elem(&1, 1), new_boundary) == :lt)
        )

      case Enum.reverse(head) do
        [] ->
          state

        [{offset, _} | rest] ->
          %{state | txn_offset_mapping: Enum.reverse([{offset, new_boundary} | rest], tail)}
      end
    end
  end

  defp change_to_log_lines(change, xid, shape) do
    lines =
      change
      |> LogItems.from_change(
        xid,
        Shape.pk(shape, change.relation),
        shape.replica
      )
      |> Enum.map(fn {offset, %{key: key} = log_item} ->
        {offset, key, log_item.headers.operation, Jason.encode!(log_item)}
      end)

    size = Enum.reduce(lines, 0, fn {_, _, _, json}, acc -> acc + byte_size(json) end)
    {lines, size}
  end

  defp snapshot_end_message({xmin, xmax, xip_list}) do
    %{
      headers: %{
        control: "snapshot-end",
        xmin: to_string(xmin),
        xmax: to_string(xmax),
        xip_list: Enum.map(xip_list, &to_string/1)
      }
    }
  end
end
