defmodule Electric.Postgres.Proxy.Injector.Capture.Prisma do
  defstruct config: nil, prepared_statements: %{}, active_statement: nil, binds: %{}

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Prisma
  alias Electric.Postgres.Proxy.Injector.{Capture, Send}

  @type t() :: %__MODULE__{}

  defimpl Capture do
    alias Electric.Postgres.Extension.SchemaLoader

    def recv_frontend(p, %M.Parse{name: name, query: query}, state, send) do
      case Prisma.parse_query(query) do
        {:ok, query} ->
          {%{
             p
             | prepared_statements: Map.put(p.prepared_statements, name, query),
               active_statement: name
           }, state, Send.front(send, [%M.ParseComplete{}])}

        :error ->
          msgs = [
            %M.ErrorResponse{
              message:
                "Unrecognised introspection query. Please raise a bug on https://github.com/electric-sql/electric",
              query: query
            },
            %M.ReadyForQuery{status: :failed}
          ]

          {p, state, Send.front(send, msgs)}
      end
    end

    def recv_frontend(p, %M.Describe{name: name}, state, send) do
      with {:ok, query} <- Map.fetch(p.prepared_statements, name) do
        msgs = [
          %M.ParameterDescription{
            params: query.parameter_description(p.config)
          },
          %M.RowDescription{
            fields: query.row_description(p.config)
          }
        ]

        {p, state, Send.front(send, msgs)}
      end
    end

    def recv_frontend(p, %M.Bind{portal: portal, source: name, parameters: params}, state, send) do
      {%{p | binds: Map.put(p.binds, portal, {name, params}) |> dbg}, state,
       Send.front(send, %M.BindComplete{})}
    end

    def recv_frontend(p, %M.Execute{portal: portal}, state, send) do
      case Map.fetch(p.binds, portal) |> dbg do
        {:ok, {ps, binds}} ->
          {:ok, query} = Map.fetch(p.prepared_statements, ps)
          # TODO: allow for introspecing a specific version of the schema
          {:ok, _version, schema} = schema(state)

          data_rows =
            query.data_rows(binds, schema, p.config) |> Enum.map(&%M.DataRow{fields: &1})

          {%{p | binds: Map.delete(p.binds, portal) |> dbg}, state,
           send
           |> Send.front(data_rows)
           |> Send.front([
             %M.CommandComplete{tag: "SELECT #{length(data_rows)}"}
           ])}
      end
    end

    def recv_frontend(p, %M.Sync{}, state, send) do
      msg = %M.ReadyForQuery{status: :idle}
      {p, state, Send.front(send, msg)}
    end

    def recv_frontend(p, %M.Close{}, state, send) do
      {p, state, Send.front(send, %M.CloseComplete{})}
    end

    def recv_backend(m, msg, state, send) do
      {m, state, Send.front(send, msg)}
    end

    defp schema(state) do
      SchemaLoader.load(state.loader)
    end
  end
end
