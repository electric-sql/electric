defmodule Electric.Shapes.Filter.Indexes.SubqueryIndex.History do
  @moduledoc """
  Purely functional representation of a single value's membership history in a
  subquery's shared multi-time view.

  A history records the times at which a value's membership of a subquery
  toggled. It always has one of these shapes:

      []                          # in at every retained logical time
      [:in  | :out, t1, t2, ...]  # initial state, then toggle times

  The first element is the membership at the start of the retained window. Each
  subsequent integer is a logical time at which membership flipped; toggle
  times are strictly increasing.

  ## Examples

      []              # member at all retained times
      [:out, 9]       # out before 9, in from 9 onwards
      [:out, 9, 11]   # out before 9, in from 9..10, out from 11 onwards
      [:in, 9]        # in before 9, out from 9 onwards
      [:in, 9, 11]    # in before 9, out from 9..10, in from 11 onwards

  ## Absence

  `nil` represents a value that is not a member at any retained logical time —
  no row exists for it in the shared view. This module treats `nil` as a
  first-class history for all queries. Constructors and `compact/2` return
  `nil` when the value is entirely out for the retained window.
  """

  @type time :: non_neg_integer()
  @type t :: [] | nonempty_list(:in | :out | time())
  @type history :: t() | nil

  @doc "A history for a value that is a member at every retained logical time."
  @spec new() :: t()
  def new(), do: []

  @doc """
  Is the value a member at `time`?

  `nil` histories are never members.
  """
  @spec member?(history(), time()) :: boolean()
  def member?(nil, _time), do: false
  def member?([], _time), do: true

  def member?([initial | toggles], time) do
    toggles_at_or_before = Enum.count(toggles, &(&1 <= time))

    case rem(toggles_at_or_before, 2) do
      0 -> initial == :in
      1 -> initial == :out
    end
  end

  @doc "Is the value a member at any retained logical time?"
  @spec member_at_some_time?(history()) :: boolean()
  def member_at_some_time?(nil), do: false
  def member_at_some_time?(_history), do: true

  @doc "Is the value a member at every retained logical time?"
  @spec member_at_all_times?(history()) :: boolean()
  def member_at_all_times?([]), do: true
  def member_at_all_times?(_history), do: false

  @doc """
  Record that the value becomes a member from `time` onwards.

  A no-op when the latest tracked state is already `:in`. `time` must be
  strictly greater than any previously recorded toggle.
  """
  @spec mark_in(history(), time()) :: t()
  def mark_in(nil, time), do: [:out, time]
  def mark_in([], _time), do: []

  def mark_in([initial | toggles] = history, time) do
    case last_state(initial, toggles) do
      :in -> history
      :out -> [initial | toggles ++ [time]]
    end
  end

  @doc """
  Record that the value stops being a member from `time` onwards.

  A no-op when the latest tracked state is already `:out`. `time` must be
  strictly greater than any previously recorded toggle.
  """
  @spec mark_out(history(), time()) :: history()
  def mark_out(nil, _time), do: nil
  def mark_out([], time), do: [:in, time]

  def mark_out([initial | toggles] = history, time) do
    case last_state(initial, toggles) do
      :out -> history
      :in -> [initial | toggles ++ [time]]
    end
  end

  @doc """
  Drop toggles at or before `min_required_time`, folding their effect into the
  initial state.

  Returns `nil` if, after compaction, the value is out for the entire retained
  window — the row can be deleted from the shared view.
  """
  @spec compact(history(), time()) :: history()
  def compact(nil, _min_required_time), do: nil
  def compact([], _min_required_time), do: []

  def compact([initial | toggles], min_required_time) do
    {folded, kept} = Enum.split_with(toggles, &(&1 <= min_required_time))

    new_initial =
      if rem(length(folded), 2) == 0, do: initial, else: flip(initial)

    case {new_initial, kept} do
      {:in, []} -> []
      {:out, []} -> nil
      {state, times} -> [state | times]
    end
  end

  defp last_state(initial, toggles) do
    if rem(length(toggles), 2) == 0, do: initial, else: flip(initial)
  end

  defp flip(:in), do: :out
  defp flip(:out), do: :in
end
