defmodule Electric.Client.EctoAdapterTest.Config do
  @table_name "test_table_#{System.os_time(:millisecond)}"
  def table_name, do: @table_name
end

defmodule Electric.Client.EctoAdapterTest do
  use ExUnit.Case, async: true

  alias Electric.Client.ShapeDefinition
  alias Electric.Client
  alias Electric.Client.EctoAdapter
  alias Electric.Client.Message
  alias Support.Money
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
      field(:net_price, Money)
      field(:visible, :boolean, default: true)
      timestamps()
    end

    def changeset(data \\ %__MODULE__{}, params) do
      Ecto.Changeset.cast(data, params, [:name, :amount, :price])
      |> Ecto.Changeset.validate_required([:name, :amount, :price])
      |> Ecto.Changeset.validate_number(:price, greater_than_or_equal_to: 10)
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
      field(:net_price, Money)
      field(:visible, :boolean, default: true)
      field(:virtual, :string, virtual: true)
      timestamps()
    end
  end

  defmodule Weather do
    use Ecto.Schema
    import Ecto.Changeset

    schema "weather" do
      field(:city, :string)
      field(:temp_lo, :integer)
      field(:temp_hi, :integer)
      field(:prcp, :float, default: 0.0)

      has_many(:history, History)

      embeds_one :meta, Meta do
        field(:type, Ecto.Enum, values: [:foo, :bar, :baz])
      end
    end

    def changeset(weather \\ %__MODULE__{}, data) do
      weather
      |> cast(data, [:city, :temp_lo, :temp_hi, :prcp])
      |> validate_required([:city, :temp_lo, :temp_hi])
      |> validate_number(:prcp, greater_than_or_equal_to: 0)
      # meta only appears in the shape if required: true
      |> cast_embed(:meta, required: true)
      |> cast_assoc(:history)
    end
  end

  defmodule History do
    use Ecto.Schema
    import Ecto.Changeset

    schema "history" do
      field(:date, :date)
      field(:temp_lo, :integer)
      field(:temp_hi, :integer)
      field(:prcp, :float, default: 0.0)

      belongs_to(:weather, Weather)
    end

    def changeset(history \\ %__MODULE__{}, data) do
      history
      |> cast(data, [:date, :temp_lo, :temp_hi, :prcp])
      |> validate_required([:date, :temp_lo, :temp_hi])
      |> validate_number(:prcp, greater_than_or_equal_to: 0)
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
      {"net_price", "int8"},
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
      price1 = Decimal.new("2.0")
      net_price1 = Decimal.new("2.5")

      query =
        from(t in TestTable,
          where: t.price < ^price1 and t.net_price < ^net_price1 and t.amount > 3,
          select: t
        )

      assert %Electric.Client.ShapeDefinition{
               table: @table_name,
               where: ~s[((("cost" < 2.0) AND ("net_price" < 2500000)) AND ("amount" > 3))],
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

    test "prefixed queries", %{column_names: column_names} = _ctx do
      assert %Electric.Client.ShapeDefinition{
               namespace: "hamster",
               table: @table_name,
               where: nil,
               columns: ^column_names,
               parser: {EctoAdapter, TestTable}
             } = EctoAdapter.shape_from_query!(Ecto.Query.put_query_prefix(TestTable, "hamster"))
    end

    test "uses changeset information to define table + columns", _ctx do
      assert %Electric.Client.ShapeDefinition{} =
               shape = EctoAdapter.shape_from_changeset!(&TestTable.changeset/1)

      assert Enum.sort(shape.columns) == ~w[amount cost id name]
      assert shape.table == @table_name
    end

    test "allows custom namespace", _ctx do
      assert %Electric.Client.ShapeDefinition{} =
               shape =
               EctoAdapter.shape_from_changeset!(&TestTable.changeset/1, namespace: "unsettling")

      assert shape.namespace == "unsettling"
    end

    test "allows for custom where clause with params and parser", _ctx do
      assert %Electric.Client.ShapeDefinition{} =
               shape =
               EctoAdapter.shape_from_changeset!(&TestTable.changeset/1,
                 where: "name = $1",
                 params: ["a name"],
                 parser: {__MODULE__, []}
               )

      assert Enum.sort(shape.columns) == ~w[amount cost id name]

      assert %ShapeDefinition{
               where: "name = $1",
               params: ["a name"],
               parser: {__MODULE__, []}
             } = shape
    end

    test "allows passing a custom changeset/1 function", _ctx do
      changeset_fun =
        fn params ->
          Ecto.Changeset.cast(
            %TestTable{},
            params,
            [:name, :price]
          )
          |> Ecto.Changeset.validate_required([:name])
          |> Ecto.Changeset.validate_number(:price, greater_than_or_equal_to: 10)
        end

      assert %Electric.Client.ShapeDefinition{} =
               shape = EctoAdapter.shape_from_changeset!(changeset_fun)

      assert Enum.sort(shape.columns) == ~w[cost id name]
      assert shape.table == @table_name
    end

    test "allows passing a changeset", _ctx do
      changeset =
        %TestTable{}
        |> Ecto.Changeset.cast(%{}, [:name, :price])
        |> Ecto.Changeset.validate_required([:name])
        |> Ecto.Changeset.validate_number(:price, greater_than_or_equal_to: 10)

      assert %Electric.Client.ShapeDefinition{} =
               shape = EctoAdapter.shape_from_changeset!(changeset)

      assert Enum.sort(shape.columns) == ~w[cost id name]
      assert shape.table == @table_name
    end

    test "supports complex changesets", _ctx do
      assert %Electric.Client.ShapeDefinition{} =
               shape = EctoAdapter.shape_from_changeset!(&Weather.changeset/1)

      assert Enum.sort(shape.columns) ==
               Enum.sort(["id", "city", "temp_lo", "temp_hi", "prcp", "meta"])
    end

    defmodule User do
      defstruct [:name, :email, :age]
    end

    # no point supporting schemaless changesets - you might as well just
    # call ShapeDefinition.new/2
    test "raises if given a schemaless changeset", _ctx do
      changeset =
        {%User{}, %{name: :string, email: :string, age: :integer}}
        |> Ecto.Changeset.cast(%{}, [:name, :email, :age])
        |> Ecto.Changeset.validate_required([:name, :email, :age])
        |> Ecto.Changeset.validate_number(:age, greater_than: 0)

      assert_raise ArgumentError, fn ->
        EctoAdapter.shape_from_changeset!(changeset)
      end
    end

    test "derives correct namespace from changeset + schema", _ctx do
      changeset_fun =
        fn params ->
          Ecto.Changeset.cast(
            %NamespacedTable{},
            params,
            [:name, :amount, :price, :visible]
          )
          |> Ecto.Changeset.validate_required([:name, :amount, :price, :visible])
          |> Ecto.Changeset.validate_number(:price, greater_than_or_equal_to: 10)
        end

      assert %Electric.Client.ShapeDefinition{} =
               shape =
               EctoAdapter.shape_from_changeset!(changeset_fun)

      assert Enum.sort(shape.columns) == ~w[amount cost id name visible]
      assert shape.table == "my_table"
      assert shape.namespace == "myapp"
    end

    test "ignores virtual fields", _ctx do
      changeset_fun =
        fn params ->
          Ecto.Changeset.cast(
            %NamespacedTable{},
            params,
            [:name, :amount, :price, :virtual]
          )
          |> Ecto.Changeset.validate_required([:name, :amount, :price])
          |> Ecto.Changeset.validate_number(:price, greater_than_or_equal_to: 10)
        end

      assert %Electric.Client.ShapeDefinition{} =
               shape =
               EctoAdapter.shape_from_changeset!(changeset_fun)

      assert Enum.sort(shape.columns) == ~w[amount cost id name]
      assert shape.table == "my_table"
      assert shape.namespace == "myapp"
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
               "net_price" => "8990000",
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
               net_price: Decimal.new("8.99"),
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
      net_price1 = Decimal.new("8.99")

      value1 = %TestTable{
        id: "ecceb448-64ed-4279-9aea-795d2ae70153",
        amount: 123,
        name: "my name",
        visible: true,
        price: price1,
        net_price: net_price1
      }

      price2 = Decimal.new("129.99")
      net_price2 = Decimal.new("130.99")

      value2 = %TestTable{
        id: "1c493c89-ce0e-4816-a9e0-8704f21d2d09",
        amount: 387,
        name: "precious thing",
        visible: false,
        price: price2,
        net_price: net_price2
      }

      Support.Repo.insert(value1)
      Support.Repo.insert(value2)

      assert_receive {:stream, %Message.ControlMessage{control: :up_to_date}}, 5000
      assert_receive {:stream, %Message.ChangeMessage{} = message}, 5000

      assert %TestTable{
               id: "ecceb448-64ed-4279-9aea-795d2ae70153",
               amount: 123,
               name: "my name",
               visible: true,
               price: ^price1,
               net_price: ^net_price1,
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
               net_price: ^net_price2,
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
