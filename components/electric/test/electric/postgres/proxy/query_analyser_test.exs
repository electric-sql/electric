defmodule Electric.Postgres.Proxy.QueryAnalyserTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Electric.Postgres.Proxy.{Injector.State, Parser}
  alias Electric.Postgres.MockSchemaLoader
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.SQLGenerator
  alias PgProtocol.Message, as: M

  def simple(sql), do: %M.Query{query: sql}
  def extended(sql, attrs \\ []), do: struct(M.Parse, Keyword.put(attrs, :query, sql))

  describe "analyse/2" do
    alias Electric.Postgres.Proxy.QueryAnalysis

    def analyse(sql, cxt) when is_binary(sql) do
      analyse(simple(sql), cxt)
    end

    def analyse(msg, cxt) do
      with {:ok, stmts} <- Parser.parse(msg) do
        Enum.map(stmts, &Parser.analyse(&1, cxt.state))
      end
    end

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

      state = %State{loader: loader}

      {:ok, state: state, loader: loader}
    end

    test "BEGIN; COMMIT", cxt do
      assert [
               %QueryAnalysis{
                 mode: :simple,
                 action: {:tx, :begin},
                 table: nil,
                 electrified?: false,
                 allowed?: true,
                 sql: "BEGIN",
                 ast: %{}
               },
               %QueryAnalysis{
                 mode: :simple,
                 action: {:tx, :commit},
                 table: nil,
                 electrified?: false,
                 allowed?: true,
                 sql: "COMMIT",
                 ast: %{}
               }
             ] = analyse(simple("BEGIN; COMMIT;"), cxt)

      assert [
               %QueryAnalysis{
                 action: {:tx, :begin},
                 table: nil,
                 electrified?: false,
                 allowed?: true,
                 sql: "BEGIN",
                 ast: %{}
               },
               %QueryAnalysis{
                 action: {:tx, :rollback},
                 table: nil,
                 electrified?: false,
                 allowed?: true,
                 sql: "ROLLBACK",
                 ast: %{}
               }
             ] = analyse(simple("BEGIN; ROLLBACK;"), cxt)
    end

    test "CREATE TABLE", cxt do
      assert [
               %QueryAnalysis{
                 mode: :simple,
                 action: {:create, "table"},
                 table: {"public", "balloons"},
                 type: :table,
                 electrified?: false,
                 tx?: true,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 source: %M.Query{
                   query: "CREATE TABLE public.balloons (id uuid PRIMARY KEY, value text)"
                 },
                 sql: "CREATE TABLE public.balloons (id uuid PRIMARY KEY, value text)"
               }
             ] =
               analyse(
                 simple("CREATE TABLE public.balloons (id uuid PRIMARY KEY, value text);"),
                 cxt
               )

      assert [
               %QueryAnalysis{
                 mode: :extended,
                 action: {:create, "table"},
                 table: {"public", "balloons"},
                 type: :table,
                 electrified?: false,
                 tx?: true,
                 allowed?: true,
                 capture?: false,
                 source: %M.Parse{
                   query: "CREATE TABLE public.balloons (id uuid PRIMARY KEY, value text);"
                 },
                 ast: %{},
                 sql: "CREATE TABLE public.balloons (id uuid PRIMARY KEY, value text);"
               }
             ] =
               analyse(
                 extended("CREATE TABLE public.balloons (id uuid PRIMARY KEY, value text);"),
                 cxt
               )
    end

    test "ALTER TABLE .. ADD COLUMN", cxt do
      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "truths"},
                 type: :table,
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 source: %M.Query{query: "ALTER TABLE public.truths ADD COLUMN clowns text"},
                 ast: %{},
                 sql: "ALTER TABLE public.truths ADD COLUMN clowns text"
               }
             ] =
               analyse(
                 "ALTER TABLE public.truths ADD COLUMN clowns text;",
                 cxt
               )

      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "truths"},
                 electrified?: true,
                 tx?: true,
                 allowed?: false,
                 ast: %{},
                 source: %M.Query{query: "ALTER TABLE public.truths ADD COLUMN ip cidr"},
                 sql: "ALTER TABLE public.truths ADD COLUMN ip cidr",
                 error: %{
                   message: ~s[Cannot electrify column of type "cidr"]
                 }
               }
             ] =
               analyse("ALTER TABLE public.truths ADD COLUMN ip cidr;", cxt)

      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "truths"},
                 electrified?: true,
                 tx?: true,
                 allowed?: false,
                 capture?: true,
                 ast: %{},
                 sql: "ALTER TABLE public.truths ADD COLUMN clowns text, ADD COLUMN ip cidr",
                 error: %{
                   message: ~s[Cannot electrify column of type "cidr"]
                 }
               }
             ] =
               analyse(
                 "ALTER TABLE public.truths ADD COLUMN clowns text, ADD COLUMN ip cidr;",
                 cxt
               )

      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "socks"},
                 electrified?: false,
                 tx?: true,
                 allowed?: true,
                 ast: %{},
                 sql: "ALTER TABLE public.socks ADD COLUMN ip cidr",
                 error: nil
               }
             ] =
               analyse("ALTER TABLE public.socks ADD COLUMN ip cidr;", cxt)
    end

    test "ALTER TABLE .. DROP COLUMN", cxt do
      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "truths"},
                 electrified?: true,
                 tx?: true,
                 allowed?: false,
                 ast: %{},
                 sql: "ALTER TABLE public.truths DROP COLUMN value",
                 error: %{
                   message: ~s[Cannot drop column "value" of electrified table "public"."truths"]
                 }
               }
             ] =
               analyse("ALTER TABLE public.truths DROP COLUMN value;", cxt)

      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "socks"},
                 electrified?: false,
                 allowed?: true,
                 ast: %{},
                 sql: "ALTER TABLE public.socks DROP COLUMN value, DROP COLUMN something",
                 error: nil
               }
             ] =
               analyse(
                 "ALTER TABLE public.socks DROP COLUMN value, DROP COLUMN something;",
                 cxt
               )
    end

    test "ALTER TABLE .. RENAME COLUMN", cxt do
      assert [
               %QueryAnalysis{
                 action: {:rename, "column"},
                 table: {"public", "truths"},
                 type: :table,
                 electrified?: true,
                 tx?: true,
                 allowed?: false,
                 ast: %{},
                 source: %M.Query{
                   query: "ALTER TABLE public.truths RENAME COLUMN value TO colour"
                 },
                 sql: "ALTER TABLE public.truths RENAME COLUMN value TO colour",
                 error: %{
                   message:
                     ~s[Cannot rename column "value" of electrified table "public"."truths"]
                 }
               },
               %QueryAnalysis{
                 action: {:rename, "column"},
                 table: {"public", "socks"},
                 type: :table,
                 electrified?: false,
                 tx?: true,
                 allowed?: true,
                 ast: %{},
                 source: %M.Query{
                   query: "ALTER TABLE public.socks RENAME COLUMN value TO colour"
                 },
                 sql: "ALTER TABLE public.socks RENAME COLUMN value TO colour",
                 error: nil
               }
             ] =
               analyse(
                 "ALTER TABLE public.truths RENAME COLUMN value TO colour;ALTER TABLE public.socks RENAME COLUMN value TO colour;",
                 cxt
               )
    end

    test "ALTER TABLE .. ALTER COLUMN ...", cxt do
      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "truths"},
                 electrified?: true,
                 tx?: true,
                 allowed?: false,
                 ast: %{},
                 sql: "ALTER TABLE public.truths ALTER COLUMN value TYPE int2",
                 error: %{
                   message:
                     ~s[Cannot change type of column "value" of electrified table "public"."truths"]
                 }
               },
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "socks"},
                 electrified?: false,
                 tx?: true,
                 allowed?: true,
                 ast: %{},
                 sql: "ALTER TABLE public.socks ALTER COLUMN value TYPE int2",
                 error: nil
               }
             ] =
               analyse(
                 "ALTER TABLE public.truths ALTER COLUMN value TYPE int2; ALTER TABLE public.socks ALTER COLUMN value TYPE int2;",
                 cxt
               )
    end

    # just spam the analyser with all combinations of `ALTER TABLE` without
    # testing the "allowability", but just to make sure it doesn't crash
    property "ALTER TABLE... (electrified)", cxt do
      check all(sql <- SQLGenerator.Table.alter_table(namespace: "public", table_name: "truths")) do
        assert [%QueryAnalysis{electrified?: true, sql: ^sql}] =
                 analyse(sql, cxt)
      end
    end

    property "ALTER TABLE... (non-electrified)", cxt do
      check all(sql <- SQLGenerator.Table.alter_table(namespace: "public", table_name: "socks")) do
        assert [%QueryAnalysis{electrified?: false, allowed?: true, capture?: false}] =
                 analyse(sql, cxt)
      end
    end

    test "CREATE INDEX...", cxt do
      assert [
               %QueryAnalysis{
                 action: {:create, "index"},
                 table: {"public", "truths"},
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %{},
                 sql: "CREATE INDEX public_truths_idx ON public.truths USING gist (value)",
                 error: nil
               },
               %QueryAnalysis{
                 action: {:create, "index"},
                 table: {"public", "socks"},
                 electrified?: false,
                 tx?: true,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: "CREATE INDEX public_socks_idx ON public.socks (value)",
                 error: nil
               }
             ] =
               analyse(
                 "CREATE INDEX public_truths_idx ON public.truths USING gist (value);\nCREATE INDEX public_socks_idx ON public.socks (value);",
                 cxt
               )
    end

    test "DROP INDEX...", cxt do
      assert [
               %QueryAnalysis{
                 action: {:drop, "index"},
                 table: {"public", "truths_idx"},
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %{},
                 sql: "DROP INDEX truths_idx",
                 error: nil
               },
               %QueryAnalysis{
                 action: {:drop, "index"},
                 table: {"public", "some_other_idx"},
                 electrified?: false,
                 tx?: true,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: "DROP INDEX some_other_idx",
                 error: nil
               }
             ] =
               analyse(
                 "DROP INDEX truths_idx;\nDROP INDEX some_other_idx;",
                 cxt
               )
    end

    test "DROP TABLE...", cxt do
      assert [
               %QueryAnalysis{
                 action: {:drop, "table"},
                 table: {"public", "truths"},
                 type: :table,
                 electrified?: true,
                 tx?: true,
                 allowed?: false,
                 capture?: false,
                 ast: %{},
                 sql: "DROP TABLE public.truths",
                 source: %M.Query{query: "DROP TABLE public.truths"},
                 error: %{
                   message: ~s[Cannot drop electrified table "public"."truths"]
                 }
               },
               %QueryAnalysis{
                 action: {:drop, "table"},
                 table: {"public", "socks"},
                 type: :table,
                 electrified?: false,
                 tx?: true,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: "DROP TABLE public.socks",
                 source: %M.Query{query: "DROP TABLE public.socks"},
                 error: nil
               }
             ] =
               analyse(
                 "DROP TABLE public.truths; DROP TABLE public.socks;",
                 cxt
               )
    end

    test "SELECT ...", cxt do
      assert [
               %QueryAnalysis{
                 action: :select,
                 table: {"public", "data"},
                 electrified?: false,
                 tx?: false,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: "SELECT * FROM public.data WHERE value > 10.0",
                 source: %M.Query{query: "SELECT * FROM public.data WHERE value > 10.0"},
                 error: nil
               }
             ] =
               analyse(
                 "SELECT * FROM public.data WHERE value > 10.0;",
                 cxt
               )
    end

    test "INSERT ...", cxt do
      assert [
               %QueryAnalysis{
                 action: :insert,
                 table: {"public", "data"},
                 electrified?: false,
                 tx?: false,
                 allowed?: true,
                 # leave determination of the capture to somewhere later in the process that uses more context (?)
                 capture?: false,
                 ast: %{},
                 sql: "INSERT INTO public.data (colour, amount) VALUES ($1, $2)",
                 error: nil
               }
             ] =
               analyse(
                 "INSERT INTO public.data (colour, amount) VALUES ($1, $2);",
                 cxt
               )
    end

    test "DELETE ...", cxt do
      assert [
               %QueryAnalysis{
                 action: :delete,
                 table: {"public", "data"},
                 electrified?: false,
                 tx?: false,
                 allowed?: true,
                 # leave determination of the capture to somewhere later in the process that uses more context (?)
                 capture?: false,
                 ast: %{},
                 sql: "DELETE FROM public.data",
                 error: nil
               },
               %QueryAnalysis{
                 action: :delete,
                 table: {"public", "truths"},
                 electrified?: true,
                 tx?: false,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: "DELETE FROM public.truths",
                 error: nil
               }
             ] =
               analyse(
                 "DELETE FROM public.data; DELETE FROM public.truths ;",
                 cxt
               )
    end

    test "ALTER TABLE ...; CREATE INDEX", cxt do
      query1 =
        String.trim("""
        ALTER TABLE "truths" ADD COLUMN     "category" TEXT NOT NULL,
         ADD COLUMN     "condition" TEXT NOT NULL,
         ADD COLUMN     "description" TEXT NOT NULL,
         ADD COLUMN     "electric_user_id" TEXT NOT NULL,
         ADD COLUMN     "price" INTEGER NOT NULL,
         ADD COLUMN     "timestamp" SMALLINT NOT NULL
        """)

      query2 =
        String.trim("""
        -- CreateIndex
        CREATE INDEX "Items_timestamp_idx" ON "truths"("timestamp")
        """)

      query3 =
        String.trim("""
        ALTER TABLE "socks" ADD COLUMN     "category" TEXT NOT NULL,
         ADD COLUMN     "condition" TEXT NOT NULL
        """)

      query = query1 <> ";\n\n" <> query2 <> ";\n\n" <> query3 <> ";\n"

      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "truths"},
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %{},
                 sql: ^query1
               },
               %QueryAnalysis{
                 action: {:create, "index"},
                 table: {"public", "truths"},
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %{},
                 sql: ^query2
               },
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "socks"},
                 electrified?: false,
                 tx?: true,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: ^query3
               }
             ] = analyse(query, cxt)
    end

    test "ELECTRIC...", cxt do
      assert [
               %QueryAnalysis{
                 action: {:electric, %Electric.DDLX.Command.Enable{}},
                 table: {"public", "truths"},
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %Electric.DDLX.Command.Enable{},
                 sql: "ALTER TABLE truths ENABLE ELECTRIC"
               }
             ] =
               analyse("ALTER TABLE truths ENABLE ELECTRIC;", cxt)

      assert [
               %QueryAnalysis{
                 action: {:electric, %Electric.DDLX.Command.Revoke{}},
                 table: {"public", "truths"},
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %Electric.DDLX.Command.Revoke{},
                 sql:
                   ~s[ELECTRIC REVOKE UPDATE (status, name) ON truths FROM 'projects:house.admin']
               }
             ] =
               analyse(
                 ~s[ELECTRIC REVOKE UPDATE (status, name) ON truths FROM 'projects:house.admin';],
                 cxt
               )
    end

    test "CREATE TABLE..; ALTER TABLE ... ENABLE ELECTRIC; ALTER TABLE...", cxt do
      query1 =
        String.trim("""
        CREATE TABLE pants (
          id uuid PRIMARY KEY,
          colour text NOT NULL
        )
        """)

      query2 = "ALTER TABLE public.pants ENABLE ELECTRIC"
      query3 = "ALTER TABLE public.truths ADD COLUMN age int2"

      query = query1 <> ";\n\n" <> query2 <> ";\n\n" <> query3 <> ";\n\n"

      assert [
               %QueryAnalysis{
                 action: {:create, "table"},
                 table: {"public", "pants"},
                 electrified?: false,
                 tx?: true,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: ^query1
               },
               %QueryAnalysis{
                 action: {:electric, %Electric.DDLX.Command.Enable{}},
                 table: {"public", "pants"},
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %Electric.DDLX.Command.Enable{},
                 sql: ^query2
               },
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "truths"},
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %{},
                 sql: ^query3
               }
             ] = analyse(query, cxt)
    end

    test "multitple ELECTRIC commands", cxt do
      query1 = "ALTER TABLE public.pants ENABLE electric"
      query2 = "ALTER TABLE public.hats ENABLE ElEcTrIc"
      query3 = "create table teeth (id uuid PRIMARY KEY, caries int2)"
      query4 = "Electric GRANT UPDATE (status, name) ON truths TO 'projects:house.admin'"
      query = [query1, query2, query3, query4] |> Enum.map(&(&1 <> ";")) |> Enum.join("\n")

      assert [
               %QueryAnalysis{
                 action: {:electric, %Electric.DDLX.Command.Enable{}},
                 table: {"public", "pants"},
                 type: nil,
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %Electric.DDLX.Command.Enable{},
                 sql: ^query1
               },
               %QueryAnalysis{
                 action: {:electric, %Electric.DDLX.Command.Enable{}},
                 table: {"public", "hats"},
                 type: nil,
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %Electric.DDLX.Command.Enable{},
                 sql: ^query2
               },
               %QueryAnalysis{
                 action: {:create, "table"},
                 table: {"public", "teeth"},
                 type: :table,
                 electrified?: false,
                 tx?: true,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: ^query3
               },
               %QueryAnalysis{
                 action: {:electric, %Electric.DDLX.Command.Grant{}},
                 table: {"public", "truths"},
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %Electric.DDLX.Command.Grant{},
                 sql: ^query4
               }
             ] = analyse(query, cxt)
    end

    test "electric.electrify(...)", cxt do
      assert [
               %QueryAnalysis{
                 action: {:electric, %Electric.DDLX.Command.Enable{}},
                 table: {"public", "pants"},
                 type: :table,
                 electrified?: true,
                 tx?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %{},
                 sql: "CALL electric.electrify('public.pants')"
               }
             ] = analyse("CALL electric.electrify('public.pants');", cxt)
    end

    test "Ecto migration version", cxt do
      assert [
               %QueryAnalysis{
                 action:
                   {:migration_version,
                    %{
                      framework: {:ecto, 1},
                      columns: %{"version" => 0, "inserted_at" => 1}
                    }},
                 table: {"public", "schema_migrations"},
                 tx?: false,
                 mode: :extended,
                 source: %M.Parse{name: "some_query_99"},
                 sql:
                   "INSERT INTO public.schema_migrations (version, inserted_at) VALUES ($1, $2)"
               }
             ] =
               analyse(
                 extended(
                   "INSERT INTO public.schema_migrations (version, inserted_at) VALUES ($1, $2)",
                   name: "some_query_99"
                 ),
                 cxt
               )
    end

    test "prisma migration version", cxt do
      assert [
               %QueryAnalysis{
                 action:
                   {:migration_version,
                    %{
                      framework: {:prisma, 1},
                      columns: %{
                        "id" => 0,
                        "checksum" => 1,
                        "logs" => 2,
                        "started_at" => 3,
                        "finished_at" => 4,
                        "migration_name" => 5
                      }
                    }},
                 table: {"public", "_prisma_migrations"},
                 tx?: false,
                 mode: :extended,
                 source: %M.Parse{name: "some_query_99"},
                 sql:
                   "INSERT INTO \"_prisma_migrations\" (\"id\",\"checksum\",\"logs\",\"started_at\",\"finished_at\",\"migration_name\") VALUES ($1,$2,$3,$4,$5,$6)"
               }
             ] =
               analyse(
                 extended(
                   "INSERT INTO \"_prisma_migrations\" (\"id\",\"checksum\",\"logs\",\"started_at\",\"finished_at\",\"migration_name\") VALUES ($1,$2,$3,$4,$5,$6)",
                   name: "some_query_99"
                 ),
                 cxt
               )
    end

    test "@migrations migration version", cxt do
      assert [
               %QueryAnalysis{
                 action:
                   {:migration_version,
                    %{
                      framework: {:atdatabases, 1},
                      columns: %{
                        "index" => 0,
                        "name" => 1,
                        "script" => 2,
                        "applied_at" => 3,
                        "ignored_error" => 4,
                        "obsolete" => 5
                      }
                    }},
                 table: {"public", "atdatabases_migrations_applied"},
                 tx?: false,
                 mode: :extended,
                 source: %M.Parse{},
                 sql:
                   "INSERT INTO \"atdatabases_migrations_applied\"\n  (\n    index, name, script,\n    applied_at, ignored_error, obsolete\n  )\nVALUES\n  (\n    $1, $2, $3,\n    $4,\n    $5,\n    $6\n  )"
               }
             ] =
               analyse(
                 extended(
                   "INSERT INTO \"atdatabases_migrations_applied\"\n  (\n    index, name, script,\n    applied_at, ignored_error, obsolete\n  )\nVALUES\n  (\n    $1, $2, $3,\n    $4,\n    $5,\n    $6\n  )"
                 ),
                 cxt
               )
    end

    test "random sql", cxt do
      assert [
               %QueryAnalysis{
                 action: :passthrough
               }
             ] =
               analyse(
                 simple("SET NAMES 'UTF-8';"),
                 cxt
               )
    end

    # TODO: how to handle invalid sql (that doesn't include electric syntax)?
    #       ideally we'd want to forward to pg so it can give proper
    #       error messages
    # test "invalid sql is just forwarded on to pg", cxt do
    #   assert [
    #            %QueryAnalysis{
    #              action: :invalid,
    #              table: nil,
    #              electrified?: false,
    #              allowed?: true,
    #              capture?: false,
    #              valid?: false,
    #              ast: nil,
    #              sql: "UPHOLD MODERN VALUES ON public.truths; SELECT * FROM mental;"
    #            }
    #          ] =
    #            analyse(
    #              "UPHOLD MODERN VALUES ON public.truths; SELECT * FROM mental;",
    #              cxt
    #            )
    # end
  end
end
