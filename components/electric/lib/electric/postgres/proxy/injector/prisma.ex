defmodule Electric.Postgres.Proxy.Injector.Prisma do
  defstruct config: nil, prepared_statements: %{}, active_statement: nil, portals: %{}

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Prisma
  alias Electric.Postgres.Proxy.Injector.{Operation, Send}

  @type t() :: %__MODULE__{}

  def new(opts) do
    struct(__MODULE__, opts) |> ensure_config()
  end

  defp ensure_config(%{config: %Prisma{}} = capture) do
    capture
  end

  defp ensure_config(capture) do
    %{capture | config: %Prisma{}}
  end

  defimpl Operation do
    alias Electric.Postgres.Extension.SchemaLoader

    def activate(prisma, state, send) do
      {prisma, state, send}
    end

    def recv_client(prisma, msgs, state) do
      {msgs, {prisma, state}} =
        Enum.map_reduce(msgs, {prisma, state}, &recv_client_msg/2)

      {msgs ++ [prisma], state}
    end

    def recv_server(prisma, msg, state, send) do
      {prisma, state, Send.client(send, msg)}
    end

    def send_client(electric, state, send) do
      {electric, state, send}
    end

    def recv_error(electric, _msgs, state, send) do
      {electric, state, send}
    end

    def send_error(electric, state, send) do
      {electric, state, send}
    end

    def recv_client_msg(%M.Parse{name: name, query: query}, {prisma, state}) do
      case Prisma.parse_query(query) do
        {:ok, query} ->
          {
            Operation.Pass.client([%M.ParseComplete{}]),
            {%{
               prisma
               | prepared_statements: Map.put(prisma.prepared_statements, name, query),
                 active_statement: name
             }, state}
          }

        :error ->
          msgs = [
            %M.ErrorResponse{
              message:
                "Unrecognised introspection query. Please raise a bug on https://github.com/electric-sql/electric",
              query: query
            },
            %M.ReadyForQuery{status: :failed}
          ]

          {
            Operation.Pass.client(msgs),
            {prisma, state}
          }
      end
    end

    def recv_client_msg(%M.Describe{name: name}, {prisma, state}) do
      with {:ok, query} <- Map.fetch(prisma.prepared_statements, name) do
        msgs = [
          %M.ParameterDescription{
            params: query.parameter_description(prisma.config)
          },
          %M.RowDescription{
            fields: query.row_description(prisma.config)
          }
        ]

        {
          Operation.Pass.client(msgs),
          {prisma, state}
        }
      end
    end

    def recv_client_msg(%M.Bind{} = msg, {prisma, state}) do
      %M.Bind{portal: portal, source: name, parameters: params} = msg

      {
        Operation.Pass.client([%M.BindComplete{}]),
        {%{prisma | portals: Map.put(prisma.portals, portal, {name, params})}, state}
      }
    end

    def recv_client_msg(%M.Execute{portal: portal}, {prisma, state}) do
      case Map.fetch(prisma.portals, portal) do
        {:ok, {ps, binds}} ->
          {:ok, query_module} = Map.fetch(prisma.prepared_statements, ps)
          # TODO: allow for introspecing a specific version of the schema
          {:ok, _version, schema} = schema(state)

          data_rows =
            query_module.data_rows(binds, schema, prisma.config)
            |> Enum.map(&%M.DataRow{fields: &1})

          {
            Operation.Pass.client(
              data_rows ++
                [
                  %M.CommandComplete{tag: "SELECT #{length(data_rows)}"}
                ]
            ),
            {%{prisma | portals: Map.delete(prisma.portals, portal)}, state}
          }
      end
    end

    def recv_client_msg(%M.Sync{}, {prisma, state}) do
      {
        Operation.Pass.client([%M.ReadyForQuery{status: :idle}]),
        {prisma, state}
      }
    end

    def recv_client_msg(%M.Close{} = msg, {prisma, state}) do
      prisma =
        case msg.type do
          "S" ->
            Map.update!(prisma, :prepared_statements, &Map.delete(&1, msg.name))

          "P" ->
            Map.update!(prisma, :portals, &Map.delete(&1, msg.name))
        end

      {
        Operation.Pass.client([%M.CloseComplete{}]),
        {prisma, state}
      }
    end

    defp schema(state) do
      SchemaLoader.load(state.loader)
    end
  end
end
