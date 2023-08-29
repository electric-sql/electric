defmodule Electric.Postgres.Proxy.InjectorTest do
  use ExUnit.Case, async: true

  alias PgProtocol.Message
  alias Electric.Postgres.Proxy.Injector
  alias Electric.DDLX
  alias Electric.DDLX.Command
  alias Electric.Postgres.MockSchemaLoader

  @moduletag capture_log: true

  # defmodule MockLoader do
  #   @behaviour Electric.Postgres.SchemaLoader
  #
  #   defstruct parent: nil, electrified_tables: nil, electrified_indexes: nil
  #
  #   def connect(_config, opts) do
  #     {:ok, parent} = Keyword.fetch(opts, :parent)
  #     tables = Keyword.get(opts, :electrified_tables, []) |> MapSet.new()
  #     indexes = Keyword.get(opts, :electrified_indexes, []) |> MapSet.new()
  #     {:ok, %{parent: parent, electrified_tables: tables, electrified_indexes: indexes}}
  #   end
  #
  #   def table_electrified?(%{electrified_tables: electrified}, table_name) do
  #     MapSet.member?(electrified, table_name)
  #   end
  #
  #   def index_electrified?(%{electrified_indexes: electrified}, index_name) do
  #     MapSet.member?(electrified, index_name)
  #   end
  # end

  defmodule MockInjector do
    @behaviour Injector

    def capture_ddl_query(query) do
      ~s|PERFORM electric.capture_ddl('#{query}')|
    end

    def capture_version_query(version) do
      ~s|PERFORM electric.migration_version('#{version}')|
    end

    def migration_version do
      "20230801111111_11"
    end
  end

  setup do
    migrations = [
      {"001",
       [
         "CREATE TABLE public.truths (id uuid PRIMARY KEY, content varchar)",
         "CREATE INDEX truths_idx ON public.truths (content)"
       ]}
    ]

    {module, opts} =
      MockSchemaLoader.backend_spec(migrations: migrations)

    {:ok, loader_state} = MockSchemaLoader.connect([], opts)

    {:ok, injector} = Injector.new(loader: {module, loader_state}, injector: MockInjector)

    version = System.system_time(:microsecond)
    timestamp = DateTime.utc_now()

    {:ok, injector: injector, version: version, timestamp: timestamp}
  end

  defp version_query(cxt, protocol, framework) do
    protocol.query(framework.migration_query(cxt.version), [])
  end

  @protocols [
    Electric.Proxy.InjectorTest.ExtendedQueryProtocol,
    Electric.Proxy.InjectorTest.SimpleQueryProtocol
  ]

  @frameworks [Electric.Proxy.InjectorTest.EctoFramework]

  for p <- @protocols do
    for f <- @frameworks do
      describe "#{p.description()} [#{f.description()}]" do
        @tag protocol: p.tag(), framework: f.tag()
        test "create table is not captured", cxt do
          protocol = unquote(p)
          framework = unquote(f)
          query = ~s[CREATE TABLE "truths" ("another" int8)]

          cxt.injector
          |> apply_message_sequence(protocol.begin_tx())
          |> apply_message_sequence(protocol.migration(query, tag: "CREATE TABLE"))
          |> apply_message_sequence(version_query(cxt, protocol, framework))
          |> apply_message_sequence(protocol.commit_tx())
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "alter electrified table", cxt do
          protocol = unquote(p)
          framework = unquote(f)
          query = ~s[ALTER TABLE "truths" ADD COLUMN "another" int8]

          cxt.injector
          |> apply_message_sequence(protocol.begin_tx())
          |> assert_injected(
            protocol.migration(query, tag: "ALTER TABLE"),
            capture_ddl(query)
          )
          |> assert_injected(
            version_query(cxt, protocol, framework),
            assign_version(cxt.version)
          )
          |> apply_message_sequence(protocol.commit_tx())
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "alter non-electrified table does not inject", cxt do
          protocol = unquote(p)
          framework = unquote(f)
          query = ~s[ALTER TABLE "underwear" ADD COLUMN "dirty" bool DEFAULT false]

          cxt.injector
          |> apply_message_sequence(protocol.begin_tx())
          |> apply_message_sequence(protocol.migration(query, tag: "ALTER TABLE"))
          |> apply_message_sequence(version_query(cxt, protocol, framework))
          |> apply_message_sequence(protocol.commit_tx())
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "create index on electrified table is captured", cxt do
          protocol = unquote(p)
          framework = unquote(f)
          query = ~s[CREATE INDEX "truths_idx" ON "truths" (value)]

          cxt.injector
          |> apply_message_sequence(protocol.begin_tx())
          |> assert_injected(
            protocol.migration(query, tag: "CREATE INDEX"),
            capture_ddl(query)
          )
          |> assert_injected(
            version_query(cxt, protocol, framework),
            assign_version(cxt.version)
          )
          |> apply_message_sequence(protocol.commit_tx())
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "create index on non-electrified table is ignored", cxt do
          protocol = unquote(p)
          framework = unquote(f)
          query = ~s[CREATE INDEX "underwear_idx" ON "underwear" (dirty)]

          cxt.injector
          |> apply_message_sequence(protocol.begin_tx())
          |> apply_message_sequence(protocol.migration(query, tag: "CREATE INDEX"))
          |> apply_message_sequence(version_query(cxt, protocol, framework))
          |> apply_message_sequence(protocol.commit_tx())
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "drop electrified table raises error", cxt do
          protocol = unquote(p)
          _framework = unquote(f)
          query = ~s[DROP TABLE "truths"]

          {:ok, error} =
            cxt.injector
            |> apply_message_sequence(protocol.begin_tx())
            |> expect_error_response(protocol.migration(query, tag: "DROP TABLE"))

          assert %Message.ErrorResponse{
                   severity: "ERROR",
                   message: "Cannot DROP Electrified table \"public\".\"truths\"",
                   detail:
                     "Electric currently only supports additive migrations (ADD COLUMN, ADD INDEX)",
                   schema: "public",
                   table: "truths"
                 } = error
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "drop non-electrified table is allowed", cxt do
          protocol = unquote(p)
          framework = unquote(f)
          query = ~s[DROP TABLE "underwear"]

          cxt.injector
          |> apply_message_sequence(protocol.begin_tx())
          |> apply_message_sequence(protocol.migration(query, tag: "DROP TABLE"))
          |> apply_message_sequence(version_query(cxt, protocol, framework))
          |> apply_message_sequence(protocol.commit_tx())
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "drop column on electrified table raises error", cxt do
          protocol = unquote(p)
          _framework = unquote(f)
          query = ~s[ALTER TABLE "truths" DROP "value"]

          {:ok, error} =
            cxt.injector
            |> apply_message_sequence(protocol.begin_tx())
            |> expect_error_response(protocol.migration(query, tag: "ALTER TABLE"))

          assert %Message.ErrorResponse{
                   severity: "ERROR",
                   message:
                     "Invalid destructive migration on Electrified table \"public\".\"truths\": ALTER TABLE \"truths\" DROP \"value\"",
                   detail:
                     "Electric currently only supports additive migrations (ADD COLUMN, ADD INDEX)",
                   schema: "public",
                   table: "truths"
                 } = error
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "drop column on non-electrified table is allowed", cxt do
          protocol = unquote(p)
          framework = unquote(f)
          query = ~s[ALTER TABLE "underwear" DROP COLUMN "dirty"]

          cxt.injector
          |> apply_message_sequence(protocol.begin_tx())
          |> apply_message_sequence(protocol.migration(query, tag: "ALTER TABLE"))
          |> apply_message_sequence(version_query(cxt, protocol, framework))
          |> apply_message_sequence(protocol.commit_tx())
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "rename column on electrified table raises error", cxt do
          protocol = unquote(p)
          _framework = unquote(f)
          query = ~s[ALTER TABLE "truths" RENAME "value" TO "worthless"]

          {:ok, error} =
            cxt.injector
            |> apply_message_sequence(protocol.begin_tx())
            |> expect_error_response(protocol.migration(query, tag: "ALTER TABLE"))

          assert %Message.ErrorResponse{
                   severity: "ERROR",
                   message:
                     ~s[Invalid destructive migration on Electrified table "public"."truths": ALTER TABLE "truths" RENAME "value" TO "worthless"],
                   detail:
                     "Electric currently only supports additive migrations (ADD COLUMN, ADD INDEX)",
                   schema: "public",
                   table: "truths"
                 } = error
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "rename column on non-electrified table is allowed", cxt do
          protocol = unquote(p)
          framework = unquote(f)
          query = ~s[ALTER TABLE "underwear" RENAME COLUMN "dirty" TO "clean"]

          cxt.injector
          |> apply_message_sequence(protocol.begin_tx())
          |> apply_message_sequence(protocol.migration(query, tag: "ALTER TABLE"))
          |> apply_message_sequence(version_query(cxt, protocol, framework))
          |> apply_message_sequence(protocol.commit_tx())
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "drop index on electrified table is captured", cxt do
          protocol = unquote(p)
          framework = unquote(f)
          query = ~s[DROP INDEX "truths_idx"]

          cxt.injector
          |> apply_message_sequence(protocol.begin_tx())
          |> assert_injected(
            protocol.migration(query, tag: "DROP INDEX"),
            capture_ddl(query)
          )
          |> assert_injected(
            version_query(cxt, protocol, framework),
            assign_version(cxt.version)
          )
          |> apply_message_sequence(protocol.commit_tx())
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "drop index on non-electrified table is ignored", cxt do
          protocol = unquote(p)
          framework = unquote(f)
          query = ~s[DROP INDEX "underwear_idx"]

          cxt.injector
          |> apply_message_sequence(protocol.begin_tx())
          |> apply_message_sequence(protocol.migration(query, tag: "DROP INDEX"))
          |> apply_message_sequence(version_query(cxt, protocol, framework))
          |> apply_message_sequence(protocol.commit_tx())
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "electrified migration with no framework version sets a generated version", cxt do
          protocol = unquote(p)
          _framework = unquote(f)
          query = ~s[ALTER TABLE "truths" ADD COLUMN "another" int8]

          version = MockInjector.migration_version()

          injector =
            cxt.injector
            |> apply_message_sequence(protocol.begin_tx())
            |> assert_injected(
              protocol.migration(query, tag: "ALTER TABLE"),
              capture_ddl(query)
            )
            |> assert_preinjected(
              protocol.commit_tx(),
              assign_version(version)
            )

          refute tx_state?(injector)
        end

        @tag protocol: p.tag(), framework: f.tag()
        test "normal migration with no framework version does not require a generated version",
             cxt do
          protocol = unquote(p)
          _framework = unquote(f)
          query = ~s[ALTER TABLE "underwear" ADD COLUMN "another" int8]

          refute cxt.injector
                 |> apply_message_sequence(protocol.begin_tx())
                 |> apply_message_sequence(protocol.migration(query, tag: "ALTER TABLE"))
                 |> apply_message_sequence(protocol.commit_tx())
                 |> tx_state?()
        end

        # paused until we have the ddlx implementation
        # @tag protocol: p.tag(), framework: f.tag()
        # test "electrify and alter in same tx captures alteration"

        # paused until we have the ddlx implementation
        # @tag protocol: p.tag(), framework: f.tag()
        # test "electrify table assigns framework version"
      end

      describe "#{p.description()}" do
        @tag protocol: p.tag()
        test "ALTER TABLE .. ENABLE ELECTRIC", cxt do
          protocol = unquote(p)
          query = ~s[ALTER TABLE "underwear" ENABLE ELECTRIC]
          {:ok, command} = DDLX.ddlx_to_commands(query)

          refute cxt.injector
                 |> apply_message_sequence(protocol.begin_tx())
                 |> assert_electrified(
                   protocol.migration(query, tag: "ELECTRIC ENABLE"),
                   command
                 )
                 |> apply_message_sequence(protocol.commit_tx())
                 |> tx_state?()
        end

        @tag protocol: p.tag()
        test "ELECTRIC REVOKE UPDATE", cxt do
          protocol = unquote(p)
          query = ~s[ELECTRIC REVOKE UPDATE (status, name) ON truths FROM 'projects:house.admin';]
          {:ok, command} = DDLX.ddlx_to_commands(query)

          refute cxt.injector
                 |> apply_message_sequence(protocol.begin_tx())
                 |> assert_electrified(
                   protocol.migration(query, tag: "ELECTRIC REVOKE"),
                   command
                 )
                 |> apply_message_sequence(protocol.commit_tx())
                 |> tx_state?()
        end

        # need to ensure that the proxy doesn't leak it's auto-tx to the client
        @tag protocol: p.tag()
        test "electrified migration outside of tx automatically generates a tx", cxt do
          # we need this in order to handle migrations affecting electified
          # tables that are coming from e.g. psql where you don't generally
          # preface everything with `BEGIN`...
          protocol = unquote(p)

          %{injector: injector} = cxt

          query = ~s[ALTER TABLE "truths" ADD COLUMN "another" int8]
          version = MockInjector.migration_version()

          {begin_tx_send, begin_tx_recv} = begin_tx()
          {commit_tx_send, commit_tx_recv} = commit_tx()

          {injected_send, injected_recv} = capture_ddl(query)
          {assign_version_send, assign_version_recv} = assign_version(version)

          injector =
            case protocol.migration(query, tag: "ALTER TABLE") do
              [{migration_final_send, migration_final_recv}] ->
                assert {:ok, injector, ^begin_tx_send, []} =
                         Injector.recv_frontend(injector, migration_final_send)

                assert {:ok, injector, ^migration_final_send, []} =
                         Injector.recv_backend(injector, begin_tx_recv)

                assert {:ok, injector, ^injected_send, []} =
                         Injector.recv_backend(injector, migration_final_recv)

                {complete, incomplete} =
                  Enum.split_with(migration_final_recv, &is_struct(&1, Message.ReadyForQuery))

                complete = outside_tx(complete)

                ## VERSION HERE

                assert {:ok, injector, ^assign_version_send, []} =
                         Injector.recv_backend(injector, injected_recv)

                assert {:ok, injector, ^commit_tx_send, ^incomplete} =
                         Injector.recv_backend(injector, assign_version_recv)

                assert {:ok, injector, [], ^complete} =
                         Injector.recv_backend(injector, commit_tx_recv)

                injector

              [{migration_send, migration_recv} | migration] ->
                {migration, migration_final} = Enum.split(migration, -1)

                assert {:ok, injector, ^begin_tx_send, []} =
                         Injector.recv_frontend(injector, migration_send)

                assert {:ok, injector, ^migration_send, []} =
                         Injector.recv_backend(injector, begin_tx_recv)

                assert {:ok, injector, [], ^migration_recv} =
                         Injector.recv_backend(injector, migration_recv)

                injector =
                  Enum.reduce(migration, injector, fn {migration_send, migration_recv},
                                                      injector ->
                    assert {:ok, injector, ^migration_send, []} =
                             Injector.recv_backend(injector, migration_send)

                    assert {:ok, injector, [], ^migration_recv} =
                             Injector.recv_backend(injector, outside_tx(migration_recv))

                    injector
                  end)

                [{migration_final_send, migration_final_recv}] = migration_final

                assert {:ok, injector, ^migration_final_send, []} =
                         Injector.recv_frontend(injector, migration_final_send)

                assert {:ok, injector, ^injected_send, []} =
                         Injector.recv_backend(injector, migration_final_recv)

                {complete, incomplete} =
                  Enum.split_with(migration_final_recv, &is_struct(&1, Message.ReadyForQuery))

                complete = outside_tx(complete)

                ## VERSION HERE

                assert {:ok, injector, ^assign_version_send, []} =
                         Injector.recv_backend(injector, injected_recv)

                assert {:ok, injector, ^commit_tx_send, ^incomplete} =
                         Injector.recv_backend(injector, assign_version_recv)

                assert {:ok, injector, [], ^complete} =
                         Injector.recv_backend(injector, commit_tx_recv)

                injector
            end

          refute tx_state?(injector)
        end

        @tag protocol: p.tag()
        test "non-electrified migration outside of tx automatically generates a tx", cxt do
          protocol = unquote(p)

          %{injector: injector} = cxt

          query = ~s[ALTER TABLE "underwear" ADD COLUMN "holes" int8]

          {begin_tx_send, begin_tx_recv} = begin_tx()
          {commit_tx_send, commit_tx_recv} = commit_tx()

          injector =
            case protocol.migration(query, tag: "ALTER TABLE") do
              [{migration_final_send, migration_final_recv}] ->
                assert {:ok, injector, ^begin_tx_send, []} =
                         Injector.recv_frontend(injector, migration_final_send)

                assert {:ok, injector, ^migration_final_send, []} =
                         Injector.recv_backend(injector, begin_tx_recv)

                {complete, incomplete} =
                  Enum.split_with(migration_final_recv, &is_struct(&1, Message.ReadyForQuery))

                complete = outside_tx(complete)

                assert {:ok, injector, ^commit_tx_send, ^incomplete} =
                         Injector.recv_backend(injector, migration_final_recv)

                assert {:ok, injector, [], ^complete} =
                         Injector.recv_backend(injector, commit_tx_recv)

                injector

              [{migration_send, migration_recv} | migration] ->
                {migration, migration_final} = Enum.split(migration, -1)

                assert {:ok, injector, ^begin_tx_send, []} =
                         Injector.recv_frontend(injector, migration_send)

                assert {:ok, injector, ^migration_send, []} =
                         Injector.recv_backend(injector, begin_tx_recv)

                assert {:ok, injector, [], ^migration_recv} =
                         Injector.recv_backend(injector, migration_recv)

                injector =
                  Enum.reduce(migration, injector, fn {migration_send, migration_recv},
                                                      injector ->
                    assert {:ok, injector, ^migration_send, []} =
                             Injector.recv_backend(injector, migration_send)

                    assert {:ok, injector, [], ^migration_recv} =
                             Injector.recv_backend(injector, outside_tx(migration_recv))

                    injector
                  end)

                [{migration_final_send, migration_final_recv}] = migration_final

                assert {:ok, injector, ^migration_final_send, []} =
                         Injector.recv_frontend(injector, migration_final_send)

                {complete, incomplete} =
                  Enum.split_with(migration_final_recv, &is_struct(&1, Message.ReadyForQuery))

                complete = outside_tx(complete)

                assert {:ok, injector, ^commit_tx_send, ^incomplete} =
                         Injector.recv_backend(injector, migration_final_recv)

                assert {:ok, injector, [], ^complete} =
                         Injector.recv_backend(injector, commit_tx_recv)

                injector
            end

          refute tx_state?(injector)
        end

        @tag protocol: p.tag()
        test "dropping an electrified table outside a tx", cxt do
          # we need this in order to handle migrations affecting electified
          # tables that are coming from e.g. psql where you don't generally
          # preface everything with `BEGIN`...
          protocol = unquote(p)

          %{injector: injector} = cxt

          query = ~s[DROP TABLE "truths"]

          {begin_tx_send, begin_tx_recv} = begin_tx()

          # FIXME: this case statement seems redundant
          injector =
            case protocol.migration(query, tag: "DROP TABLE") do
              [{migration_final_send, _migration_final_recv}] ->
                assert {:ok, injector, ^begin_tx_send, []} =
                         Injector.recv_frontend(injector, migration_final_send)

                assert {:ok, injector, [%Message.Query{query: "ROLLBACK"}],
                        [%Message.ErrorResponse{}]} =
                         Injector.recv_backend(injector, begin_tx_recv)

                injector

              [{migration_send, _migration_recv} | _migration] ->
                assert {:ok, injector, ^begin_tx_send, []} =
                         Injector.recv_frontend(injector, migration_send)

                assert {:ok, injector, [%Message.Query{query: "ROLLBACK"}],
                        [%Message.ErrorResponse{}]} =
                         Injector.recv_backend(injector, begin_tx_recv)

                injector
            end

          refute tx_state?(injector)
        end

        @tag protocol: p.tag()
        test "errors from functions are correctly handled", cxt do
          # handle a ReadyForQuery{status: :failed} correctly:
          # - forward the :failed response onto the client
          protocol = unquote(p)
          %{injector: injector} = cxt
          query = ~s[CALL electric.electrify('truths')]

          failing = make_failing(protocol.query(query, tag: "CALL"))

          injector =
            cxt.injector
            |> apply_message_sequence(protocol.begin_tx())
            |> apply_message_sequence(failing)
            |> apply_message_sequence(protocol.rollback_tx())

          refute tx_state?(injector)
        end

        @tag protocol: p.tag()
        test "errors from DDLX functions are correctly handled", cxt do
          # handle a ReadyForQuery{status: :failed} correctly:
          # - forward the :failed response onto the client
          protocol = unquote(p)
          %{injector: injector} = cxt

          query = ~s[ELECTRIC REVOKE UPDATE (status, name) ON truths FROM 'projects:house.admin';]
          {:ok, command} = DDLX.ddlx_to_commands(query)

          migration_messages = protocol.invalid(query)
          # refute cxt.injector
          #        |> apply_message_sequence(protocol.begin_tx())
          #        |> assert_electrified(
          #          protocol.migration(query, tag: "ELECTRIC REVOKE"),
          #          command
          #        )
          #        |> apply_message_sequence(protocol.commit_tx())
          #        |> tx_state?()

          migration_messages = protocol.invalid(query)

          injector =
            cxt.injector
            |> apply_message_sequence(protocol.begin_tx())
            |> apply_message_sequence(protocol.invalid(query))
            |> apply_message_sequence(protocol.rollback_tx())

          refute tx_state?(injector)
        end

        @tag protocol: p.tag()
        test "errors from functions are correctly handled in autotx", cxt do
          # handle a ReadyForQuery{status: :failed} correctly:
          # - forward the :failed response onto the client
          # - rollback the autotx
          # - don't leak rollback responses to the client
          # 1. alter table something enable electric
          # 2. auto tx: begin
          # 2. is sent to server as: call electric.enable(something)
          # 3. server sends a bunch of noticeresponses that the client should get
          # 3. server responds with [ErrorResponse{}, ReadyForQuery{status: :failed}]
          # 4. auto tx should rollback
          # 5. rollback [commandcomplete, readyforquery] should disappear
          # 6. client should get [errorresponse, readyforquery{status: failed}]
        end
      end
    end
  end

  defp assert_electrified(injector, command_sequence, command) do
    # for the electrified flow, the messages `recv` in the command sequence
    # are sent by the injector, not the backend, we're basically re-writing
    # the command rather than sending it then appending other stuff afterwards
    # hence the need for a different test.

    {initial_sequence, [{last_send, last_recv}]} =
      Enum.split(command_sequence, -1)

    # get the initial setup out of the way
    injector =
      Enum.reduce(initial_sequence, injector, fn {send, recv}, injector ->
        assert {:ok, injector, [], ^recv} = Injector.recv_frontend(injector, send)

        injector
      end)

    # get the message sequences for the command queries
    queries = Command.pg_sql(command) |> Enum.map(&injector_query/1)

    # after the last injected call to the electric func we should return 
    # a CommandComplete + ReadyForQuery pair, with some fake tag
    # to signal a successful electrification command
    [{first_query_send, first_query_recv} | queries] = queries

    assert {:ok, injector, ^first_query_send, []} =
             Injector.recv_frontend(injector, last_send)

    {injector, last_query_recv} =
      Enum.reduce(queries, {injector, first_query_recv}, fn {send, recv}, {injector, last_recv} ->
        assert {:ok, injector, ^send, []} = Injector.recv_backend(injector, last_recv)
        {injector, recv}
      end)

    assert {:ok, injector, [], ^last_recv} =
             Injector.recv_backend(injector, last_query_recv)

    injector
  end

  defp injector_query(query) do
    {
      [%Message.Query{query: query}],
      [
        %Message.CommandComplete{tag: "INSERT 0 1"},
        %Message.ReadyForQuery{status: :tx}
      ]
    }
  end

  defp assert_injected(injector, message_sequence, injected) do
    # when injecting, the pattern is that generally the last set of messages
    # from the server are paused while the injection takes place
    {initial, final} = Enum.split(message_sequence, -1)

    {injected_send, injected_recv} = injected
    [{final_send, final_recv}] = final

    injector = apply_message_sequence(injector, initial)

    # the client sends the last requests that trigger the injection
    assert {:ok, injector, ^final_send, []} = Injector.recv_frontend(injector, final_send)

    # the server responds to these but those responses are not returned to the
    # client, instead we return commnds to send to the server that we want to
    # inject
    assert {:ok, injector, ^injected_send, []} = Injector.recv_backend(injector, final_recv)

    # the server responds to our injected commands but we don't forward those
    # on, instead we return the original server messages that triggered the
    # injection
    assert {:ok, injector, [], ^final_recv} = Injector.recv_backend(injector, injected_recv)

    injector
  end

  # tests for commands that re inserted before the last command in the
  # sequence, not after
  defp assert_preinjected(injector, message_sequence, injected) do
    # when injecting, the pattern is that generally the last set of messages
    # from the server are paused while the injection takes place
    {initial, final} = Enum.split(message_sequence, -1)

    {injected_send, injected_recv} = injected
    [{final_send, final_recv}] = final

    injector = apply_message_sequence(injector, initial)

    # the client sends the last requests that trigger the injection
    # before the final msgs from the client are sent, we inject our commands
    assert {:ok, injector, ^injected_send, []} =
             Injector.recv_frontend(injector, final_send)

    # once our injected commands have been replied to, we forward on the 
    # original client commands we intercepted
    assert {:ok, injector, ^final_send, []} = Injector.recv_backend(injector, injected_recv)

    # the server responds to our intercepted command and we forward the
    # responses onto the client as usual
    assert {:ok, injector, [], ^final_recv} = Injector.recv_backend(injector, final_recv)

    injector
  end

  defp expect_error_response(injector, message_sequence) do
    # when using psql the error response from the proxy leads to the 
    # client issuing a `ROLLBACK` which causes an error since our
    # rollback has already ended the tx.
    # TODO: Check what the behaviour of ORMs is. Do they issue a ROLLBACK
    # when receiving an error? If so we can remove the rollback from our 
    # server messages and just return an error to the client.

    result =
      Enum.reduce_while(message_sequence, {:no_error, injector}, fn {send, recv},
                                                                    {:no_error, injector} ->
        assert {:ok, injector, _backend_msgs1, frontend_msgs1} =
                 Injector.recv_frontend(injector, send)

        assert {:ok, injector, _backend_msgs2, frontend_msgs2} =
                 Injector.recv_backend(injector, recv)

        if error_msg =
             Enum.find(frontend_msgs1 ++ frontend_msgs2, fn %m{} -> m == Message.ErrorResponse end) do
          # assert [%Message.Query{query: "ROLLBACK"}] = backend_msgs
          {:halt, {:ok, error_msg}}
        else
          {:cont, {:no_error, injector}}
        end
      end)

    case result do
      {:ok, error} -> {:ok, error}
      {:no_error, _injector} -> :error
    end
  end

  defp apply_message_sequence(injector, message_sequence) do
    Enum.reduce(message_sequence, injector, fn {send, recv}, injector ->
      assert {:ok, injector, ^send, []} = Injector.recv_frontend(injector, send)
      assert {:ok, injector, [], ^recv} = Injector.recv_backend(injector, recv)
      injector
    end)
  end

  defp make_failing(messages, acc \\ [])

  defp make_failing([{send, recv}], acc) do
    # simulate an error in the given sequence, instead of
    # [CommandComplete, [other responses], ReadyForQuery{status: :tx}] we return 
    # [ErrorResponse, ReadyForQuery{status: :failed}]
    acc ++
      [
        {
          send,
          Enum.flat_map_reduce(recv, false, fn
            _m, true ->
              {:halt, true}

            %Message.CommandComplete{}, false ->
              {[
                 %Message.ErrorResponse{code: "00000", severity: "ERROR"},
                 %Message.ReadyForQuery{status: :failed}
               ], true}

            m, false ->
              {[m], false}
          end)
          |> elem(0)
        }
      ]
  end

  defp make_failing([seq | rest], acc) do
    make_failing(rest, acc ++ [seq])
  end

  defp begin_tx do
    {[%Message.Query{query: "BEGIN"}],
     [
       %Message.CommandComplete{tag: "BEGIN"},
       %Message.ReadyForQuery{status: :tx}
     ]}
  end

  #
  defp commit_tx(query \\ "COMMIT") do
    {[%Message.Query{query: query}],
     [
       %Message.CommandComplete{tag: query},
       %Message.ReadyForQuery{status: :idle}
     ]}
  end

  defp capture_ddl(sql) do
    {[
       %Message.Query{
         query: MockInjector.capture_ddl_query(sql)
       }
     ],
     [
       %Message.RowDescription{
         fields: [
           %{attnum: 0, fmt: 0, name: "capture_ddl", oid: 0, type: 20, typlen: 8, typmod: -1}
         ]
       },
       %Message.DataRow{fields: ["13"]},
       %Message.CommandComplete{tag: "SELECT 1"},
       %Message.ReadyForQuery{status: :tx}
     ]}
  end

  defp assign_version(version) do
    {[
       %Message.Query{
         query: MockInjector.capture_version_query(to_string(version))
       }
     ],
     [
       %Message.RowDescription{
         fields: [
           %{attnum: 0, fmt: 0, name: "capture_ddl", oid: 0, type: 20, typlen: 8, typmod: -1}
         ]
       },
       %Message.DataRow{fields: ["13"]},
       %Message.CommandComplete{tag: "SELECT 1"},
       %Message.ReadyForQuery{status: :tx}
     ]}
  end

  def outside_tx(msgs) do
    Enum.map(msgs, fn
      %Message.ReadyForQuery{status: :tx} = m ->
        %{m | status: :idle}

      %Message.ReadyForQuery{status: :idle} ->
        raise "received ready for query in unexpected idle state"

      m ->
        m
    end)
  end

  def tx_state?({nil, state}) do
    Injector.State.tx?(state)
  end
end
