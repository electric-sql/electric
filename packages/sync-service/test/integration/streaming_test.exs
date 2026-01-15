defmodule Electric.Integration.StreamingTest do
  @moduledoc """
  Integration tests that spin up an Electric HTTP API + stack for a unique test DB,
  then use Electric.Client to stream a shape over HTTP.
  """
  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.DbStructureSetup
  import Support.IntegrationSetup
  import Support.StreamConsumer

  alias Electric.Client

  @moduletag :tmp_dir

  describe "Electric.Client streaming over HTTP" do
    setup [:with_unique_db, :with_basic_tables, :with_sql_execute]
    setup :with_complete_stack

    setup :with_electric_client

    @tag with_sql: [
           "INSERT INTO items VALUES ('00000000-0000-0000-0000-000000000001', 'initial value')"
         ]
    test "initial snapshot contains pre-existing row", %{client: client} do
      stream = Client.stream(client, "items", live: false)

      with_consumer stream do
        assert_insert(consumer, %{
          "id" => "00000000-0000-0000-0000-000000000001",
          "value" => "initial value"
        })

        assert_up_to_date(consumer)
      end
    end

    @tag with_sql: [
           "INSERT INTO items VALUES ('00000000-0000-0000-0000-000000000001', 'initial value')"
         ]
    test "receives live changes after initial snapshot", %{client: client, db_conn: db_conn} do
      stream = Client.stream(client, "items", live: true)

      with_consumer stream do
        assert_insert(consumer, %{"value" => "initial value"})
        assert_up_to_date(consumer)

        Postgrex.query!(
          db_conn,
          "INSERT INTO items VALUES ('00000000-0000-0000-0000-000000000002', 'new value')",
          []
        )

        assert_insert(consumer, %{
          "id" => "00000000-0000-0000-0000-000000000002",
          "value" => "new value"
        })
      end
    end

    test "streaming empty table returns up-to-date", %{client: client} do
      stream = Client.stream(client, "items", live: false)

      with_consumer stream do
        assert_up_to_date(consumer)
      end
    end
  end
end
