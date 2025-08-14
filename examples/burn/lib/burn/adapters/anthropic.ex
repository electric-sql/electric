defmodule Burn.Adapters.Anthropic do
  @moduledoc """
  Customised [Anthropic](https://docs.anthropic.com/en/home) adapter.

  Cribbed from `InstructorLite.Adapters.Anthropic`, revised to
  support multiple `tools`.
  """

  @default_model :sonnet

  @doc """
  Builds the `params` for the initial prompt.

  Requires an array of `tools` in the params. The model is told to respond
  with a tool call using one of these tools.
  """
  def initial_prompt(messages, prompt, tools, model \\ @default_model, max_tokens \\ 512) do
    %{
      max_tokens: max_tokens,
      messages: messages,
      model: full_model_name(model),
      system: prompt,
      tool_choice: %{
        type: "any",
        disable_parallel_tool_use: true
      },
      tools: Enum.map(tools, fn tool -> tool.param() end)
    }
  end

  @doc """
  Updates `params` with prompt for retrying a request.

  The error is represented as an erroneous `tool_result`.
  """
  def retry_prompt(params, errors, response) do
    %{"content" => [%{"id" => tool_use_id}]} =
      assistant_reply = Map.take(response, ["content", "role"])

    do_better = [
      assistant_reply,
      %{
        role: "user",
        content: [
          %{
            type: "tool_result",
            tool_use_id: tool_use_id,
            is_error: true,
            content: """
            Validation failed. Please try again and fix following validation errors

            #{errors}
            """
          }
        ]
      }
    ]

    Map.update(params, :messages, do_better, fn msgs -> msgs ++ do_better end)
  end

  @doc """
  Make request to Anthropic API
  """
  def send_request(params) do
    env = config()
    {:ok, api_key} = Keyword.fetch(env, :api_key)
    {:ok, api_url} = Keyword.fetch(env, :api_url)
    {:ok, api_version} = Keyword.fetch(env, :api_version)

    headers = [
      {"x-api-key", api_key},
      {"anthropic-version", api_version}
    ]

    case Req.post(api_url, json: params, headers: headers, receive_timeout: 30_000) do
      {:ok, %{status: 200, body: body}} ->
        {:ok, body}

      {:ok, response} ->
        {:error, response}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @doc """
  Parse API response.

  Can return:
    * `{:ok, response}` on success.
    * `{:error, :unexpected_response, payload}` if payload is of unexpected shape.
  """
  def parse_response(payload) do
    case payload do
      %{"stop_reason" => "tool_use", "content" => [response]} ->
        {:ok, response}

      other ->
        {:error, :unexpected_response, other}
    end
  end

  defp config do
    Application.fetch_env!(:burn, __MODULE__)
  end

  defp full_model_name(key) when is_atom(key) do
    config()
    |> Keyword.fetch!(:models)
    |> Keyword.fetch!(key)
  end
end
