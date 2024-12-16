defmodule Electric.Client.Mock do
  @moduledoc """
  Allows for mocking stream messages.

  ## Usage

  ``` elixir
  {:ok, client} = Electric.Client.Mock.new()

  users = [
    %{id: 1, name: "User 1"},
    %{id: 2, name: "User 2"},
    %{id: 3, name: "User 3"}
  ]

  ref = Electric.Client.Mock.async_response(client,
    status: 200,
    schema: %{id: %{type: "int8"}, name: %{type: "text"}},
    last_offset: Client.Offset.first(),
    shape_handle: "users-1",
    body: Electric.Client.Mock.transaction(users, operation: :insert)
  )

  messages = Electric.Client.stream(client, "users", live: false) |> Enum.into([])

  request = Electric.Client.Mock.async_await(ref, timeout = 5_000)
  ```
  """

  alias Electric.Client
  alias Electric.Client.Fetch
  alias Electric.Client.Offset

  @behaviour Electric.Client.Fetch

  defmodule Endpoint do
    @moduledoc false

    use GenServer

    def start_link(parent) do
      GenServer.start_link(__MODULE__, parent)
    end

    def init(parent) do
      {:ok, %{parent: parent, requests: [], responses: []}}
    end

    def request(pid, request) do
      try do
        GenServer.call(pid, {:request, request}, :infinity)
      catch
        :exit, _reason -> {:error, :exit}
      end
    end

    def response(pid, response) do
      GenServer.call(pid, {:response, response})
    end

    def handle_call({:request, request}, from, %{responses: []} = state) do
      {:noreply, %{state | requests: state.requests ++ [{from, request}]}}
    end

    def handle_call({:request, request}, _from, %{responses: [{from, response} | rest]} = state) do
      GenServer.reply(from, {:ok, request})

      {:reply, {:ok, response}, %{state | responses: rest}}
    end

    def handle_call({:response, response}, from, %{requests: []} = state) do
      {:noreply, %{state | responses: state.responses ++ [{from, response}]}}
    end

    def handle_call({:response, response}, _from, %{requests: [{from, request} | rest]} = state) do
      GenServer.reply(from, {:ok, response})

      {:reply, {:ok, request}, %{state | requests: rest}}
    end
  end

  @type response_opt ::
          {:status, pos_integer()}
          | {:headers, %{String.t() => String.t() | [String.t(), ...]}}
          | {:body, [map()]}
          | {:schema, Client.schema()}
          | {:shape_handle, Client.shape_handle()}
          | {:last_offset, Client.Offset.t()}
  @type response_opts :: [response_opt()]

  @type change_opt ::
          {:value, map()}
          | {:operation, :insert | :update | :delete}
          | {:offset, Client.Offset.t()}
  @type change_opts :: [change_opt()]

  @type transaction_opt :: {:lsn, non_neg_integer()} | {:up_to_date, boolean()}
  @type transaction_opts :: [transaction_opt() | change_opt()]

  @impl Electric.Client.Fetch
  def fetch(%Fetch.Request{} = request, opts) do
    {:ok, endpoint} = Keyword.fetch(opts, :endpoint)

    Endpoint.request(endpoint, request)
  end

  @doc """
  Create a new mock client, linked to the `parent` process, `self()` by default.
  """
  @spec new(pid()) :: {:ok, Client.t()}
  def new(parent \\ self()) do
    {:ok, endpoint} = Endpoint.start_link(parent)

    Client.new(
      base_url: "http://mock.electric",
      fetch: {Electric.Client.Mock, endpoint: endpoint}
    )
  end

  @spec response(Client.t(), response_opts()) :: {:ok, Fetch.Request.t()}
  def response(%Client{fetch: {__MODULE__, opts}}, response) when is_list(response) do
    {:ok, endpoint} = Keyword.fetch(opts, :endpoint)
    Endpoint.response(endpoint, build_response(response))
  end

  @spec response(Client.t(), response_opts()) :: reference()
  def async_response(client, response) do
    parent = self()
    ref = make_ref()

    Task.start_link(fn ->
      {:ok, request} = response(client, response)
      send(parent, {__MODULE__, ref, request})
    end)

    ref
  end

  @spec async_await(reference(), pos_integer() | :infinity) :: Fetch.Request.t()
  def async_await(ref, timeout \\ 5000) do
    receive do
      {__MODULE__, ^ref, request} -> request
    after
      timeout ->
        raise "No request received"
    end
  end

  @spec up_to_date() :: map()
  def up_to_date(_opts \\ []) do
    %{"headers" => %{"control" => "up-to-date"}}
  end

  @doc """
  Wrap the given `values` in `Client.Messages.ChangeMessage` structs at the
  given `:lsn`.

  By default this will append an `up-to-date` control message to the end of the
  liist of changes. Pass `up_to_date: false` to disable this.
  """
  @spec transaction(values :: [map()], transaction_opts()) :: [map()]
  def transaction(values, opts \\ []) do
    tx_offset = Keyword.get(opts, :lsn, 0)

    up_to_date =
      if Keyword.get(opts, :up_to_date, true) do
        [up_to_date()]
      else
        []
      end

    values
    |> Enum.with_index()
    |> Enum.map(fn {value, op_offset} ->
      opts
      |> Keyword.merge(value: value, offset: Offset.new(tx_offset, op_offset))
      |> change()
    end)
    |> Enum.concat(up_to_date)
  end

  @spec change(change_opts()) :: map()
  def change(opts) do
    %{
      value: opts[:value] || %{},
      headers: change_headers(opts[:operation] || :insert),
      offset: Offset.to_string(opts[:offset] || Offset.first())
    }
    |> jsonify()
  end

  defp change_headers(operation) do
    jsonify(%{operation: to_string(operation)})
  end

  defp build_response(opts) do
    %Fetch.Response{
      status: Keyword.get(opts, :status, 200),
      headers: headers(opts[:headers] || []),
      body: jsonify(opts[:body] || []),
      schema: Keyword.get(opts, :schema, nil),
      shape_handle: Keyword.get(opts, :shape_handle, nil),
      last_offset: Keyword.get(opts, :last_offset, nil)
    }
  end

  @spec headers([
          {:shape_handle, Client.shape_handle()}
          | {:last_offset, Client.Offset.t()}
          | {:schema, Client.schema()}
        ]) :: %{String.t() => [String.t()]}
  def headers(args) do
    %{}
    |> put_optional_header("electric-handle", args[:shape_handle])
    |> put_optional_header(
      "electric-offset",
      args[:last_offset],
      &Client.Offset.to_string/1
    )
    |> put_optional_header("electric-schema", args[:schema], &Jason.encode!/1)
  end

  defp put_optional_header(headers, header, value, encoder \\ & &1)

  defp put_optional_header(headers, _header, nil, _encoder) do
    headers
  end

  defp put_optional_header(headers, header, value, encoder) do
    Map.put(headers, header, [encoder.(value)])
  end

  defp jsonify(value) do
    value |> Jason.encode!() |> Jason.decode!()
  end
end
