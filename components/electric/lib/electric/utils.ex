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
  Translator to ignore progress reports from supervisors on any log level
  """
  def translate(_min_level, :info, :report, {{:supervisor, :progress}, _}) do
    :skip
  end

  def translate(min_level, level, :report = kind, {{:supervisor, _}, message}) do
    case Keyword.get(message, :reason) do
      :normal ->
        :skip

      _ ->
        Logger.Translator.translate(min_level, level, kind, message)
    end
  end

  def translate(min_level, level, kind, message) do
    Logger.Translator.translate(min_level, level, kind, message)
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
end
