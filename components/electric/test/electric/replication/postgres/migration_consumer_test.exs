defmodule Electric.Replication.Postgres.MigrationConsumerTest do
  use ExUnit.Case, async: true
  use Electric.Postgres.MockSchemaLoader

  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.Migration
  alias Electric.Replication.Postgres.MigrationConsumer

  @receive_timeout 500
  @refute_receive_timeout 1000

  defmodule FakeProducer do
    use GenStage

    def start_link(name) do
      GenStage.start_link(__MODULE__, [], name: name)
    end

    @impl GenStage
    def init(_args) do
      {:producer, []}
    end

    @impl GenStage
    def handle_demand(_demand, state) do
      {:noreply, [], state}
    end

    @impl GenStage
    def handle_call({:emit, loader, events, version}, _from, state) do
      for tx <- events, is_struct(tx, Transaction) do
        for change <- tx.changes do
          MockSchemaLoader.receive_tx(loader, change.record, version)
        end
      end

      {:reply, :ok, events, state}
    end
  end

  defmodule FakeConsumer do
    use GenStage

    def start_link({producer, parent}) do
      GenStage.start_link(__MODULE__, {producer, parent})
    end

    @impl GenStage
    def init({producer, parent}) do
      {:consumer, parent, subscribe_to: [producer]}
    end

    @impl GenStage
    def handle_events(events, _from, parent) do
      send(parent, {__MODULE__, :events, events})
      {:noreply, [], parent}
    end
  end

  setup do
    origin = "logical_replication_producer_test_1"
    producer_name = Electric.name(FakeProducer, origin)

    producer = start_link_supervised!({FakeProducer, producer_name})

    version = "20220421"

    # provide fake oids for the new tables
    oids = %{
      table: %{
        {"public", "something_else"} => 1111,
        {"public", "other_thing"} => 2222,
        {"public", "yet_another_thing"} => 3333,
        {"electric", "shadow__public__something_else"} => 201_111,
        {"electric", "shadow__public__other_thing"} => 202_222,
        {"electric", "shadow__public__yet_another_thing"} => 203_333,
        {"public", "first_enum_table"} => 10001,
        {"electric", "shadow__public__first_enum_table"} => 20001,
        {"public", "second_enum_table"} => 10002,
        {"electric", "shadow__public__second_enum_table"} => 20002,
        {"public", "users"} => 30001,
        {"electric", "shadow__public__users"} => 30011,
        {"public", "projects"} => 30002,
        {"electric", "shadow__public__projects"} => 30012,
        {"public", "project_memberships"} => 30003,
        {"electric", "shadow__public__project_memberships"} => 30013,
        {"public", "teams"} => 30004,
        {"electric", "shadow__public__teams"} => 30014,
        {"public", "team_memberships"} => 30005,
        {"electric", "shadow__public__team_memberships"} => 30015
      }
    }

    pks = %{
      {"public", "mistakes"} => ["id"]
    }

    migrations = [
      {"20220000",
       [
         """
         create table projects (id uuid primary key)
         """,
         """
         create table users (id uuid primary key)
         """,
         """
         create table project_memberships (
            id uuid primary key,
            user_id uuid not null references users (id),
            project_id uuid not null references projects (id),
            project_role text not null
         )
         """
       ]}
    ]

    backend =
      MockSchemaLoader.start_link([oids: oids, pks: pks, migrations: migrations],
        name: __MODULE__.Loader
      )

    pid =
      start_link_supervised!(
        {MigrationConsumer,
         {[origin: origin, connection: [], replication: []],
          [
            producer: producer_name,
            backend: backend,
            refresh_enum_types: false
          ]}}
      )

    _consumer = start_link_supervised!({FakeConsumer, {pid, self()}})

    {:ok, origin: origin, producer: producer, version: version, loader: backend}
  end

  describe "migrations" do
    test "refreshes subscription after receiving a migration", cxt do
      %{producer: producer, origin: origin, version: version} = cxt
      assert_receive {MockSchemaLoader, {:connect, _}}

      events = [
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "6",
                "query" => "create table something_else (id uuid primary key);",
                "txid" => "101",
                "txts" => "201"
              },
              tags: []
            }
          ]
        }
      ]

      GenStage.call(producer, {:emit, cxt.loader, events, version})

      assert_receive {MockSchemaLoader, {:refresh_subscription, ^origin}}, 1500
    end

    test "captures migration records", cxt do
      %{origin: origin, producer: producer, version: version} = cxt
      assert_receive {MockSchemaLoader, {:connect, _}}

      events = [
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "6",
                "query" => "create table something_else (id uuid primary key);",
                "txid" => "100",
                "txts" => "200"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "7",
                "query" => "create table other_thing (id uuid primary key);",
                "txid" => "100",
                "txts" => "200"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "8",
                "query" => "create table yet_another_thing (id uuid primary key);",
                "txid" => "100",
                "txts" => "200"
              },
              tags: []
            }
          ],
          commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
          origin: origin,
          publication: "mock_pub",
          origin_type: :postgresql
        }
      ]

      GenStage.call(producer, {:emit, cxt.loader, events, version})

      assert_receive {FakeConsumer, :events, events}, @receive_timeout

      assert [
               %Transaction{
                 changes: [
                   %Migration{
                     version: "20220421",
                     schema: %{version: "20220421"},
                     ddl: [
                       "create table something_else (id uuid primary key);",
                       "create table other_thing (id uuid primary key);",
                       "create table yet_another_thing (id uuid primary key);"
                     ],
                     relations: [
                       {"public", "other_thing"},
                       {"public", "something_else"},
                       {"public", "yet_another_thing"}
                     ]
                   }
                 ],
                 commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
                 origin: ^origin,
                 publication: "mock_pub",
                 origin_type: :postgresql
               }
             ] = events

      assert_receive {MockSchemaLoader, :load}, @receive_timeout
      # only 1 save instruction is observed
      assert_receive {MockSchemaLoader, {:save, ^version, schema, [_, _, _]}}, @receive_timeout
      refute_receive {MockSchemaLoader, {:save, _, _schema}}, @refute_receive_timeout

      assert Enum.map(schema.tables, & &1.name.name) == [
               "projects",
               "users",
               "project_memberships",
               "something_else",
               "other_thing",
               "yet_another_thing",
               "shadow__public__projects",
               "shadow__public__users",
               "shadow__public__project_memberships",
               "shadow__public__something_else",
               "shadow__public__other_thing",
               "shadow__public__yet_another_thing"
             ]
    end

    test "captures unique enum types from migrations", cxt do
      %{origin: origin, producer: producer, version: version} = cxt
      assert_receive {MockSchemaLoader, {:connect, _}}

      events = [
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "1",
                "query" => "create type colour as enum ('red', 'green', 'blue');",
                "txid" => "100",
                "txts" => "200"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "2",
                "query" => """
                create table first_enum_table (
                  id uuid primary key,
                  foo colour
                );
                """,
                "txid" => "100",
                "txts" => "200"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "3",
                "query" => "create type colour as enum ('red', 'green', 'blue');",
                "txid" => "100",
                "txts" => "200"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "4",
                "query" => """
                create table second_enum_table (
                  id uuid primary key,
                  bar colour
                );
                """,
                "txid" => "100",
                "txts" => "200"
              },
              tags: []
            }
          ],
          commit_timestamp: ~U[2024-02-06 10:08:00.000000Z],
          origin: origin,
          publication: "mock_pub",
          origin_type: :postgresql
        }
      ]

      GenStage.call(producer, {:emit, cxt.loader, events, version})

      # only 1 save instruction is observed
      assert_receive {MockSchemaLoader, {:save, ^version, schema, [_, _, _, _]}}, @receive_timeout
      refute_receive {MockSchemaLoader, {:save, _, _schema}}, @refute_receive_timeout

      assert [
               %{
                 name: %{name: "colour", schema: "public"},
                 values: ["red", "green", "blue"]
               }
             ] = schema.enums
    end

    test "filters non-migration records", cxt do
      %{origin: origin, producer: producer, version: version} = cxt
      assert_receive {MockSchemaLoader, {:connect, _}}

      raw_events = [
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "6",
                "query" => "create table something_else (id uuid primary key);",
                "txid" => "101",
                "txts" => "201"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "schema"},
              record: %{
                "id" => "7",
                "version" => version,
                "schema" => "{}"
              },
              tags: []
            }
          ],
          commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
          origin: origin,
          publication: "mock_pub",
          origin_type: :postgresql
        }
      ]

      GenStage.call(producer, {:emit, cxt.loader, raw_events, version})

      assert_receive {FakeConsumer, :events, filtered_events}, 1000

      assert [
               %Transaction{
                 changes: [
                   %Migration{
                     version: "20220421",
                     ddl: [
                       "create table something_else (id uuid primary key);"
                     ],
                     relations: [{"public", "something_else"}],
                     relation: {"electric", "ddl_commands"}
                   }
                 ],
                 commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
                 origin: ^origin,
                 publication: "mock_pub",
                 origin_type: :postgresql
               }
             ] = filtered_events

      assert_receive {MockSchemaLoader, :load}, 500

      assert_receive {MockSchemaLoader,
                      {:save, ^version, _schema,
                       ["create table something_else (id uuid primary key);"]}}
    end
  end

  describe "permissions" do
    alias ElectricTest.PermissionsHelpers.Proto
    alias ElectricTest.PermissionsHelpers.Chgs

    test "converts ddlx events into global permission change messages", cxt do
      %{origin: origin, producer: producer, version: version} = cxt
      assert_receive {MockSchemaLoader, {:connect, _}}

      raw_events = [
        %Transaction{
          changes: [
            Chgs.ddlx(
              assigns: [
                Proto.assign(
                  table: Proto.table("project_memberships"),
                  user_column: "user_id",
                  role_column: "project_role",
                  scope: Proto.table("projects")
                )
              ]
            )
          ],
          commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
          origin: origin,
          publication: "mock_pub",
          origin_type: :postgresql
        }
      ]

      GenStage.call(producer, {:emit, cxt.loader, raw_events, version})

      assert_receive {FakeConsumer, :events, filtered_events}, 1000

      assert [
               %Transaction{
                 changes: [
                   %Changes.UpdatedPermissions{
                     type: :global,
                     permissions: %Changes.UpdatedPermissions.GlobalPermissions{permissions_id: 2}
                   }
                 ],
                 commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
                 publication: "mock_pub",
                 origin_type: :postgresql
               }
             ] = filtered_events
    end

    test "converts membership changes into user permission change messages", cxt do
      %{origin: origin, producer: producer, version: version} = cxt
      assert_receive {MockSchemaLoader, {:connect, _}}

      raw_events = [
        %Transaction{
          changes: [
            Chgs.ddlx(
              assigns: [
                Proto.assign(
                  table: Proto.table("project_memberships"),
                  user_column: "user_id",
                  role_column: "project_role",
                  scope: Proto.table("projects")
                )
              ]
            )
          ],
          commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
          origin: origin,
          publication: "mock_pub",
          origin_type: :postgresql
        }
      ]

      GenStage.call(producer, {:emit, cxt.loader, raw_events, version})
      assert_receive {MockSchemaLoader, {:save_global_permissions, _}}, 500

      assert_receive {FakeConsumer, :events, _filtered_events}, 1000

      insert =
        Chgs.insert(
          {"public", "project_memberships"},
          %{
            "id" => "pm-1",
            "user_id" => "user-1",
            "project_id" => "p-1",
            "project_role" => "admin"
          }
        )

      raw_events = [
        %Transaction{
          changes: [insert],
          commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
          origin: origin,
          publication: "mock_pub",
          origin_type: :postgresql
        }
      ]

      GenStage.call(producer, {:emit, cxt.loader, raw_events, version})

      assert_receive {FakeConsumer, :events, filtered_events}, 1000

      assert [
               %Transaction{
                 changes: [
                   ^insert,
                   %Changes.UpdatedPermissions{
                     type: :user,
                     permissions: %Changes.UpdatedPermissions.UserPermissions{
                       user_id: "user-1",
                       permissions: _user_perms
                     }
                   }
                 ],
                 commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
                 publication: "mock_pub",
                 origin_type: :postgresql
               }
             ] = filtered_events

      assert_receive {MockSchemaLoader, {:save_user_permissions, "user-1", _}}, 500
    end

    test "uses updated schema information", cxt do
      %{origin: origin, producer: producer, version: version} = cxt
      assert_receive {MockSchemaLoader, {:connect, _}}

      insert =
        Chgs.insert(
          {"public", "team_memberships"},
          %{
            "id" => "tm-1",
            "user_id" => "user-1",
            "team_id" => "t-1",
            "team_role" => "manager"
          }
        )

      raw_events = [
        %Transaction{
          changes: [
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "6",
                "query" => "create table teams (id uuid primary key);",
                "txid" => "101",
                "txts" => "201"
              },
              tags: []
            },
            %NewRecord{
              relation: {"electric", "ddl_commands"},
              record: %{
                "id" => "7",
                "query" => """
                create table team_memberships (
                  id uuid primary key,
                  team_id uuid references teams (id),
                  user_id uuid references users (id),
                  team_role text not null
                );
                """,
                "txid" => "101",
                "txts" => "201"
              },
              tags: []
            },
            Chgs.ddlx(
              assigns: [
                Proto.assign(
                  table: Proto.table("team_memberships"),
                  user_column: "user_id",
                  role_column: "team_role",
                  scope: Proto.table("teams")
                )
              ]
            ),
            insert
          ],
          commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
          origin: origin,
          publication: "mock_pub",
          origin_type: :postgresql
        }
      ]

      GenStage.call(producer, {:emit, cxt.loader, raw_events, version})

      assert_receive {FakeConsumer, :events, filtered_events}, 1000

      assert [
               %Transaction{
                 changes: [
                   %Migration{
                     version: "20220421",
                     ddl: [
                       "create table teams (id uuid primary key);",
                       """
                       create table team_memberships (
                         id uuid primary key,
                         team_id uuid references teams (id),
                         user_id uuid references users (id),
                         team_role text not null
                       );
                       """
                     ],
                     schema: %{version: "20220421"}
                   },
                   %Changes.UpdatedPermissions{
                     type: :global,
                     permissions: %Changes.UpdatedPermissions.GlobalPermissions{permissions_id: 2}
                   },
                   ^insert,
                   %Changes.UpdatedPermissions{
                     type: :user,
                     permissions: %Changes.UpdatedPermissions.UserPermissions{
                       user_id: "user-1",
                       permissions: _user_perms
                     }
                   }
                 ],
                 commit_timestamp: ~U[2023-05-02 10:08:00.948788Z],
                 publication: "mock_pub",
                 origin_type: :postgresql
               }
             ] = filtered_events
    end
  end
end
