defmodule Electric.DurableStreams.WriterPool do
  @moduledoc """
  Supervisor for the pool of HTTP writer processes.

  Starts a fixed number of Writer GenServers, each with its own
  HTTP/2 connection to the durable streams server.
  """

  use Supervisor

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    Supervisor.start_link(__MODULE__, opts, name: name(stack_id))
  end

  @impl Supervisor
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    num_writers = Keyword.get(opts, :num_writers, 4)
    url = Keyword.fetch!(opts, :durable_streams_url)
    token = Keyword.fetch!(opts, :durable_streams_token)
    http_client_opts = Keyword.get(opts, :durable_streams_http_client_opts, [])

    children =
      for i <- 0..(num_writers - 1) do
        Supervisor.child_spec(
          {Electric.DurableStreams.Writer,
           stack_id: stack_id,
           index: i,
           durable_streams_url: url,
           durable_streams_token: token,
           durable_streams_http_client_opts: http_client_opts},
          id: {Electric.DurableStreams.Writer, i}
        )
      end

    Supervisor.init(children, strategy: :one_for_one)
  end
end
