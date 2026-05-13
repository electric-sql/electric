defmodule Electric.Shapes.Filter.Indexes.LogicalTimeSubqueryIndex do
  @moduledoc """
  Experimental prototype for shared subquery views with logical-time reads.

  This module is intentionally not wired into the production filter path. It is
  a compact model for evaluating whether one shared, versioned materialized view
  can replace per-shape subquery membership rows while preserving exact reads at
  different consumer logical times.
  """

  @type t() :: %__MODULE__{
          cohorts: :ets.tid(),
          value_history: :ets.tid(),
          participants: :ets.tid(),
          participants_by_shape: :ets.tid(),
          participants_by_time: :ets.tid(),
          active_time_counts: :ets.tid(),
          cohort_times: :ets.tid()
        }

  @type cohort_id() :: term()
  @type participant_id() :: pos_integer()
  @type logical_time() :: non_neg_integer()
  @type polarity() :: :positive | :negated
  @type membership_change() :: {term(), boolean()}

  defstruct [
    :cohorts,
    :value_history,
    :participants,
    :participants_by_shape,
    :participants_by_time,
    :active_time_counts,
    :cohort_times
  ]

  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    table_opts = Keyword.get(opts, :table_opts, []) ++ [:public]

    %__MODULE__{
      cohorts: :ets.new(:logical_time_subquery_index_cohorts, [:set | table_opts]),
      value_history: :ets.new(:logical_time_subquery_index_value_history, [:set | table_opts]),
      participants: :ets.new(:logical_time_subquery_index_participants, [:set | table_opts]),
      participants_by_shape:
        :ets.new(:logical_time_subquery_index_participants_by_shape, [:bag | table_opts]),
      participants_by_time:
        :ets.new(:logical_time_subquery_index_participants_by_time, [:bag | table_opts]),
      active_time_counts:
        :ets.new(:logical_time_subquery_index_active_time_counts, [:set | table_opts]),
      cohort_times: :ets.new(:logical_time_subquery_index_cohort_times, [:bag | table_opts])
    }
  end

  @spec delete(t()) :: :ok
  def delete(%__MODULE__{} = index) do
    index
    |> Map.from_struct()
    |> Map.values()
    |> Enum.each(&:ets.delete/1)

    :ok
  end

  @spec tables(t()) :: [:ets.tid()]
  def tables(%__MODULE__{} = index) do
    index
    |> Map.from_struct()
    |> Map.values()
  end

  @spec new_cohort(t(), cohort_id(), Enumerable.t()) :: :ok
  def new_cohort(%__MODULE__{} = index, cohort_id, initial_values \\ []) do
    :ets.insert(index.cohorts, {cohort_id, 0})

    initial_values
    |> MapSet.new()
    |> Enum.each(fn value ->
      :ets.insert(index.value_history, {{cohort_id, value}, [{0, true}]})
    end)

    :ok
  end

  @spec latest_time(t(), cohort_id()) :: logical_time()
  def latest_time(%__MODULE__{} = index, cohort_id) do
    case :ets.lookup(index.cohorts, cohort_id) do
      [{^cohort_id, time}] -> time
      [] -> raise ArgumentError, "unknown cohort #{inspect(cohort_id)}"
    end
  end

  @spec advance(t(), cohort_id(), Enumerable.t(membership_change())) :: logical_time()
  def advance(%__MODULE__{} = index, cohort_id, changes) do
    current_time = latest_time(index, cohort_id)
    next_time = current_time + 1

    changes
    |> Map.new()
    |> Enum.each(fn {value, desired_member?} ->
      set_member_at_time(index, cohort_id, value, current_time, next_time, desired_member?)
    end)

    :ets.insert(index.cohorts, {cohort_id, next_time})
    next_time
  end

  @spec add_participant(t(), term(), cohort_id(), polarity(), keyword()) :: participant_id()
  def add_participant(%__MODULE__{} = index, shape_handle, cohort_id, polarity, opts \\ [])
      when polarity in [:positive, :negated] do
    time = Keyword.get(opts, :time, latest_time(index, cohort_id))
    routing = Keyword.get(opts, :routing)
    participant_id = Keyword.get(opts, :participant_id, System.unique_integer([:positive]))

    :ets.insert(
      index.participants,
      {participant_id, cohort_id, shape_handle, polarity, time, routing}
    )

    :ets.insert(index.participants_by_shape, {shape_handle, participant_id})
    :ets.insert(index.participants_by_time, {{cohort_id, time, polarity}, participant_id})
    increment_active_time(index, cohort_id, time)

    participant_id
  end

  @spec set_participant_time(t(), participant_id(), logical_time()) :: :ok
  def set_participant_time(%__MODULE__{} = index, participant_id, time) do
    case :ets.lookup(index.participants, participant_id) do
      [{^participant_id, cohort_id, shape_handle, polarity, old_time, routing}] ->
        if old_time != time do
          :ets.match_delete(
            index.participants_by_time,
            {{cohort_id, old_time, polarity}, participant_id}
          )

          decrement_active_time(index, cohort_id, old_time)
          :ets.insert(index.participants_by_time, {{cohort_id, time, polarity}, participant_id})
          increment_active_time(index, cohort_id, time)

          :ets.insert(
            index.participants,
            {participant_id, cohort_id, shape_handle, polarity, time, routing}
          )
        end

        :ok

      [] ->
        raise ArgumentError, "unknown participant #{inspect(participant_id)}"
    end
  end

  @spec remove_participant(t(), participant_id()) :: :ok
  def remove_participant(%__MODULE__{} = index, participant_id) do
    case :ets.lookup(index.participants, participant_id) do
      [{^participant_id, cohort_id, shape_handle, polarity, time, _routing}] ->
        :ets.delete(index.participants, participant_id)
        :ets.match_delete(index.participants_by_shape, {shape_handle, participant_id})

        :ets.match_delete(
          index.participants_by_time,
          {{cohort_id, time, polarity}, participant_id}
        )

        decrement_active_time(index, cohort_id, time)
        :ok

      [] ->
        :ok
    end
  end

  @spec remove_shape(t(), term()) :: :ok
  def remove_shape(%__MODULE__{} = index, shape_handle) do
    index.participants_by_shape
    |> :ets.lookup(shape_handle)
    |> Enum.each(fn {^shape_handle, participant_id} ->
      remove_participant(index, participant_id)
    end)

    :ok
  end

  @spec member?(t(), cohort_id(), logical_time(), term()) :: boolean()
  def member?(%__MODULE__{} = index, cohort_id, time, value)
      when is_integer(time) and time >= 0 do
    index
    |> history_for(cohort_id, value)
    |> member_from_history(time)
  end

  @spec participant_member?(t(), participant_id(), term()) :: boolean()
  def participant_member?(%__MODULE__{} = index, participant_id, value) do
    case :ets.lookup(index.participants, participant_id) do
      [{^participant_id, cohort_id, _shape_handle, _polarity, time, _routing}] ->
        member?(index, cohort_id, time, value)

      [] ->
        raise ArgumentError, "unknown participant #{inspect(participant_id)}"
    end
  end

  @spec values_at(t(), cohort_id(), logical_time()) :: MapSet.t()
  def values_at(%__MODULE__{} = index, cohort_id, time) do
    index
    |> values_for_cohort(cohort_id)
    |> Enum.filter(&member?(index, cohort_id, time, &1))
    |> MapSet.new()
  end

  @spec route(t(), cohort_id(), term()) :: MapSet.t(participant_id())
  def route(%__MODULE__{} = index, cohort_id, value) do
    index
    |> active_times(cohort_id)
    |> Enum.reduce(MapSet.new(), fn time, acc ->
      polarity = if member?(index, cohort_id, time, value), do: :positive, else: :negated

      index.participants_by_time
      |> :ets.lookup({cohort_id, time, polarity})
      |> Enum.reduce(acc, fn {{^cohort_id, ^time, ^polarity}, participant_id}, acc ->
        MapSet.put(acc, participant_id)
      end)
    end)
  end

  @spec compact(t(), cohort_id(), logical_time()) :: :ok
  def compact(%__MODULE__{} = index, cohort_id, min_time)
      when is_integer(min_time) and min_time >= 0 do
    index
    |> values_for_cohort(cohort_id)
    |> Enum.each(fn value ->
      history =
        index
        |> history_for(cohort_id, value)
        |> compact_history(min_time)

      put_history(index, cohort_id, value, history)
    end)

    :ok
  end

  @spec stats(t()) :: map()
  def stats(%__MODULE__{} = index) do
    %{
      cohorts: :ets.info(index.cohorts, :size),
      value_history: :ets.info(index.value_history, :size),
      participants: :ets.info(index.participants, :size),
      participants_by_shape: :ets.info(index.participants_by_shape, :size),
      participants_by_time: :ets.info(index.participants_by_time, :size),
      active_time_counts: :ets.info(index.active_time_counts, :size),
      cohort_times: :ets.info(index.cohort_times, :size)
    }
  end

  defp set_member_at_time(index, cohort_id, value, current_time, next_time, desired_member?) do
    current_member? = member?(index, cohort_id, current_time, value)

    if current_member? != desired_member? do
      history = [{next_time, desired_member?} | history_for(index, cohort_id, value)]
      put_history(index, cohort_id, value, history)
    end
  end

  defp history_for(index, cohort_id, value) do
    case :ets.lookup(index.value_history, {cohort_id, value}) do
      [{{^cohort_id, ^value}, history}] -> history
      [] -> []
    end
  end

  defp put_history(index, cohort_id, value, history) do
    history = normalize_history(history)

    if Enum.any?(history, fn {_time, member?} -> member? end) do
      :ets.insert(index.value_history, {{cohort_id, value}, history})
    else
      :ets.delete(index.value_history, {cohort_id, value})
    end
  end

  defp normalize_history(history) do
    history
    |> Enum.sort_by(fn {time, _member?} -> time end, :desc)
    |> Enum.uniq_by(fn {time, _member?} -> time end)
  end

  defp member_from_history(history, time) do
    case Enum.find(history, fn {entry_time, _member?} -> entry_time <= time end) do
      {_entry_time, member?} -> member?
      nil -> false
    end
  end

  defp values_for_cohort(index, cohort_id) do
    index.value_history
    |> :ets.match({{cohort_id, :"$1"}, :_})
    |> List.flatten()
  end

  defp active_times(index, cohort_id) do
    index.cohort_times
    |> :ets.lookup(cohort_id)
    |> Enum.map(fn {^cohort_id, time} -> time end)
  end

  defp compact_history(history, min_time) do
    newer = Enum.filter(history, fn {time, _member?} -> time >= min_time end)
    has_min_entry? = Enum.any?(newer, fn {time, _member?} -> time == min_time end)

    boundary =
      case Enum.find(history, fn {time, _member?} -> time < min_time end) do
        {_time, true} when not has_min_entry? -> [{min_time, true}]
        _ -> []
      end

    normalize_history(newer ++ boundary)
  end

  defp increment_active_time(index, cohort_id, time) do
    count =
      :ets.update_counter(
        index.active_time_counts,
        {cohort_id, time},
        {2, 1},
        {{cohort_id, time}, 0}
      )

    if count == 1 do
      :ets.insert(index.cohort_times, {cohort_id, time})
    end
  end

  defp decrement_active_time(index, cohort_id, time) do
    case :ets.lookup(index.active_time_counts, {cohort_id, time}) do
      [] ->
        :ok

      [{{^cohort_id, ^time}, 1}] ->
        :ets.delete(index.active_time_counts, {cohort_id, time})
        :ets.match_delete(index.cohort_times, {cohort_id, time})

      [{{^cohort_id, ^time}, count}] when count > 1 ->
        :ets.update_counter(index.active_time_counts, {cohort_id, time}, {2, -1})
    end
  end
end
