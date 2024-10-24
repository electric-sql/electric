defmodule Electric.Client.ValueMapperTest do
  use ExUnit.Case, async: true

  alias Electric.Client
  alias Electric.Client.Message
  alias Electric.Client.ShapeDefinition

  import Support.DbSetup

  defp with_table_schema(ctx) do
    %{columns: columns} = ctx

    with_table(columns)
  end

  defp stream(ctx) do
    Client.stream(ctx.client, ctx.shape)
  end

  defp stream(ctx, limit) do
    ctx |> stream() |> Enum.take(limit)
  end

  describe "for_schema/2" do
    setup [:with_table_schema]

    setup(ctx) do
      {:ok, client} =
        Client.new(base_url: Application.fetch_env!(:electric_client, :electric_url))

      shape = ShapeDefinition.new!(ctx.tablename)

      [client: client, shape: shape]
    end

    @tag columns: [
           {"id", "uuid primary key"},
           {"i2_1", "smallint"},
           {"i2_2", "int2"},
           {"i4_1", "integer"},
           {"i4_2", "int4"},
           {"i8_1", "bigint"},
           {"i8_2", "int8"},
           {"f4_1", "real"},
           {"f4_2", "float4"},
           {"f8_1", "double precision"},
           {"f8_2", "float8"}
         ]
    test "column value mapping", ctx do
      %{tablename: table, db_conn: conn} = ctx

      id = UUID.uuid4()

      {:ok, %Postgrex.Result{num_rows: 1}} =
        Postgrex.query(
          conn,
          """
          INSERT INTO \"#{table}\" (
              id,
              i2_1,
              i2_2,
              i4_1,
              i4_2,
              i8_1,
              i8_2,
              f4_1,
              f4_2,
              f8_1,
              f8_2
          ) VALUES (
              $1,
              1,
              2,
              3,
              4,
              5,
              6,
              7,
              7.1,
              8,
              8.1
          );
          """,
          [UUID.string_to_binary!(id)]
        )

      assert [
               %Message.ChangeMessage{
                 value: %{
                   "i2_1" => 1,
                   "i2_2" => 2,
                   "i4_1" => 3,
                   "i4_2" => 4,
                   "i8_1" => 5,
                   "i8_2" => 6,
                   "f4_1" => 7.0,
                   "f4_2" => 7.1,
                   "f8_1" => 8.0,
                   "f8_2" => 8.1,
                   "id" => ^id
                 },
                 headers: %Message.Headers{
                   operation: :insert
                 },
                 offset: %Electric.Client.Offset{tx: 0, op: 0}
               },
               %Message.ControlMessage{control: :up_to_date}
             ] = stream(ctx, 2)
    end
  end
end
