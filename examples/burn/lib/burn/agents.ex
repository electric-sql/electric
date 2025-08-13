defmodule Burn.Agents do
  @moduledoc """
  Core agent logic to instruct and perform tool calls.
  """

  alias Burn.{
    Accounts,
    Context,
    Repo,
    Threads,
    ToolCall
  }

  alias Ecto.{
    Changeset,
    Multi
  }

  alias InstructorLite.ErrorFormatter

  @default_adapter Burn.Adapters.Anthropic
  @max_retries 3

  def shared_system_rules,
    do: """
    IDs are always expressed as binary ids in UUID v4 format.

    If you're writing the ID of a resource like a user or an event, that user or
    event MUST be in the current thread. Never invent or generate an ID that is
    not in the context data.
    """

  @doc """
  Prompt the agent to determine the next tool use.
  """
  @spec instruct(Threads.Thread.t(), [Context.message()], binary(), [atom()], atom(), keyword()) ::
          {:ok, ToolCall.t()}
          | {:error, Changeset.t()}
          | {:error, any()}
          | {:error, atom(), any()}
  def instruct(thread, messages, model, prompt, tools, opts \\ [])
  def instruct(_thread, [], _model, _prompt, _tools, _opts), do: {:ok, nil}

  def instruct(thread, messages, model, prompt, tools, opts) do
    adapter = Keyword.get(opts, :adapter, @default_adapter)
    max_retries = Keyword.get(opts, :max_retries, @max_retries)

    params = adapter.initial_prompt(messages, prompt, tools, model)
    do_instruct(thread, params, adapter, tools, max_retries)
  end

  defp do_instruct(thread, params, adapter, tools, retries) do
    {:ok, payload} = adapter.send_request(params)
    {:ok, response} = adapter.parse_response(payload)

    case ToolCall.validate(thread, response, tools) do
      %Changeset{valid?: true} = changeset ->
        {:ok, Changeset.apply_changes(changeset)}

      {:error, %Changeset{} = changeset} ->
        if retries > 0 do
          errors = ErrorFormatter.format_errors(changeset)
          new_params = adapter.retry_prompt(params, errors, response)

          do_instruct(thread, new_params, adapter, tools, retries - 1)
        else
          {:error, changeset}
        end

      error ->
        error
    end
  end

  @doc """
  Perform the agent's chosen tool use.
  """
  @spec perform(Threads.Thread.t(), Accounts.User.t(), ToolCall.t() | nil) ::
          {:ok, map()} | Multi.failure()
  def perform(_thread, _agent, nil), do: {:ok, %{}}

  def perform(
        %Threads.Thread{} = thread,
        %Accounts.User{type: :agent} = agent,
        %{tool_module: tool_module} = tool_call
      ) do
    attrs = %{
      type: :tool_use,
      data: ToolCall.to_event_data(tool_call)
    }

    Multi.new()
    |> Multi.insert(:event, Threads.init_event(thread, agent, attrs))
    |> tool_module.perform(tool_call)
    |> Repo.transaction()
  end
end
