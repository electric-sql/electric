defmodule Electric.Postgres.Proxy.Injector.Capture.Version do
  @moduledoc """
  In extended query mode, is used to capture the version set by a `Bind`
  message in order to inject the right version assignment query into the
  transaction.

  For the simple query flow, this capture mode is not needed since the
  migration version can be parsed straight out of the query and we can just
  straight to an Inject capture mode.
  """

  defstruct [:version, :framework, :table, :columns]

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector
  alias Electric.Postgres.Proxy.Injector.{Capture, Send, State}

  @type t() :: %__MODULE__{
          version: nil | String.t(),
          framework: :ecto | :generic,
          table: {String.t(), String.t()},
          columns: %{String.t() => integer()}
        }

  defimpl Capture do
    def recv_frontend(%{framework: :ecto} = v, %M.Bind{} = msg, state, send) do
      <<version::integer-big-signed-64>> =
        Enum.at(msg.parameters, Map.fetch!(v.columns, "version"))

      {%{v | version: version}, State.tx_version(state, version), Send.back(send, msg)}
    end

    def recv_frontend(
          %{framework: :generic, table: {"public", "schema_migrations"}} = v,
          %M.Bind{} = msg,
          state,
          send
        ) do
      <<version::integer-big-signed-64>> =
        Enum.at(msg.parameters, Map.fetch!(v.columns, "version"))

      {%{v | version: version}, State.tx_version(state, version), Send.back(send, msg)}
    end

    def recv_frontend(v, %M.Sync{} = msg, state, send) do
      if !State.tx_version?(state), do: raise("Version has not been set")

      inject = Injector.inject_version_query(v.version, state)

      {inject, state, Send.back(send, msg)}
    end

    def recv_frontend(v, msg, state, send) do
      {v, state, Send.back(send, msg)}
    end

    def recv_backend(v, msg, state, send) do
      {v, state, Send.front(send, msg)}
    end
  end
end
