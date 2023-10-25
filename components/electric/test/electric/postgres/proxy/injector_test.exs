defmodule Electric.Postgres.Proxy.InjectorTest do
  use ExUnit.Case, async: true

  alias PgProtocol.Message, as: M
  alias Electric.Postgres.Proxy.Injector
  alias Electric.Postgres.Proxy.TestScenario
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.MockSchemaLoader

  setup do
    # enable all the optional ddlx features
    Electric.Features.process_override(
      proxy_ddlx_grant: true,
      proxy_ddlx_revoke: true,
      proxy_ddlx_assign: true,
      proxy_ddlx_unassign: true
    )

    migrations = [
      {"0001",
       [
         "CREATE TABLE public.truths (id uuid PRIMARY KEY, value text)",
         "CREATE INDEX truths_idx ON public.truths (value)"
       ]}
    ]

    spec = MockSchemaLoader.backend_spec(migrations: migrations)

    {:ok, loader} =
      SchemaLoader.connect(spec, [])

    {:ok, injector} =
      Injector.new(
        [loader: loader, query_generator: TestScenario.MockInjector],
        username: "electric",
        database: "electric"
      )

    version = System.system_time(:microsecond)
    timestamp = DateTime.utc_now()

    {:ok, injector: injector, version: version, timestamp: timestamp}
  end

  defmodule FakeCapture do
    defstruct [:database, :version]

    def new(args) do
      struct(__MODULE__, args)
    end
  end

  describe "new/3" do
    test "without configured loader" do
      assert :error = Injector.new([], username: "username", database: "database")
    end

    test "default capture mode configuration" do
      opts = [
        loader: {MockSchemaLoader, something: :here},
        capture_mode: [
          default: {FakeCapture, version: :default},
          per_user: %{"fake" => {FakeCapture, version: :user}}
        ]
      ]

      assert {:ok,
              {[
                 %FakeCapture{
                   database: "important",
                   version: :default
                 }
               ],
               %Injector.State{
                 loader: {MockSchemaLoader, something: :here}
               }}} =
               Injector.new(opts, username: "simon", database: "important")
    end

    test "per-user configuration" do
      opts = [
        loader: MockSchemaLoader,
        capture_mode: [
          default: nil,
          per_user: %{"fake" => {FakeCapture, version: :fake}}
        ]
      ]

      assert {:ok, {[%FakeCapture{database: "important", version: :fake}], %Injector.State{}}} =
               Injector.new(opts, username: "fake", database: "important")
    end
  end

  for s <- TestScenario.scenarios() do
    for f <- TestScenario.frameworks() do
      describe "#{s.description()} |#{f.description()}|:" do
        @describetag Keyword.merge(s.tags(), f.tags())

        setup do
          {:ok, scenario: unquote(s), framework: unquote(f)}
        end

        @tag non_electrified_migration: true
        test "create table is not captured", cxt do
          query = ~s[CREATE TABLE "doorbells" ("another" int4)]

          cxt.scenario.assert_non_electrified_migration(cxt.injector, cxt.framework, query)
        end

        # unless the scenario has client-generated transactions
        # this situation is impossible
        if s.tx?() do
          @tag electrified_migration: true
          test "create, electrify and alter table is captured", cxt do
            queries = [
              passthrough: ~s[CREATE TABLE "socks" ("id" uuid PRIMARY KEY, colour TEXT)],
              electric: ~s[ALTER TABLE "socks" ENABLE ELECTRIC],
              capture:
                {~s[ALTER TABLE "socks" ADD COLUMN size int2],
                 shadow_add_column: [
                   %{table: {"public", "socks"}, action: :add, column: "size", type: "int2"}
                 ]}
            ]

            cxt.scenario.assert_electrified_migration(cxt.injector, cxt.framework, queries)
          end

          @tag electrified_migration: true
          test "create, electrify via function and alter table is captured", cxt do
            queries = [
              passthrough: ~s[CREATE TABLE "socks" ("id" uuid PRIMARY KEY, colour TEXT)],
              electric:
                {~s[CALL electric.electrify('socks')],
                 command: %Electric.DDLX.Command.Enable{table_name: ~s["public"."socks"]}},
              capture:
                {~s[ALTER TABLE "socks" ADD COLUMN size int2],
                 shadow_add_column: [
                   %{table: {"public", "socks"}, action: :add, column: "size", type: "int2"}
                 ]}
            ]

            cxt.scenario.assert_electrified_migration(cxt.injector, cxt.framework, queries)
          end
        end

        @tag electrified_migration: true
        test "alter electrified table", cxt do
          query =
            {~s[ALTER TABLE "truths" ADD COLUMN "another" int4],
             shadow_add_column: [
               %{table: {"public", "truths"}, action: :add, column: "another", type: "int4"}
             ]}

          cxt.scenario.assert_electrified_migration(cxt.injector, cxt.framework, query)
        end

        @tag electrified_migration: true
        test "add multiple columns to electrified table", cxt do
          query =
            {~s[ALTER TABLE "truths" ADD COLUMN "another" int4, ADD colour text, ADD COLUMN "finally" int2],
             shadow_add_column: [
               %{table: {"public", "truths"}, action: :add, column: "another", type: "int4"},
               %{table: {"public", "truths"}, action: :add, column: "colour", type: "text"},
               %{table: {"public", "truths"}, action: :add, column: "finally", type: "int2"}
             ]}

          cxt.scenario.assert_electrified_migration(cxt.injector, cxt.framework, query)
        end

        @tag non_electrified_migration: true
        test "alter non-electrified table does not inject", cxt do
          query = ~s[ALTER TABLE "underwear" ADD COLUMN "dirty" bool DEFAULT false]

          cxt.scenario.assert_non_electrified_migration(cxt.injector, cxt.framework, query)
        end

        if s.tx?() do
          @tag electrified_migration: true
          test "combined migration", cxt do
            query = [
              capture:
                {~s[ALTER TABLE "truths" ADD COLUMN "another" int4],
                 shadow_add_column: [
                   %{table: {"public", "truths"}, action: :add, column: "another", type: "int4"}
                 ]},
              # capture: {:alter_table, "truths", [{:add, "another", "int4"}]},
              passthrough: ~s[ALTER TABLE "socks" ADD COLUMN "holes" int2]
            ]

            cxt.scenario.assert_electrified_migration(cxt.injector, cxt.framework, query)
          end
        end

        @tag electrified_migration: true
        test "create index on electrified table is captured", cxt do
          query = ~s[CREATE INDEX "truths_idx" ON "truths" (value)]

          cxt.scenario.assert_electrified_migration(cxt.injector, cxt.framework, query)
        end

        @tag non_electrified_migration: true
        test "create index on non-electrified table is ignored", cxt do
          query = ~s[CREATE INDEX "underwear_idx" ON "underwear" (dirty)]

          cxt.scenario.assert_non_electrified_migration(cxt.injector, cxt.framework, query)
        end

        @tag injector_error: true
        test "drop electrified table raises error", cxt do
          query = ~s[DROP TABLE "truths"]

          cxt.scenario.assert_injector_error(cxt.injector, query,
            message: "Cannot DROP Electrified table \"public\".\"truths\"",
            schema: "public",
            table: "truths"
          )
        end

        @tag non_electrified_migration: true
        test "drop non-electrified table is allowed", cxt do
          query = ~s[DROP TABLE "underwear"]

          cxt.scenario.assert_non_electrified_migration(cxt.injector, cxt.framework, query)
        end

        @tag injector_error: true
        test "drop column on electrified table raises error", cxt do
          query = ~s[ALTER TABLE "truths" DROP "value"]

          cxt.scenario.assert_injector_error(cxt.injector, query,
            message:
              "Invalid destructive migration on Electrified table \"public\".\"truths\": ALTER TABLE \"truths\" DROP \"value\"",
            detail:
              "Electric currently only supports additive migrations (ADD COLUMN, ADD INDEX)",
            schema: "public",
            table: "truths"
          )
        end

        @tag non_electrified_migration: true
        test "drop column on non-electrified table is allowed", cxt do
          query = ~s[ALTER TABLE "underwear" DROP COLUMN "dirty"]

          cxt.scenario.assert_non_electrified_migration(cxt.injector, cxt.framework, query)
        end

        @tag injector_error: true
        test "rename column on electrified table raises error", cxt do
          query = ~s[ALTER TABLE "truths" RENAME "value" TO "worthless"]

          cxt.scenario.assert_injector_error(cxt.injector, query,
            message:
              "Invalid destructive migration on Electrified table \"public\".\"truths\": ALTER TABLE \"truths\" RENAME \"value\" TO \"worthless\"",
            detail:
              "Electric currently only supports additive migrations (ADD COLUMN, ADD INDEX)",
            schema: "public",
            table: "truths"
          )
        end

        @tag non_electrified_migration: true
        test "rename column on non-electrified table is allowed", cxt do
          query = ~s[ALTER TABLE "underwear" RENAME COLUMN "dirty" TO "clean"]

          cxt.scenario.assert_non_electrified_migration(cxt.injector, cxt.framework, query)
        end

        @tag electrified_migration: true
        test "drop index on electrified table is captured", cxt do
          query = ~s[DROP INDEX "truths_idx"]

          cxt.scenario.assert_electrified_migration(cxt.injector, cxt.framework, query)
        end

        @tag non_electrified_migration: true
        test "drop index on non-electrified table is ignored", cxt do
          query = ~s[DROP INDEX "underwear_idx"]

          cxt.scenario.assert_non_electrified_migration(cxt.injector, cxt.framework, query)
        end

        test "ALTER TABLE .. ENABLE ELECTRIC", cxt do
          query = ~s[ALTER TABLE "underwear" ENABLE ELECTRIC]

          cxt.scenario.assert_valid_electric_command(cxt.injector, cxt.framework, query)
        end

        @tag injector_error: true
        test "ALTER TABLE ADD invalid column type", cxt do
          query = ~s[ALTER TABLE "truths" ADD COLUMN addr cidr]

          cxt.scenario.assert_injector_error(cxt.injector, query,
            code: "00000",
            message: "Cannot add column of type \"cidr\"",
            query: query
          )
        end

        test "ELECTRIC REVOKE UPDATE", cxt do
          query = ~s[ELECTRIC REVOKE UPDATE (status, name) ON truths FROM 'projects:house.admin';]

          cxt.scenario.assert_valid_electric_command(cxt.injector, cxt.framework, query)
        end

        @tag injector_error: true
        test "invalid electric command", cxt do
          query = "ELECTRIC GRANT JUNK ON \"thing.Köln_en$ts\" TO 'projects:house.admin'"

          cxt.scenario.assert_injector_error(cxt.injector, query,
            code: "00000",
            detail: "Something went wrong near JUNK",
            query: "ELECTRIC GRANT JUNK ON thing.Köln_en$ts TO 'projects:house.admin'"
          )
        end

        @tag server_error: true
        test "errors from functions are correctly handled", cxt do
          # imagine that this function errors for some reason
          query = ~s[ALTER TABLE truths ENABLE ELECTRIC]

          cxt.scenario.assert_electrify_server_error(cxt.injector, cxt.framework, query,
            message: "table truths already electrified"
          )
        end

        @tag injector_passthrough: true
        test "non-electrified ALTER object", cxt do
          # just some representative (but valid) statement that we should pass-through as-is
          query = ~s[ALTER SEQUENCE IF EXISTS  "something" INCREMENT BY 2 START WITH 100]

          cxt.scenario.assert_injector_passthrough(cxt.injector, cxt.framework, query)
        end

        @tag injector_passthrough: true
        test "non-electrified CREATE object", cxt do
          # just some representative (but valid) statement that we should pass-through as-is
          query = """
          CREATE OPERATOR === (
            LEFTARG = box,
            RIGHTARG = box,
            FUNCTION = area_equal_function,
            COMMUTATOR = ===,
            NEGATOR = !==,
            RESTRICT = area_restriction_function,
            JOIN = area_join_function,
            HASHES, MERGES
          )
          """

          cxt.scenario.assert_injector_passthrough(
            cxt.injector,
            cxt.framework,
            String.trim(query)
          )
        end

        @tag injector_passthrough: true
        test "non-electrified DROP object", cxt do
          # just some representative (but valid) statements that we should pass-through as-is
          objects =
            ~w(EXTENSION FUNCTION GROUP LANGUAGE PROCEDURE PUBLICATION ROLE ROUTINE SCHEMA SEQUENCE SERVER STATISTICS SUBSCRIPTION TABLESPACE TYPE USER)

          for object <- objects do
            query = ~s[DROP #{object} "something"]

            cxt.scenario.assert_injector_passthrough(cxt.injector, cxt.framework, query)
          end
        end
      end
    end
  end

  describe "specific scenarios" do
    import Electric.Postgres.Proxy.TestScenario
    alias PgProtocol.Message, as: M

    test "postgrex startup", cxt do
      query =
        "SELECT t.oid, t.typname, t.typsend, t.typreceive, t.typoutput, t.typinput,\n       coalesce(d.typelem, t.typelem), coalesce(r.rngsubtype, 0), ARRAY (\n  SELECT a.atttypid\n  FROM pg_attribute AS a\n  WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped\n  ORDER BY a.attnum\n)\nFROM pg_type AS t\nLEFT JOIN pg_type AS d ON t.typbasetype = d.oid\nLEFT JOIN pg_range AS r ON r.rngtypid = t.oid OR r.rngmultitypid = t.oid OR (t.typbasetype <> 0 AND r.rngtypid = t.typbasetype)\nWHERE (t.typrelid = 0)\nAND (t.typelem = 0 OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type s WHERE s.typrelid != 0 AND s.oid = t.typelem))"

      cxt.injector
      |> client(query(query))
      |> server([%M.RowDescription{}, %M.DataRow{}, %M.DataRow{}])
      |> server([%M.DataRow{}, %M.DataRow{}, %M.DataRow{}, %M.DataRow{}, %M.DataRow{}])
      |> server([%M.DataRow{}, %M.DataRow{}, %M.DataRow{}, %M.DataRow{}, %M.DataRow{}])
      |> server([
        %M.DataRow{},
        %M.DataRow{},
        %M.DataRow{},
        %M.DataRow{},
        %M.CommandComplete{tag: "MY TAG"},
        %M.ReadyForQuery{status: :idle}
      ])
      |> client(
        parse_describe(
          "CREATE TABLE IF NOT EXISTS \"schema_migrations\" (\"version\" bigint, \"inserted_at\" timestamp(0), PRIMARY KEY (\"version\"))"
        ),
        server: [begin()]
      )
      |> server(complete_ready("BEGIN", :tx),
        server:
          parse_describe(
            "CREATE TABLE IF NOT EXISTS \"schema_migrations\" (\"version\" bigint, \"inserted_at\" timestamp(0), PRIMARY KEY (\"version\"))"
          )
      )
      |> server(parse_describe_complete())
      |> client(bind_execute())
      |> server(bind_execute_complete("CREATE TABLE", :tx), server: commit())
      |> server(complete_ready("COMMIT", :idle),
        client: bind_execute_complete("CREATE TABLE", :idle)
      )
      |> idle!()
    end

    test "prisma", cxt do
      alias Electric.DDLX

      version_query =
        "INSERT INTO \"_prisma_migrations\" (\"id\",\"checksum\",\"started_at\",\"migration_name\") VALUES ($1,$2,$3,$4)"

      query = """
      CREATE TABLE something (id uuid PRIMARY KEY, value text);
      ALTER TABLE something ENABLE ELECTRIC;
      CREATE TABLE ignoreme (id uuid PRIMARY KEY);
      ALTER TABLE something ADD amount int4 DEFAULT 0, ADD colour varchar;
      """

      {:ok, command} = DDLX.parse("ALTER TABLE something ENABLE ELECTRIC")
      [electric] = DDLX.Command.pg_sql(command)
      version = "20230915175206"

      cxt.injector
      |> client([M.Close, M.Sync, %M.Parse{name: "s4", query: version_query}, M.Describe, M.Sync])
      |> server([M.CloseComplete, %M.ReadyForQuery{status: :idle}])
      |> server([
        M.ParseComplete,
        M.ParameterDescription,
        M.NoData,
        %M.ReadyForQuery{status: :idle}
      ])
      |> client(
        bind_execute("s3",
          bind: [
            parameter_format_codes: [1, 1, 1, 1],
            parameters: [
              "94ffb457-2f55-42f5-89c6-2674e357f3f9",
              "f95cec29a0509d802cf4f3056f0827869ce2d62b46eb730e0cca0d540b141754",
              <<0, 2, 169, 244, 118, 117, 13, 234>>,
              "#{version}_init"
            ]
          ]
        )
      )
      |> server(bind_execute_complete("INSERT 1"))
      |> client(query(query),
        server: [begin()]
      )
      |> server(complete_ready("BEGIN", :tx),
        server: [query("CREATE TABLE something (id uuid PRIMARY KEY, value text)")]
      )
      |> server(complete_ready("CREATE TABLE"), server: [query(electric)])
      |> server(complete_ready("CALL"),
        server: [query("CREATE TABLE ignoreme (id uuid PRIMARY KEY)")]
      )
      |> server(complete_ready("CREATE TABLE"),
        server: [query("ALTER TABLE something ADD amount int4 DEFAULT 0, ADD colour varchar")]
      )
      |> server(complete_ready("ALTER TABLE"),
        server: [
          capture_ddl_query("ALTER TABLE something ADD amount int4 DEFAULT 0, ADD colour varchar")
        ],
        client:
          capture_notice("ALTER TABLE something ADD amount int4 DEFAULT 0, ADD colour varchar")
      )
      |> server(capture_ddl_complete(),
        server: [
          alter_shadow_table_query(%{
            table: {"public", "something"},
            action: :add,
            column: "amount",
            type: "int4"
          })
        ]
      )
      |> server(alter_shadow_table_complete(),
        server: [
          alter_shadow_table_query(%{
            table: {"public", "something"},
            action: :add,
            column: "colour",
            type: "varchar"
          })
        ]
      )
      |> server(alter_shadow_table_complete(), server: capture_version_query(version, 2))
      |> server(capture_version_complete(), server: commit())
      |> server(complete_ready("COMMIT", :idle),
        client: [
          complete("CREATE TABLE"),
          complete("ELECTRIC ENABLE"),
          complete("CREATE TABLE"),
          complete("ALTER TABLE"),
          ready(:idle)
        ]
      )
      |> idle!()
    end

    test "parse, describe, sync", cxt do
      cxt.injector
      |> client(parse_describe_sync("SELECT version()"))
      |> server(parse_describe_sync_complete(:idle))
      |> client(bind_execute())
      |> server([%M.BindComplete{}, %M.DataRow{} | complete_ready("SELECT 1", :idle)])
      |> idle!()
    end

    test "close, sync, parse, describe, sync", cxt do
      cxt.injector
      |> client(
        [%M.Close{}, %M.Sync{} | parse_describe_sync("SELECT version()")]
        # server: [%M.Close{}, %M.Sync{}]
      )
      |> server([
        %M.CloseComplete{},
        %M.ReadyForQuery{status: :idle} | parse_describe_sync_complete(:idle)
      ])
      |> client([M.Bind, M.Execute, M.Sync])
      |> server([M.BindComplete, M.DataRow | complete_ready("SELECT 1", :idle)])
      |> idle!()
    end

    test "interleaved close, sync, parse, describe, sync", cxt do
      import Electric.Postgres.Proxy.TestScenario

      cxt.injector
      |> client([%M.Close{}, %M.Sync{}])
      |> client(parse_describe_sync("SELECT version()"))
      |> server([%M.CloseComplete{}, %M.ReadyForQuery{status: :idle}])
      |> server(parse_describe_sync_complete(:idle))
      |> client([M.Bind, M.Execute, M.Sync])
      |> server([M.BindComplete, M.DataRow | complete_ready("SELECT 1", :idle)])
      |> idle!()
    end

    test "create function", cxt do
      query1 =
        "create or replace function function1() returns bool as $$ return true; $$ language pgpsql"

      query2 =
        "create or replace function function2() returns bool as $$ return true; $$ language pgpsql"

      query3 =
        "alter table electric.nonsense add column age int4"

      query = Enum.join([query1 <> ";", query2 <> ";", query3 <> ";"], "\n")

      cxt.injector
      |> client(begin())
      |> server(complete_ready("BEGIN"))
      |> client(query(query), server: query(query1))
      |> server(complete_ready("CREATE FUNCTION1"), server: query(query2))
      |> server(complete_ready("CREATE FUNCTION2"), server: query(query3))
      |> server(complete_ready("ALTER TABLE"),
        client: [
          complete("CREATE FUNCTION1"),
          complete("CREATE FUNCTION2"),
          complete("ALTER TABLE"),
          ready(:tx)
        ]
      )
      |> client(commit())
      |> server(complete_ready("COMMIT", :idle))
      |> idle!()
    end

    test "drop random things", cxt do
      cxt.injector
      |> client(begin())
      |> server(complete_ready("BEGIN"))
      |> client(query("DROP FUNCTION IF EXISTS \"electric.ddlx_sql_drop_handler\" CASCADE"))
      |> server(complete_ready("DROP FUNCTION"))
      |> client(commit())
      |> server(complete_ready("COMMIT", :idle))
      |> idle!()

      cxt.injector
      |> client(begin())
      |> server(complete_ready("BEGIN"))
      |> client(query("DROP EVENT TRIGGER IF EXISTS \"electric_event_trigger_sql_drop\" CASCADE"))
      |> server(complete_ready("DROP EVENT TRIGGER"))
      |> client(commit())
      |> server(complete_ready("COMMIT", :idle))
      |> idle!()
    end

    test "delete from electrified table with no tx", cxt do
      cxt.injector
      |> client(query("DELETE FROM public.truths"))
      |> server(complete_ready("DELETE 3", :idle))
      |> idle!()
    end

    test "malformed queries", cxt do
      cxt.injector
      |> client(query("INSERT INTO items VALUES gen_random_uuid();"),
        client: [M.ErrorResponse, %M.ReadyForQuery{status: :failed}]
      )
      |> idle!()
    end

    test "@databases version capture", cxt do
      alias Electric.DDLX

      {:ok, command} = DDLX.parse("ALTER TABLE public.socks ENABLE ELECTRIC;")
      [electric] = DDLX.Command.pg_sql(command)

      version_query =
        "INSERT INTO \"atdatabases_migrations_applied\"\n  (\n    index, name, script,\n    applied_at, ignored_error, obsolete\n  )\nVALUES\n  (\n    $1, $2, $3,\n    $4,\n    $5,\n    $6\n  )"

      cxt.injector
      |> client(query("BEGIN"))
      |> server(complete_ready("BEGIN", :tx))
      |> client(query("ALTER TABLE public.socks ENABLE ELECTRIC;"), server: query(electric))
      |> server(complete_ready("CALL", :tx), client: complete_ready("ELECTRIC ENABLE"))
      |> client(%M.Parse{query: version_query})
      |> client([
        %M.Bind{
          parameter_format_codes: [0, 0, 0, 0, 0, 0],
          parameters: [
            "99",
            "99-something.sql",
            "ALTER TABLE public.socks ENABLE ELECTRIC;",
            "2023-10-06T11:43:15.699+01:00",
            nil,
            "false"
          ]
        },
        M.Describe,
        M.Execute,
        M.Sync
      ])
      |> server(
        [
          M.ParseComplete,
          M.BindComplete,
          M.NoData,
          %M.CommandComplete{tag: "INSERT 0 1"},
          %M.ReadyForQuery{status: :tx}
        ],
        client: [],
        server: [capture_version_query("99", 4)]
      )
      |> server(capture_version_complete(),
        client: [
          M.ParseComplete,
          M.BindComplete,
          M.NoData,
          %M.CommandComplete{tag: "INSERT 0 1"},
          %M.ReadyForQuery{status: :tx}
        ]
      )
      |> client(query("COMMIT"))
      |> server(complete_ready("COMMIT", :idle))
      |> idle!()
    end
  end

  describe "Injector.Electric" do
    alias Electric.Postgres.Proxy.Injector.Electric
    alias PgProtocol.Message, as: M

    test "group_messages/1" do
      assert Electric.group_messages([%M.Query{query: "BEGIN"}]) == [
               {:simple, [%M.Query{query: "BEGIN"}]}
             ]

      assert Electric.group_messages([
               %M.Close{},
               %M.Parse{},
               %M.Describe{},
               %M.Flush{}
             ]) == [
               {:extended,
                [
                  %M.Close{},
                  %M.Parse{},
                  %M.Describe{},
                  %M.Flush{}
                ]}
             ]

      assert Electric.group_messages([
               %M.Close{},
               %M.Parse{},
               %M.Describe{},
               %M.Sync{},
               %M.Bind{},
               %M.Execute{},
               %M.Sync{}
             ]) == [
               {:extended,
                [
                  %M.Close{},
                  %M.Parse{},
                  %M.Describe{},
                  %M.Sync{}
                ]},
               {:extended,
                [
                  %M.Bind{},
                  %M.Execute{},
                  %M.Sync{}
                ]}
             ]

      assert Electric.group_messages([
               %M.Query{},
               %M.Close{},
               %M.Parse{},
               %M.Describe{},
               %M.Sync{},
               %M.Query{}
             ]) == [
               {:simple, [%M.Query{}]},
               {:extended, [%M.Close{}, %M.Parse{}, %M.Describe{}, %M.Sync{}]},
               {:simple, [%M.Query{}]}
             ]
    end
  end
end
