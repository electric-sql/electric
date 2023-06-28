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
end
