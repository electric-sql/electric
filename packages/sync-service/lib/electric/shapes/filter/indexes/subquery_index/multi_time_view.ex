defmodule Electric.Shapes.Filter.Indexes.SubqueryIndex.MultiTimeView do
  @moduledoc """
  Shared, logical-time view of subquery membership.

  Stores one membership history per `{subquery_id, value}` pair, plus
  per-subquery metadata (current logical time, min required time, ready flag),
  all in a single ETS table per stack. Multiple consumer processes can read
  the same view at different logical times without copying it into their own
  state.

  See `docs/rfcs/subquery-index.md` for the broader design.
  """

  import Electric, only: [is_stack_id: 1]

  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.History

  @type t :: :ets.tid() | atom()
  @type subquery_id :: term()
  @type value :: term()
  @type time :: non_neg_integer()

  defp table_name(stack_id) when is_stack_id(stack_id),
    do: :"multi_time_view:#{stack_id}"

  @doc """
  Create a new MultiTimeView ETS table.

  The table is `:public` so the materializer can write transitions while
  consumer processes read membership.
  """
  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    case Keyword.get(opts, :stack_id) do
      nil ->
        :ets.new(:multi_time_view, [:set, :public])

      stack_id ->
        try do
          :ets.new(table_name(stack_id), [:set, :public, :named_table])
        rescue
          ArgumentError -> table_name(stack_id)
        end
    end
  end

  @doc "Look up the MultiTimeView table for a stack, or `nil` if none exists."
  @spec for_stack(String.t()) :: t() | nil
  def for_stack(stack_id) when is_stack_id(stack_id) do
    case :ets.whereis(table_name(stack_id)) do
      :undefined -> nil
      _tid -> table_name(stack_id)
    end
  end

  @doc """
  Initialise a subquery at logical time `0` with the given initial member
  values. The subquery is left not-ready; call `mark_ready/2` once initial
  population is finished.
  """
  @spec init_subquery(t(), subquery_id(), Enumerable.t()) :: :ok
  def init_subquery(view, subquery_id, initial_values) do
    :ets.insert(view, {{:current_time, subquery_id}, 0})
    :ets.insert(view, {{:min_required_time, subquery_id}, 0})

    for value <- initial_values do
      :ets.insert(view, {{:value, subquery_id, value}, History.new()})
    end

    :ok
  end

  @doc "Mark a subquery as ready for consumers to read."
  @spec mark_ready(t(), subquery_id()) :: :ok
  def mark_ready(view, subquery_id) do
    :ets.insert(view, {{:ready, subquery_id}, true})
    :ok
  end

  @doc "Is the subquery ready for consumers to read?"
  @spec ready?(t(), subquery_id()) :: boolean()
  def ready?(view, subquery_id) do
    :ets.member(view, {:ready, subquery_id})
  end

  @doc """
  Record that `value` becomes a member of `subquery_id` from `time` onwards.
  Advances the subquery's current logical time to `time`.
  """
  @spec mark_in(t(), subquery_id(), value(), time()) :: :ok
  def mark_in(view, subquery_id, value, time) do
    update_history(view, subquery_id, value, &History.mark_in(&1, time))
    advance_current_time(view, subquery_id, time)
    :ok
  end

  @doc """
  Record that `value` stops being a member of `subquery_id` from `time`
  onwards. Advances the subquery's current logical time to `time`.
  """
  @spec mark_out(t(), subquery_id(), value(), time()) :: :ok
  def mark_out(view, subquery_id, value, time) do
    update_history(view, subquery_id, value, &History.mark_out(&1, time))
    advance_current_time(view, subquery_id, time)
    :ok
  end

  @doc "Is `value` a member of `subquery_id` at logical `time`?"
  @spec member?(t(), subquery_id(), value(), time()) :: boolean()
  def member?(view, subquery_id, value, time) do
    view |> lookup_history(subquery_id, value) |> History.member?(time)
  end

  @doc "Is `value` a member of `subquery_id` at any retained logical time?"
  @spec member_at_some_time?(t(), subquery_id(), value()) :: boolean()
  def member_at_some_time?(view, subquery_id, value) do
    view |> lookup_history(subquery_id, value) |> History.member_at_some_time?()
  end

  @doc "Is `value` a member of `subquery_id` at every retained logical time?"
  @spec member_at_all_times?(t(), subquery_id(), value()) :: boolean()
  def member_at_all_times?(view, subquery_id, value) do
    view |> lookup_history(subquery_id, value) |> History.member_at_all_times?()
  end

  @doc "All values retained for `subquery_id` (members at some retained time)."
  @spec values(t(), subquery_id()) :: [value()]
  def values(view, subquery_id) do
    view
    |> :ets.match({{:value, subquery_id, :"$1"}, :_})
    |> Enum.map(fn [value] -> value end)
  end

  @doc "All values that are members of `subquery_id` at logical `time`."
  @spec values(t(), subquery_id(), time()) :: [value()]
  def values(view, subquery_id, time) do
    view
    |> :ets.match({{:value, subquery_id, :"$1"}, :"$2"})
    |> Enum.flat_map(fn [value, history] ->
      if History.member?(history, time), do: [value], else: []
    end)
  end

  @doc "Current logical time for `subquery_id`, or `nil` if unknown."
  @spec current_time(t(), subquery_id()) :: time() | nil
  def current_time(view, subquery_id) do
    case :ets.lookup(view, {:current_time, subquery_id}) do
      [{_, time}] -> time
      [] -> nil
    end
  end

  @doc """
  Advance the minimum required logical time for `subquery_id` and compact all
  retained histories. Returns the list of values whose history compacted to
  empty (and were therefore deleted) — useful for cascading routing cleanup.
  """
  @spec set_min_required_time(t(), subquery_id(), time()) :: [value()]
  def set_min_required_time(view, subquery_id, time) do
    :ets.insert(view, {{:min_required_time, subquery_id}, time})

    view
    |> :ets.match({{:value, subquery_id, :"$1"}, :"$2"})
    |> Enum.flat_map(fn [value, history] ->
      case compact_history(view, subquery_id, value, history, time) do
        :deleted -> [value]
        :ok -> []
      end
    end)
  end

  @doc """
  All `subquery_id`s currently tracked by this view (every subquery that
  has been initialised and not yet `remove_subquery`'d).
  """
  @spec subquery_ids(t()) :: [subquery_id()]
  def subquery_ids(view) do
    view
    |> :ets.match({{:current_time, :"$1"}, :_})
    |> Enum.map(fn [id] -> id end)
  end

  @doc "Delete every row for `subquery_id`."
  @spec remove_subquery(t(), subquery_id()) :: :ok
  def remove_subquery(view, subquery_id) do
    :ets.match_delete(view, {{:value, subquery_id, :_}, :_})
    :ets.delete(view, {:current_time, subquery_id})
    :ets.delete(view, {:min_required_time, subquery_id})
    :ets.delete(view, {:ready, subquery_id})
    :ok
  end

  defp lookup_history(view, subquery_id, value) do
    case :ets.lookup(view, {:value, subquery_id, value}) do
      [{_, history}] -> history
      [] -> nil
    end
  end

  defp update_history(view, subquery_id, value, fun) do
    history = lookup_history(view, subquery_id, value)

    case fun.(history) do
      ^history -> :ok
      nil -> :ets.delete(view, {:value, subquery_id, value})
      new -> :ets.insert(view, {{:value, subquery_id, value}, new})
    end
  end

  defp advance_current_time(view, subquery_id, time) do
    case current_time(view, subquery_id) do
      nil ->
        :ets.insert(view, {{:current_time, subquery_id}, time})

      current when time > current ->
        :ets.insert(view, {{:current_time, subquery_id}, time})

      _ ->
        :ok
    end
  end

  defp compact_history(view, subquery_id, value, history, min_required_time) do
    case History.compact(history, min_required_time) do
      ^history ->
        :ok

      nil ->
        :ets.delete(view, {:value, subquery_id, value})
        :deleted

      new ->
        :ets.insert(view, {{:value, subquery_id, value}, new})
        :ok
    end
  end
end
