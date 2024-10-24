defmodule Electric.Client.EctoAdapterTest.Config do
  @table_name "test_table_#{System.os_time(:millisecond)}"
  def table_name, do: @table_name
end

defmodule Electric.Client.EctoAdapterTest do
  use ExUnit.Case, async: true

  alias Electric.Client
  alias Electric.Client.EctoAdapter
  alias Electric.Client.Message
  import Support.DbSetup

  @table_name Electric.Client.EctoAdapterTest.Config.table_name()

  defp stream(ctx, query) do
    Client.stream(ctx.client, query)
  end

  defmodule TestTable do
    use Ecto.Schema

    @primary_key {:id, :binary_id, autogenerate: true}
    schema Electric.Client.EctoAdapterTest.Config.table_name() do
      field(:name, :string)
      field(:amount, :integer)
      field(:price, :decimal, source: :cost)
      field(:visible, :boolean, default: true)
      timestamps()
    end
  end

  defmodule NamespacedTable do
    use Ecto.Schema

    @schema_prefix "myapp"
    @primary_key {:id, :binary_id, autogenerate: true}
    schema "my_table" do
      field(:name, :string)
      field(:amount, :integer)
      field(:price, :decimal, source: :cost)
      field(:visible, :boolean, default: true)
      timestamps()
    end
  end

  setup do
    {:ok, client} =
      Client.new(base_url: Application.fetch_env!(:electric_client, :electric_url))

    [client: client]
  end

  setup do
    {:ok, _} = start_supervised(Support.Repo)

    columns = [
      {"id", "uuid primary key"},
      {"name", "varchar(255)"},
      {"amount", "int4"},
      {"cost", "numeric"},
      {"visible", "boolean default true"},
      {"inserted_at", "timestamp without time zone"},
      {"updated_at", "timestamp without time zone"}
    ]

    column_names = Enum.map(columns, &elem(&1, 0))

    with_table(@table_name, columns)
    |> Map.put(:column_names, column_names)
  end

  import Ecto.Query

  describe "shape_from_query!/1" do
    test "schema module", %{column_names: column_names} = _ctx do
      query = TestTable

      assert %Electric.Client.ShapeDefinition{
               table: @table_name,
               columns: ^column_names,
               where: nil,
               parser: {EctoAdapter, TestTable}
             } = EctoAdapter.shape_from_query!(query)
    end

    test "full table", %{column_names: column_names} = _ctx do
      query = from(t in TestTable)

      assert %Electric.Client.ShapeDefinition{
               table: @table_name,
               where: nil,
               columns: ^column_names,
               parser: {EctoAdapter, TestTable}
             } = EctoAdapter.shape_from_query!(query)
    end

    test "with where clause", %{column_names: column_names} = _ctx do
      query = from(t in TestTable, where: t.price < 2.0 and t.amount > 3, select: t)

      assert %Electric.Client.ShapeDefinition{
               table: @table_name,
               where: ~s[(("cost" < 2.0) AND ("amount" > 3))],
               columns: ^column_names,
               parser: {EctoAdapter, TestTable}
             } = EctoAdapter.shape_from_query!(query)
    end

    test "JOIN queries return an error" do
      query =
        from(t in TestTable,
          where: t.price < 2.0 and t.amount > 3,
          select: t,
          join: t2 in TestTable,
          on: t2.id == t.id
        )

      assert_raise(ArgumentError, fn ->
        EctoAdapter.shape_from_query!(query)
      end)
    end

    test "table namespaces", %{column_names: column_names} = _ctx do
      assert %Electric.Client.ShapeDefinition{
               namespace: "myapp",
               table: "my_table",
               where: nil,
               columns: ^column_names,
               parser: {EctoAdapter, NamespacedTable}
             } = EctoAdapter.shape_from_query!(NamespacedTable)
    end
  end

  describe "ValueMapper.for_schema/2" do
    test "returns a function that casts values correctly" do
      mapper_fun = EctoAdapter.for_schema(%{}, TestTable)

      assert mapper_fun.(%{
               "id" => "ecceb448-64ed-4279-9aea-795d2ae70153",
               "name" => "my name",
               "amount" => "123",
               "cost" => "7.99",
               "visible" => "true",
               "inserted_at" => "2016-03-24 17:53:17+00",
               "updated_at" => "2017-04-28 18:54:18+00"
             }) == %TestTable{
               amount: 123,
               id: "ecceb448-64ed-4279-9aea-795d2ae70153",
               inserted_at: ~N[2016-03-24 17:53:17],
               name: "my name",
               visible: true,
               price: Decimal.new("7.99"),
               updated_at: ~N[2017-04-28 18:54:18]
             }
    end
  end

  describe "Client.stream/2" do
    test "maps db changes to structs", ctx do
      parent = self()

      query = from(t in TestTable)
      stream = stream(ctx, query)

      {:ok, _task} =
        start_supervised(
          {Task,
           fn ->
             stream
             |> Stream.each(&send(parent, {:stream, &1}))
             |> Stream.run()
           end}
        )

      price1 = Decimal.new("7.99")

      value1 = %TestTable{
        id: "ecceb448-64ed-4279-9aea-795d2ae70153",
        amount: 123,
        name: "my name",
        visible: true,
        price: price1
      }

      price2 = Decimal.new("129.99")

      value2 = %TestTable{
        id: "1c493c89-ce0e-4816-a9e0-8704f21d2d09",
        amount: 387,
        name: "precious thing",
        visible: false,
        price: price2
      }

      Support.Repo.insert(value1)
      Support.Repo.insert(value2)

      assert_receive {:stream, %Message.ControlMessage{control: :up_to_date}}, 500
      assert_receive {:stream, %Message.ChangeMessage{} = message}, 500

      assert %TestTable{
               id: "ecceb448-64ed-4279-9aea-795d2ae70153",
               amount: 123,
               name: "my name",
               visible: true,
               price: ^price1,
               inserted_at: %NaiveDateTime{},
               updated_at: %NaiveDateTime{}
             } = message.value

      assert_receive {:stream, %Message.ChangeMessage{} = message}, 500

      assert %TestTable{
               id: "1c493c89-ce0e-4816-a9e0-8704f21d2d09",
               amount: 387,
               name: "precious thing",
               visible: false,
               price: ^price2,
               inserted_at: %NaiveDateTime{},
               updated_at: %NaiveDateTime{}
             } = message.value
    end
  end

  test "{'t', 'f'} booleans are mapped" do
    mapper = EctoAdapter.for_schema(%{}, TestTable)

    assert %TestTable{visible: true} = mapper.(%{"visible" => "t"})
    assert %TestTable{visible: true} = mapper.(%{"visible" => "true"})
    assert %TestTable{visible: false} = mapper.(%{"visible" => "f"})
    assert %TestTable{visible: false} = mapper.(%{"visible" => "false"})
  end
end
