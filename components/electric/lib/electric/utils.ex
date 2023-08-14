defmodule Electric.Utils do
  @moduledoc """
  General purpose utils library to be used internally in electric
  """

  @doc """
  Helper function to be used for GenStage alike processes to control
  demand and amount of produced events
  """
  @spec fetch_demand_from_queue(pos_integer(), :queue.queue()) ::
          {non_neg_integer(), [term()], :queue.queue()}
  def fetch_demand_from_queue(0, events) do
    {0, [], events}
  end

  def fetch_demand_from_queue(demand, events) do
    len_ev = :queue.len(events)

    case demand > len_ev do
      true ->
        send_events = :queue.to_list(events)
        {demand - len_ev, send_events, :queue.new()}

      false ->
        {demanded, remaining} = :queue.split(demand, events)
        {0, :queue.to_list(demanded), remaining}
    end
  end

  @doc """
  Helper function to add events from list to existing queue
  """
  @spec add_events_to_queue([term()], :queue.queue(term())) :: :queue.queue(term())
  def add_events_to_queue(events, queue) when is_list(events) do
    :queue.join(queue, :queue.from_list(events))
  end

  @doc """
  Get the last element of the list and the list's length in one pass.

  Returns the default element if the list is empty
  """
  @spec list_last_and_length(list(), any(), non_neg_integer()) :: {any(), non_neg_integer()}
  def list_last_and_length(list, default \\ nil, length_acc \\ 0)
  def list_last_and_length([], default, 0), do: {default, 0}
  def list_last_and_length([elem | []], _, length), do: {elem, length + 1}

  def list_last_and_length([_ | list], default, length),
    do: list_last_and_length(list, default, length + 1)

  @doc """
  Check if the list has any duplicates.

  ## Examples

      iex> has_duplicates?([:a, :b])
      false

      iex> has_duplicates?([:a, :a])
      true
  """
  def has_duplicates?(list, acc \\ MapSet.new())
  def has_duplicates?([], _), do: false

  def has_duplicates?([head | tail], acc),
    do: MapSet.member?(acc, head) || has_duplicates?(tail, MapSet.put(acc, head))

  @doc """
  Check if the list has any duplicates using a mapping function.

  ## Examples

      iex> has_duplicates_by?(["a", "aa"], &String.length/1)
      false

      iex> has_duplicates_by?(["a", "b"], &String.length/1)
      true
  """
  def has_duplicates_by?(list, fun, acc \\ MapSet.new())
  def has_duplicates_by?([], _, _), do: false

  def has_duplicates_by?([head | tail], fun, acc) do
    head = fun.(head)

    MapSet.member?(acc, head) || has_duplicates_by?(tail, fun, MapSet.put(acc, head))
  end

  @doc """
  Flatten a deeply nested list applying a given function to each element in the same pass.

  Implementation is slightly different from `:lists.flatten/1`, in that this implementation
  uses tail-call recursion at the cost of an extra pass to reverse the array at the end

  ## Examples

      iex> flatten_map([:a, [:b, [:c], [:d]], :e], & &1)
      [:a, :b, :c, :d, :e]

      iex> flatten_map([1, [2, [3], [4]], 5], & &1 * 2)
      [2, 4, 6, 8, 10]
  """

  def flatten_map(list, fun), do: flatten_map(list, fun, []) |> Enum.reverse()
  defp flatten_map([], _, acc), do: acc

  defp flatten_map([head | tail], fun, acc) when is_list(head),
    do: flatten_map(tail, fun, flatten_map(head, fun, acc))

  defp flatten_map([head | tail], fun, acc), do: flatten_map(tail, fun, [fun.(head) | acc])

  @doc """
  Generate a random UUID v4.

  Code taken from Ecto: https://github.com/elixir-ecto/ecto/blob/v3.10.2/lib/ecto/uuid.ex#L174
  """
  def uuid4() do
    <<u0::48, _::4, u1::12, _::2, u2::62>> = :crypto.strong_rand_bytes(16)
    encode_uuid(<<u0::48, 4::4, u1::12, 2::2, u2::62>>)
  end

  defp encode_uuid(
         <<a1::4, a2::4, a3::4, a4::4, a5::4, a6::4, a7::4, a8::4, b1::4, b2::4, b3::4, b4::4,
           c1::4, c2::4, c3::4, c4::4, d1::4, d2::4, d3::4, d4::4, e1::4, e2::4, e3::4, e4::4,
           e5::4, e6::4, e7::4, e8::4, e9::4, e10::4, e11::4, e12::4>>
       ) do
    <<e(a1), e(a2), e(a3), e(a4), e(a5), e(a6), e(a7), e(a8), ?-, e(b1), e(b2), e(b3), e(b4), ?-,
      e(c1), e(c2), e(c3), e(c4), ?-, e(d1), e(d2), e(d3), e(d4), ?-, e(e1), e(e2), e(e3), e(e4),
      e(e5), e(e6), e(e7), e(e8), e(e9), e(e10), e(e11), e(e12)>>
  end

  @compile {:inline, e: 1}

  defp e(0), do: ?0
  defp e(1), do: ?1
  defp e(2), do: ?2
  defp e(3), do: ?3
  defp e(4), do: ?4
  defp e(5), do: ?5
  defp e(6), do: ?6
  defp e(7), do: ?7
  defp e(8), do: ?8
  defp e(9), do: ?9
  defp e(10), do: ?a
  defp e(11), do: ?b
  defp e(12), do: ?c
  defp e(13), do: ?d
  defp e(14), do: ?e
  defp e(15), do: ?f

  @doc """
  Validate a UUID

  Code taken from Ecto: https://github.com/elixir-ecto/ecto/blob/v3.10.2/lib/ecto/uuid.ex#L25
  """
  @spec validate_uuid(binary()) :: {:ok, String.t()} | :error
  def validate_uuid(
        <<a1, a2, a3, a4, a5, a6, a7, a8, ?-, b1, b2, b3, b4, ?-, c1, c2, c3, c4, ?-, d1, d2, d3,
          d4, ?-, e1, e2, e3, e4, e5, e6, e7, e8, e9, e10, e11, e12>>
      ) do
    <<c(a1), c(a2), c(a3), c(a4), c(a5), c(a6), c(a7), c(a8), ?-, c(b1), c(b2), c(b3), c(b4), ?-,
      c(c1), c(c2), c(c3), c(c4), ?-, c(d1), c(d2), c(d3), c(d4), ?-, c(e1), c(e2), c(e3), c(e4),
      c(e5), c(e6), c(e7), c(e8), c(e9), c(e10), c(e11), c(e12)>>
  catch
    :error -> :error
  else
    hex_uuid -> {:ok, hex_uuid}
  end

  def validate_uuid(_), do: :error

  @compile {:inline, c: 1}

  defp c(?0), do: ?0
  defp c(?1), do: ?1
  defp c(?2), do: ?2
  defp c(?3), do: ?3
  defp c(?4), do: ?4
  defp c(?5), do: ?5
  defp c(?6), do: ?6
  defp c(?7), do: ?7
  defp c(?8), do: ?8
  defp c(?9), do: ?9
  defp c(?A), do: ?a
  defp c(?B), do: ?b
  defp c(?C), do: ?c
  defp c(?D), do: ?d
  defp c(?E), do: ?e
  defp c(?F), do: ?f
  defp c(?a), do: ?a
  defp c(?b), do: ?b
  defp c(?c), do: ?c
  defp c(?d), do: ?d
  defp c(?e), do: ?e
  defp c(?f), do: ?f
  defp c(_), do: throw(:error)
end
