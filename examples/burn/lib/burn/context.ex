defmodule Burn.Context do
  @moduledoc """
  Optimise what goes in the LLM context window.
  """
  require Logger

  alias Burn.{
    Repo,
    Threads
  }

  @type message :: %{name: String.t(), data: map()}

  @spec to_messages([Threads.Event.t()]) :: [Burn.Message.t()]
  def to_messages([]), do: []

  def to_messages([%Threads.Event{} | _] = events) do
    summary = """
    Here's everything that happened so far:

    #{summarize(events)}

    What's the next step?
    """

    Logger.info("\n\n#{summary}\n")

    [%{role: :user, content: summary}]
  end

  @spec summarize([Threads.Event.t()]) :: binary()
  def summarize(events) when is_list(events) do
    events
    |> Enum.map(&format_event/1)
    |> Enum.join("\n")
    |> String.trim_trailing()
  end

  @spec format_event(Threads.Event.t()) :: binary()
  def format_event(%Threads.Event{type: :system, data: data} = event) do
    %{user: %{id: user_id, name: user_name, type: user_type}} = Repo.preload(event, :user)

    user_type_label =
      case user_type do
        :human -> "user"
        :agent -> "agent"
      end

    content =
      data
      |> Map.put(user_type_label, %{"id" => user_id, "name" => user_name})

    """
    <system_message>
    #{to_yaml(content)}
    </system_message>
    """
  end

  @spec format_event(Threads.Event.t()) :: binary()
  def format_event(%Threads.Event{type: :text, data: data, id: id} = event) do
    content =
      data
      |> Map.put("id", id)
      |> Map.put("from", author(event))

    """
    <user_message>
    #{to_yaml(content)}
    </user_message>
    """
  end

  def format_event(%Threads.Event{type: :tool_use, data: %{"name" => name} = data} = event) do
    content = Map.put(data, "from", author(event))

    """
    <#{name}>
    #{to_yaml(content)}
    </#{name}>
    """
  end

  def format_event(%Threads.Event{type: :tool_result, data: data}) do
    {tool_name, content} = Map.pop(data, "tool_name")

    """
    <#{tool_name}_result>
    #{to_yaml(content)}
    </#{tool_name}_result>
    """
  end

  defp author(%Threads.Event{user_id: user_id}), do: user_id

  defp to_yaml(data) when is_map(data) do
    data
    |> Yamel.encode!(empty_value: :blank, node_level: 1)
    |> String.trim_trailing()
  end
end
