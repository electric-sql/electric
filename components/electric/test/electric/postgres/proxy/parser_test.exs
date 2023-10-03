defmodule Electric.Postgres.Proxy.ParserTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Electric.Postgres.Proxy.{Injector.State, Parser}
  alias Electric.Postgres.MockSchemaLoader
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.SQLGenerator
  alias PgProtocol.Message, as: M

  @whitespace [" ", "\n", "\t"]
  describe "tag matching" do
    def all_case(keyword) do
      keyword
      |> String.graphemes()
      |> Enum.map(fn char -> [String.downcase(char), String.upcase(char)] end)
      |> case_chars()
      |> Enum.shuffle()
      |> then(fn words ->
        if length(words) > 8 do
          Enum.take(words, 8)
        else
          words
        end
      end)
    end

    defp case_chars([]), do: [""]

    defp case_chars([[_, _] = char | rest]) do
      for c <- char, r <- case_chars(rest), do: c <> r
    end

    def test_action(cmd, action) do
      for t <- all_case("table"), s <- [" ", "\n", "\t"] do
        cmd = Enum.join([cmd, " ", t, s, "name"])

        case action do
          :create ->
            refute Parser.capture?(cmd)

          a ->
            assert {true, {^a, "table"}} = Parser.capture?(cmd)
        end
      end

      for i <- all_case("index"), s <- @whitespace do
        cmd = Enum.join([cmd, " ", i, s, "name"])

        case action do
          :alter ->
            assert false == Parser.capture?(cmd)

          _ ->
            assert {true, {^action, "index"}} = Parser.capture?(cmd)
        end
      end
    end

    test "all_case/1" do
      assert all_case("do") |> Enum.sort() == Enum.sort(["do", "dO", "Do", "DO"])
    end

    test "CREATE ..." do
      for c <- all_case("create") do
        test_action(c, :create)
      end
    end

    test "ALTER ..." do
      for c <- all_case("alter") do
        test_action(c, :alter)
      end
    end

    test "DROP ..." do
      for c <- all_case("drop") do
        test_action(c, :drop)
      end
    end

    test "BEGIN" do
      for c <- all_case("begin") do
        assert {true, :begin} = Parser.capture?(c)
      end
    end

    test "COMMIT" do
      for c <- all_case("commit") do
        assert {true, :commit} = Parser.capture?(c)
      end
    end
  end

  describe "DDLX statements" do
    alias Electric.DDLX.Command

    test "ELECTRIC GRANT" do
      for e <- all_case("electric"),
          s1 <- @whitespace,
          g <- all_case("grant") do
        assert {true, {:electric, [%Command.Grant{}]}} =
                 Parser.capture?(IO.iodata_to_binary([e, s1, g, " UPDATE ON table TO 'someone'"]))
      end
    end

    test "ELECTRIC REVOKE" do
      for e <- all_case("electric"),
          s1 <- @whitespace,
          g <- all_case("revoke") do
        assert {true, {:electric, [%Command.Revoke{}]}} =
                 Parser.capture?(
                   IO.iodata_to_binary([e, s1, g, " UPDATE ON table FROM 'someone'"])
                 )
      end
    end

    test "ELECTRIC INVALID" do
      for e <- all_case("electric"),
          s1 <- @whitespace,
          g <- all_case("revoke") do
        assert {true, {:electric, %Command.Error{}}} =
                 Parser.capture?(IO.iodata_to_binary([e, s1, g, " JUNK ON table TO 'someone'"]))
      end
    end
  end

  describe "table_name/1" do
    test "ALTER TABLE" do
      assert {:table, {"public", "fish"}} =
               Parser.table_name("ALTER TABLE fish ADD COLUMN door int8")

      assert {:table, {"other", "fish"}} =
               Parser.table_name("ALTER TABLE other.fish ADD COLUMN door int8")

      assert {:table, {"other", "fish"}} =
               Parser.table_name("ALTER TABLE fish ADD COLUMN door int8", default_schema: "other")

      assert {:table, {"some other", "flying fish"}} =
               Parser.table_name(~s[ALTER TABLE "some other"."flying fish" ADD COLUMN door int8],
                 default_schema: "other"
               )

      assert {:table, {"other", "flying fish"}} =
               Parser.table_name(~s[ALTER TABLE "flying fish" ADD COLUMN door int8],
                 default_schema: "other"
               )
    end

    test "INSERT" do
      assert {:table, {"public", "fish"}} =
               Parser.table_name("INSERT INTO fish (id, value) VALUES ('1', 'content')")

      assert {:table, {"other", "fish"}} =
               Parser.table_name("INSERT INTO other.fish (id, value) VALUES ('1', 'content')")

      assert {:table, {"other", "fish"}} =
               Parser.table_name("INSERT INTO fish (id, value) VALUES ('1', 'content')",
                 default_schema: "other"
               )
    end

    test "CALL electric.electrify(..)" do
      assert {:table, {"public", "fish"}} =
               Parser.table_name("CALL electric.electrify('public.fish')")

      assert {:table, {"public", "fish"}} =
               Parser.table_name("CALL electric.electrify('fish')")

      assert {:table, {"other", "fish"}} =
               Parser.table_name("CALL electric.electrify('other.fish')")

      assert {:table, {"other", "fish"}} =
               Parser.table_name("CALL electric.electrify('other', 'fish')")
    end
  end

  describe "column_map/1" do
    test "INSERT" do
      assert {:ok, %{"id" => 0, "value" => 1, "tree" => 2}} =
               Parser.column_map(
                 "INSERT INTO fish (id, value, tree) VALUES ('1', 'content', 'leaf')"
               )
    end

    test "DELETE" do
      assert {:error, "Not an INSERT statement" <> _} =
               Parser.column_map("DELETE FROM fish")
    end
  end

  def simple(sql), do: %M.Query{query: sql}
  def extended(sql, attrs \\ []), do: struct(M.Parse, Keyword.put(attrs, :query, sql))

  describe "parse/1" do
    test "pg-syntax" do
      assert {:ok,
              [
                {%M.Query{query: "ALTER TABLE monkey ADD tail int2 NOT NULL"},
                 %PgQuery.AlterTableStmt{}}
              ]} =
               Parser.parse(simple("ALTER TABLE monkey ADD tail int2 NOT NULL;"))

      assert {:ok,
              [
                {%M.Query{query: "ALTER TABLE monkey ADD tail int2 NOT NULL"},
                 %PgQuery.AlterTableStmt{}}
              ]} =
               Parser.parse(simple("ALTER TABLE monkey ADD tail int2 NOT NULL"))

      assert {:ok,
              [
                {%M.Parse{query: "ALTER TABLE monkey ADD tail int2 NOT NULL;"},
                 %PgQuery.AlterTableStmt{}}
              ]} =
               Parser.parse(extended("ALTER TABLE monkey ADD tail int2 NOT NULL;"))
    end

    test "pg-syntax, no trailing semicolon" do
      assert {:ok,
              [
                {%M.Query{query: "ALTER TABLE monkey ADD tail int2 NOT NULL"},
                 %PgQuery.AlterTableStmt{}},
                {%M.Query{query: "ALTER TABLE giraffe ADD neck int2"}, %PgQuery.AlterTableStmt{}}
              ]} =
               Parser.parse(
                 simple(
                   "ALTER TABLE monkey ADD tail int2 NOT NULL; ALTER TABLE giraffe ADD neck int2"
                 )
               )
    end

    test "electric-syntax" do
      assert {:ok, [{%M.Query{query: "CALL electric.__smuggle__" <> _}, %PgQuery.CallStmt{}}]} =
               Parser.parse(simple("ALTER TABLE monkey ENABLE ELECTRIC;"))

      assert {:ok,
              [
                {%M.Query{query: "CALL electric.__smuggle__" <> _}, %PgQuery.CallStmt{}}
              ]} =
               Parser.parse(
                 simple(
                   "ELECTRIC REVOKE UPDATE (status, name) ON truths FROM 'projects:house.admin'"
                 )
               )
    end

    test "mix of pg- and electric-syntax" do
      assert {:ok,
              [
                {%M.Query{query: "BEGIN"}, %PgQuery.TransactionStmt{}},
                {%M.Query{query: "CALL electric.__smuggle__" <> _}, %PgQuery.CallStmt{}},
                {%M.Query{query: "CALL electric.__smuggle__" <> _}, %PgQuery.CallStmt{}},
                {%M.Query{query: "COMMIT"}, %PgQuery.TransactionStmt{}}
              ]} =
               Parser.parse(
                 simple("""
                  BEGIN;
                  ALTER TABLE monkey ENABLE ELECTRIC;
                  ELECTRIC REVOKE UPDATE (status, name) ON truths FROM 'projects:house.admin';
                  COMMIT;
                 """)
               )
    end

    test "DO .. END" do
      # these queries come in as a `DoStmt` with a string node containing the query between the `$$`
      # and unless the language is `SQL` we can't parse it... so just reject it
      query =
        String.trim("""
        DO $$ 
        DECLARE 
          schema_exists BOOLEAN;
        BEGIN
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.schemata
            WHERE schema_name = 'electric'
          ) INTO schema_exists;

          IF schema_exists THEN
            CALL electric.electrify('public."Items"');
          END IF;
        END $$
        """)

      assert {:error, _} = Parser.parse(simple(query))
    end

    test "invalid pg-syntax" do
      assert {:error, _} = Parser.parse(simple("WHAT EXACTLY SHOULD THIS DO?"))
    end

    test "invalid electric-syntax" do
      assert {:error, _} =
               Parser.parse(
                 simple(
                   "ELECTRIC REVOKE CRISPS (status, name) ON truths FROM 'projects:house.admin';"
                 )
               )
    end

    test "invalid mix" do
      assert {:error, _} =
               Parser.parse(
                 simple("""
                  BEGIN;
                  ALTER TABLE monkey ENABLE ELECTRIC;
                  ELECTRIC REVOKE CRISPS (status, name) ON truths FROM 'projects:house.admin';
                  COMMIT;
                 """)
               )
    end
  end

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

    test "INSERT ...", cxt do
      assert [
               %QueryAnalysis{
                 action: :insert,
                 table: {"public", "data"},
                 electrified?: false,
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
                 allowed?: true,
                 capture?: true,
                 ast: %{},
                 sql: ^query1
               },
               %QueryAnalysis{
                 action: {:create, "index"},
                 table: {"public", "truths"},
                 electrified?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %{},
                 sql: ^query2
               },
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "socks"},
                 electrified?: false,
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
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: ^query1
               },
               %QueryAnalysis{
                 action: {:electric, %Electric.DDLX.Command.Enable{}},
                 table: {"public", "pants"},
                 electrified?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %Electric.DDLX.Command.Enable{},
                 sql: ^query2
               },
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "truths"},
                 electrified?: true,
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
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: ^query3
               },
               %QueryAnalysis{
                 action: {:electric, %Electric.DDLX.Command.Grant{}},
                 table: {"public", "truths"},
                 electrified?: true,
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

  describe "find_semicolon/2" do
    test "no semicolons in string" do
      s = "ELECTRIC GRANT JUNK ON \"thing.Köln_en$ts\" TO 'projects:house.admin'"
      assert Parser.find_semicolon(s, :forward) - byte_size(s) == 0
      assert Parser.find_semicolon(s, :reverse) - byte_size(s) == 0
    end

    test "semicolon in middle" do
      a = "ELECTRIC GRANT JUNK"
      b = " ON \"t;hing.Köln_en$ts\" TO 'projects;house.admin'"
      s = a <> ";" <> b
      f = Parser.find_semicolon(s, :forward)
      assert binary_part(s, f, 1) == ";"
      assert Parser.find_semicolon(s, :forward) == byte_size(a)

      f = Parser.find_semicolon(s, :reverse)
      assert binary_part(String.reverse(s), f, 1) == ";"
      assert Parser.find_semicolon(s, :reverse) == byte_size(b)
    end

    test "real world" do
      a =
        "CREATE TABLE something (id uuid PRIMARY KEY, value text);\nALTER TABLE something ENABLE "

      b =
        "ELECTRIC;\nCREATE TABLE ignoreme (id uuid PRIMARY KEY);\nALTER TABLE something ADD amount int4 DEFAULT 0, ADD colour varchar;\n"

      f = Parser.find_semicolon(b, :forward)
      assert binary_part(b, f, 1) == ";"

      f = Parser.find_semicolon(a, :reverse)
      assert binary_part(String.reverse(a), f, 1) == ";"
    end
  end
end
