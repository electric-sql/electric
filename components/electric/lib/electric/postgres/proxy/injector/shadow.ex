defmodule Electric.Postgres.Proxy.Injector.Shadow do
  defstruct [:database]

  alias Electric.Postgres.Proxy.{
    Injector,
    Injector.Operation,
    Injector.Send,
    Injector.State,
    Parser
  }

  alias PgProtocol.Message, as: M

  @type t() :: %__MODULE__{}

  def injector do
    Injector.new(
      [loader: nil, capture_mode: [default: {__MODULE__, []}]],
      username: "shadow"
    )
  end

  defmodule Simple do
    alias Electric.DDLX.Command

    defstruct [:msgs, :resp]

    defimpl Operation do
      use Operation.Impl
      # activating when the only query was an electric ddlx command so we need to fake the
      # complete interaction, including the ReadyForQuery, as nothing will be sent to the server
      # at all
      def activate(%{msgs: []} = op, state, send) do
        {op, send} = send_electric_resps(op, send)
        {op, send} = send_ready(op, send, state)
        {op, state, send}
      end

      def activate(%{msgs: msgs} = op, state, send) do
        {%{op | msgs: []}, state, Send.server(send, msgs)}
      end

      def recv_server(%{resp: [{:sql, _} | resp]} = op, %M.CommandComplete{} = msg, state, send) do
        {op, send} = send_electric_resps(%{op | resp: resp}, Send.client(send, msg))
        {op, state, send}
      end

      def recv_server(%{resp: []}, %M.ReadyForQuery{} = msg, state, send) do
        {nil, state, Send.client(send, msg)}
      end

      def recv_server(op, msg, state, send) do
        {op, state, Send.client(send, msg)}
      end

      defp send_electric_resps(%{resp: resp} = op, send) do
        {cmds, resps} = Enum.split_while(resp, &(elem(&1, 0) == :electric))

        msgs =
          Enum.map(cmds, fn {:electric, cmd} -> %M.CommandComplete{tag: Command.tag(cmd)} end)

        {%{op | resp: resps}, Send.client(send, msgs)}
      end

      defp send_ready(%{resp: []}, send, state) do
        msg =
          if State.tx?(state) do
            %M.ReadyForQuery{status: :tx}
          else
            %M.ReadyForQuery{status: :idle}
          end

        {nil, Send.client(send, msg)}
      end

      defp send_ready(%{resp: [_ | _]} = op, send, _state) do
        {op, send}
      end
    end
  end

  defmodule Extended do
    # user has done a parse-describe for a ddlx statement
    # this waits for the corresponding bind-execute and fakes
    # execution
    alias Electric.DDLX.Command

    defstruct [:cmd, :msgs]

    defimpl Operation do
      use Operation.Impl

      def activate(op, state, send) do
        {op, state, Send.client(send, Enum.map(op.msgs, &response(&1, state)))}
      end

      def recv_client(op, msgs, state) do
        if Enum.any?(msgs, &is_struct(&1, M.Execute)) do
          tag = Command.tag(op.cmd)
          pass = Operation.Pass.client(Enum.map(msgs, &response(&1, tag, state)))
          {pass, state}
        else
          {[Operation.Pass.server(msgs), op], state}
        end
      end
    end
  end

  # provide a loader impl that just ignores electrification
  defmodule NullLoader do
    @moduledoc false
    def table_electrified?(_, _), do: {:ok, false}
  end

  defimpl Operation do
    use Operation.Impl

    # For shadow connections, we want to honour the database from the connection params.
    #
    # Normally we ignore the db param in the startup message and always connect to the
    # configured upstream database.
    def upstream_connection(shadow, conn_config) do
      put_in(conn_config, [:connection, :database], shadow.database)
    end

    def recv_client(shadow, msgs, state) do
      chunks = Injector.Electric.group_messages(msgs)

      {commands, {shadow, state}} =
        Enum.flat_map_reduce(chunks, {shadow, state}, &command_for_msgs/2)

      {Enum.concat(commands, [shadow]), state}
    end

    def recv_server(shadow, msg, state, send) do
      {shadow, state, Send.client(send, msg)}
    end

    def recv_error(shadow, _msgs, state, send) do
      {shadow, state, send}
    end

    def send_error(shadow, state, send) do
      {shadow, state, send}
    end

    defp null_loader(state) do
      %{state | loader: {NullLoader, []}}
    end

    defp monitor_tx(%{action: {:tx, :begin}}, state) do
      State.begin(state)
    end

    defp monitor_tx(%{action: {:tx, :commit}}, state) do
      State.commit(state)
    end

    defp monitor_tx(%{action: {:tx, :rollback}}, state) do
      State.rollback(state)
    end

    defp monitor_tx(_analysis, state) do
      state
    end

    defp command_for_msgs({:simple, [%M.Query{} = msg]}, {shadow, state}) do
      case Parser.parse(msg) do
        {:ok, stmts} ->
          analysis = Parser.analyse(stmts, null_loader(state))
          state = Enum.reduce(analysis, state, &monitor_tx/2)
          types = analysis |> filter_ddlx()

          msgs =
            Enum.flat_map(types, fn
              {:electric, _} -> []
              {:sql, msg} -> [msg]
            end)

          {[%Simple{msgs: msgs, resp: types}], {shadow, state}}

        {:error, error} ->
          {[%Operation.SyntaxError{error: error, msg: msg}], {shadow, state}}
      end
    end

    defp command_for_msgs({:extended, msgs}, {shadow, state}) do
      case Enum.find(msgs, &is_struct(&1, M.Parse)) do
        %M.Parse{} = msg ->
          handle_parse(msg, msgs, shadow, state)

        nil ->
          {[Operation.Pass.server(msgs)], {shadow, state}}
      end
    end

    defp handle_parse(msg, msgs, shadow, state) do
      case Parser.parse(msg) do
        {:ok, [stmt]} ->
          analysis = Parser.analyse(stmt, null_loader(state))
          state = Enum.reduce([analysis], state, &monitor_tx/2)
          [type] = [analysis] |> filter_ddlx()

          case type do
            {:electric, cmd} ->
              {[%Extended{cmd: cmd, msgs: msgs}], {shadow, state}}

            {:sql, _msg} ->
              {[Operation.Pass.server(msgs)], {shadow, state}}
          end
      end
    end

    defp filter_ddlx(analysis) do
      Enum.map(analysis, fn
        %{action: {:electric, command}} -> {:electric, command}
        %{source: msg} -> {:sql, msg}
      end)
    end
  end
end
