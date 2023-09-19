defmodule Electric.Postgres.Proxy.ParserTest do
  use ExUnit.Case, async: true
  use ExUnitProperties

  alias Electric.Postgres.Proxy.Parser
  alias Electric.Postgres.MockSchemaLoader
  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.SQLGenerator

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
      assert {:error, "Not an INSERT statement" <> _} = Parser.column_map("DELETE FROM fish")
    end
  end

  describe "analyse/2" do
    alias Electric.Postgres.Proxy.QueryAnalysis

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

      {:ok, loader: loader}
    end

    test "BEGIN; COMMIT", cxt do
      assert [
               %QueryAnalysis{
                 action: :begin,
                 table: nil,
                 electrified?: false,
                 allowed?: true,
                 sql: "BEGIN",
                 ast: %{}
               },
               %QueryAnalysis{
                 action: :commit,
                 table: nil,
                 electrified?: false,
                 allowed?: true,
                 sql: "COMMIT",
                 ast: %{}
               }
             ] = Parser.analyse("BEGIN; COMMIT;", loader: cxt.loader)
    end

    test "CREATE TABLE", cxt do
      assert [
               %QueryAnalysis{
                 action: {:create, "table"},
                 table: {"public", "balloons"},
                 electrified?: false,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: "CREATE TABLE public.balloons (id uuid PRIMARY KEY, value text)"
               }
             ] =
               Parser.analyse(
                 "CREATE TABLE public.balloons (id uuid PRIMARY KEY, value text);",
                 loader: cxt.loader
               )
    end

    test "ALTER TABLE .. ADD COLUMN", cxt do
      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "truths"},
                 electrified?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %{},
                 sql: "ALTER TABLE public.truths ADD COLUMN clowns text"
               }
             ] =
               Parser.analyse("ALTER TABLE public.truths ADD COLUMN clowns text;",
                 loader: cxt.loader
               )

      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "truths"},
                 electrified?: true,
                 allowed?: false,
                 ast: %{},
                 sql: "ALTER TABLE public.truths ADD COLUMN ip cidr",
                 errors: [invalid_column_type: "cidr"]
               }
             ] =
               Parser.analyse("ALTER TABLE public.truths ADD COLUMN ip cidr;", loader: cxt.loader)

      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "truths"},
                 electrified?: true,
                 allowed?: false,
                 capture?: true,
                 ast: %{},
                 sql: "ALTER TABLE public.truths ADD COLUMN clowns text, ADD COLUMN ip cidr",
                 errors: [invalid_column_type: "cidr"]
               }
             ] =
               Parser.analyse(
                 "ALTER TABLE public.truths ADD COLUMN clowns text, ADD COLUMN ip cidr;",
                 loader: cxt.loader
               )

      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "socks"},
                 electrified?: false,
                 allowed?: true,
                 ast: %{},
                 sql: "ALTER TABLE public.socks ADD COLUMN ip cidr",
                 errors: []
               }
             ] =
               Parser.analyse("ALTER TABLE public.socks ADD COLUMN ip cidr;", loader: cxt.loader)
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
                 errors: [drop_column: "value"]
               }
             ] =
               Parser.analyse("ALTER TABLE public.truths DROP COLUMN value;", loader: cxt.loader)

      assert [
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "socks"},
                 electrified?: false,
                 allowed?: true,
                 ast: %{},
                 sql: "ALTER TABLE public.socks DROP COLUMN value, DROP COLUMN something",
                 errors: []
               }
             ] =
               Parser.analyse(
                 "ALTER TABLE public.socks DROP COLUMN value, DROP COLUMN something;",
                 loader: cxt.loader
               )
    end

    test "ALTER TABLE .. RENAME COLUMN", cxt do
      assert [
               %QueryAnalysis{
                 action: {:rename, "column"},
                 table: {"public", "truths"},
                 electrified?: true,
                 allowed?: false,
                 ast: %{},
                 sql: "ALTER TABLE public.truths RENAME COLUMN value TO colour",
                 errors: [rename: "value"]
               },
               %QueryAnalysis{
                 action: {:rename, "column"},
                 table: {"public", "socks"},
                 electrified?: false,
                 allowed?: true,
                 ast: %{},
                 sql: "ALTER TABLE public.socks RENAME COLUMN value TO colour",
                 errors: []
               }
             ] =
               Parser.analyse(
                 "ALTER TABLE public.truths RENAME COLUMN value TO colour;ALTER TABLE public.socks RENAME COLUMN value TO colour;",
                 loader: cxt.loader
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
                 errors: [alter_column: "value"]
               },
               %QueryAnalysis{
                 action: {:alter, "table"},
                 table: {"public", "socks"},
                 electrified?: false,
                 allowed?: true,
                 ast: %{},
                 sql: "ALTER TABLE public.socks ALTER COLUMN value TYPE int2",
                 errors: []
               }
             ] =
               Parser.analyse(
                 "ALTER TABLE public.truths ALTER COLUMN value TYPE int2; ALTER TABLE public.socks ALTER COLUMN value TYPE int2;",
                 loader: cxt.loader
               )
    end

    # just spam the analyser with all combinations of `ALTER TABLE` without
    # testing the "allowability", but just to make sure it doesn't crash
    property "ALTER TABLE... (electrified)", cxt do
      check all(sql <- SQLGenerator.Table.alter_table(namespace: "public", table_name: "truths")) do
        assert [%QueryAnalysis{electrified?: true, sql: ^sql}] =
                 Parser.analyse(sql, loader: cxt.loader)
      end
    end

    property "ALTER TABLE... (non-electrified)", cxt do
      check all(sql <- SQLGenerator.Table.alter_table(namespace: "public", table_name: "socks")) do
        assert [%QueryAnalysis{electrified?: false, allowed?: true, capture?: false}] =
                 Parser.analyse(sql, loader: cxt.loader)
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
                 errors: []
               },
               %QueryAnalysis{
                 action: {:create, "index"},
                 table: {"public", "socks"},
                 electrified?: false,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: "CREATE INDEX public_socks_idx ON public.socks (value)",
                 errors: []
               }
             ] =
               Parser.analyse(
                 "CREATE INDEX public_truths_idx ON public.truths USING gist (value);\nCREATE INDEX public_socks_idx ON public.socks (value);",
                 loader: cxt.loader
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
                 errors: []
               },
               %QueryAnalysis{
                 action: {:drop, "index"},
                 table: {"public", "some_other_idx"},
                 electrified?: false,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: "DROP INDEX some_other_idx",
                 errors: []
               }
             ] =
               Parser.analyse(
                 "DROP INDEX truths_idx;\nDROP INDEX some_other_idx;",
                 loader: cxt.loader
               )
    end

    test "DROP TABLE...", cxt do
      assert [
               %QueryAnalysis{
                 action: {:drop, "table"},
                 table: {"public", "truths"},
                 electrified?: true,
                 allowed?: false,
                 capture?: false,
                 ast: %{},
                 sql: "DROP TABLE public.truths",
                 errors: []
               },
               %QueryAnalysis{
                 action: {:drop, "table"},
                 table: {"public", "socks"},
                 electrified?: false,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: "DROP TABLE public.socks",
                 errors: []
               }
             ] =
               Parser.analyse(
                 "DROP TABLE public.truths; DROP TABLE public.socks;",
                 loader: cxt.loader
               )
    end

    test "INSERT ...", cxt do
      assert [
               %QueryAnalysis{
                 action: :insert,
                 table: {"public", "schema_migrations"},
                 electrified?: false,
                 allowed?: true,
                 # leave determination of the capture to somewhere later in the process that uses more context (?)
                 capture?: false,
                 ast: %{},
                 sql:
                   "INSERT INTO public.schema_migrations (version, inserted_at) VALUES ($1, $2)",
                 errors: []
               }
             ] =
               Parser.analyse(
                 "INSERT INTO public.schema_migrations (version, inserted_at) VALUES ($1, $2);",
                 loader: cxt.loader
               )
    end

    test "DELETE ...", cxt do
      assert [
               %QueryAnalysis{
                 action: :delete,
                 table: {"public", "schema_migrations"},
                 electrified?: false,
                 allowed?: true,
                 # leave determination of the capture to somewhere later in the process that uses more context (?)
                 capture?: false,
                 ast: %{},
                 sql: "DELETE FROM public.schema_migrations",
                 errors: []
               },
               %QueryAnalysis{
                 action: :delete,
                 table: {"public", "truths"},
                 electrified?: true,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: "DELETE FROM public.truths",
                 errors: []
               }
             ] =
               Parser.analyse(
                 "DELETE FROM public.schema_migrations; DELETE FROM public.truths ;",
                 loader: cxt.loader
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
             ] = Parser.analyse(query, loader: cxt.loader)
    end

    test "DO .. END", cxt do
      # these queries come in as a `DoStmt` with a string node containing the query between the `$$`
      # and unless the language is `SQL` we can't parse it... so just reject it
      # 
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

      assert [
               %QueryAnalysis{
                 action: :do,
                 table: nil,
                 electrified?: false,
                 allowed?: false,
                 capture?: false,
                 ast: %{},
                 sql: ^query,
                 errors: [unsupported_query: "DO ... END"]
               }
             ] = Parser.analyse(query <> ";\n", loader: cxt.loader)
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
               Parser.analyse("ALTER TABLE truths ENABLE ELECTRIC;", loader: cxt.loader)

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
               Parser.analyse(
                 ~s[ELECTRIC REVOKE UPDATE (status, name) ON truths FROM 'projects:house.admin';],
                 loader: cxt.loader
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
             ] = Parser.analyse(query, loader: cxt.loader)
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
                 electrified?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %Electric.DDLX.Command.Enable{},
                 sql: ^query1
               },
               %QueryAnalysis{
                 action: {:electric, %Electric.DDLX.Command.Enable{}},
                 table: {"public", "hats"},
                 electrified?: true,
                 allowed?: true,
                 capture?: true,
                 ast: %Electric.DDLX.Command.Enable{},
                 sql: ^query2
               },
               %QueryAnalysis{
                 action: {:create, "table"},
                 table: {"public", "teeth"},
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
             ] = Parser.analyse(query, loader: cxt.loader)
    end

    test "electric.electrify(...)", cxt do
      assert [
               %QueryAnalysis{
                 action: :call,
                 table: {"public", "pants"},
                 electrified?: true,
                 allowed?: true,
                 capture?: false,
                 ast: %{},
                 sql: "CALL electric.electrify('public.pants')"
               }
             ] = Parser.analyse("CALL electric.electrify('public.pants');", loader: cxt.loader)
    end

    test "invalid sql is just forwarded on to pg", cxt do
      assert [
               %QueryAnalysis{
                 action: :invalid,
                 table: nil,
                 electrified?: false,
                 allowed?: true,
                 capture?: false,
                 valid?: false,
                 ast: nil,
                 sql: "UPHOLD MODERN VALUES ON public.truths; SELECT * FROM mental;"
               }
             ] =
               Parser.analyse("UPHOLD MODERN VALUES ON public.truths; SELECT * FROM mental;",
                 loader: cxt.loader
               )
    end
  end
end
