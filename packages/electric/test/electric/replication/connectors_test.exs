defmodule Electric.Replication.ConnectorsTest do
  use ExUnit.Case, async: true

  alias Electric.Replication.Connectors

  @default_origin "postgres_1"

  @default_replication_config [
    host: "host.docker.internal",
    port: 5433,
    dbname: "test"
  ]

  @default_user_config [
    origin: @default_origin,
    producer: Electric.Replication.Postgres.LogicalReplicationProducer,
    connection: [
      host: ~c"localhost",
      port: 54321,
      database: ~c"test_db_name",
      username: ~c"electric",
      password: ~c"password",
      replication: ~c"database",
      ssl: false
    ],
    replication: [electric_connection: @default_replication_config]
  ]

  describe "get_replication_opts" do
    test "produces a valid replication config from charlist values in the user config" do
      assert %{
               electric_connection: @default_replication_config,
               publication: "electric_publication",
               slot: "electric_replication_out_test_db_name",
               subscription: @default_origin
             } == Connectors.get_replication_opts(@default_user_config)
    end

    test "produces a valid replication config for some exotic DB names" do
      Enum.each(
        [
          {"x-y-z", "electric_replication_out_x_y_z"},
          {"My \"Super%%Duper||Weird\" Database",
           "electric_replication_out_my__super__duper__weird__database"}
        ],
        fn {dbname, expected_slot_name} ->
          config = put_in(@default_user_config, [:connection, :database], dbname)
          assert %{slot: ^expected_slot_name} = Connectors.get_replication_opts(config)
        end
      )
    end
  end
end
