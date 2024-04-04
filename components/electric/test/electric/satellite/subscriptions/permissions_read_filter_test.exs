defmodule Electric.Satellite.Subscriptions.PermissionsReadFilterTest do
  use ExUnit.Case, async: false
  use Electric.Satellite.Protobuf
  use Electric.Postgres.MockSchemaLoader

  import Electric.Postgres.TestConnection
  import Electric.Utils, only: [uuid4: 0]
  import ElectricTest.SatelliteHelpers

  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.Gone
  alias Electric.Replication.Postgres.Client
  alias ElectricTest.PermissionsHelpers.Auth

  alias Satellite.TestWsClient, as: MockClient
  alias Satellite.ProtocolHelpers

  @other_user_id1 "621b8a48-b227-4937-9a6a-3042aa0222a7"
  @other_user_id2 "b01d0c9c-fe95-4348-9193-d4db3b170d79"
  @entry_id "8b91a34c-9b19-49ad-b40b-a45e872e4edd"

  defp setup_ws(cxt) do
    user_id = Auth.user_id()
    client_id = "device-id-0000" <> uuid4()
    port = 55133

    plug =
      {
        Electric.Plug.SatelliteWebsocketPlug,
        auth_provider: Electric.Satellite.Auth.provider(), connector_config: cxt.connector_config
      }

    start_link_supervised!({Bandit, port: port, plug: plug})

    token = Electric.Satellite.Auth.Secure.create_token(user_id)

    %{user_id: user_id, client_id: client_id, token: token, port: port}
  end

  defp insert_entry(cxt, content, author_id) do
    assert {:ok, 1} =
             :epgsql.equery(
               cxt.conn,
               "INSERT INTO public.authored_entries (id, content, author_id) VALUES ($1, $2, $3)",
               [uuid4(), content, author_id]
             )
  end

  defp assert_receive_entry(conn, content, author_id) do
    assert_receive {^conn,
                    %SatOpLog{
                      ops: [
                        %{op: {:begin, _}},
                        %{op: {:insert, %{row_data: %{values: [_, ^content, ^author_id]}}}}
                        | _
                      ]
                    }},
                   1000
  end

  defp refute_receive_entry(conn, title) do
    refute_receive {^conn,
                    %SatOpLog{
                      ops: [
                        %{op: {:begin, _}},
                        %{op: {:insert, %{row_data: %{values: [_, ^title, _]}}}},
                        %{op: {:commit, _}}
                      ]
                    }},
                   1000
  end

  defp sorted_entry_inserts(ops) do
    Enum.sort_by(ops, fn %{row_data: %{values: [_, content, _]}} -> content end)
  end

  defp assert_sync_data(cxt, received, expected) do
    schema =
      Map.get_lazy(cxt, :schema, fn ->
        {:ok, _version, schema} = Electric.Postgres.Extension.current_schema(cxt.conn)
        schema
      end)

    oid_map =
      Map.new(schema.tables, fn table ->
        {table.oid, {{table.name.schema, table.name.name}, Enum.map(table.columns, & &1.name)}}
      end)

    assert length(received) == length(expected),
           "expected #{length(expected)} rows, but received #{length(received)}:\n#{inspect(received, width: 0)}"

    Enum.reduce(received, expected, fn %{relation_id: oid, row_data: %{values: row}}, expected ->
      {relation, columns} = Map.fetch!(oid_map, oid)
      record = columns |> Enum.zip(row) |> Map.new()

      case Enum.split_with(expected, fn {table, values} ->
             relation == table && Enum.all?(values, fn {c, v} -> record[c] == v end)
           end) do
        {[_match], rest} ->
          rest

        {[_e1, _e2 | _expected] = match, _rest} ->
          flunk("invalid expectation: multiple rows match the specification #{inspect(match)}")

        {[], _rest} ->
          flunk("got unexpected row: #{inspect(relation)}: #{inspect(record)}")
      end
    end)
  end

  describe "entries" do
    setup [
      :setup_replicated_db,
      :setup_electrified_tables,
      :setup_with_ddlx,
      :setup_with_sql_execute,
      :setup_ws
    ]

    @tag scenario: :entries_and_documents,
         with_sql: """
         INSERT INTO public.users (id, name, role) VALUES ('#{Auth.user_id()}', 'John', 'user');
         INSERT INTO public.users (id, name, role) VALUES ('#{@other_user_id1}', 'Other 1', 'user');
         INSERT INTO public.users (id, name, role) VALUES ('#{@other_user_id2}', 'Other 2', 'user');
         INSERT INTO public.authored_entries (id, content, author_id) VALUES ('#{uuid4()}', 'Entry 1', '#{Auth.user_id()}');
         INSERT INTO public.authored_entries (id, content, author_id) VALUES ('#{uuid4()}', 'Entry 2', '#{@other_user_id1}');
         """,
         ddlx: [
           "GRANT READ ON public.authored_entries TO 'user'",
           "GRANT READ ON public.users TO 'user'",
           "ASSIGN public.users.role TO public.users.id"
         ]
    test "unfiltered access returns all rows", cxt do
      MockClient.with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
        rel_map = start_replication_and_assert_response(conn, cxt.electrified_count)
        req_id = uuid4()
        sub_id = uuid4()
        user_id = Auth.user_id()

        request = %SatSubsReq{
          subscription_id: sub_id,
          shape_requests: [
            %SatShapeReq{
              request_id: req_id,
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: "authored_entries"}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^req_id], data} = receive_subscription_data(conn, sub_id)

        assert [
                 %SatOpInsert{row_data: %{values: [_, "Entry 1", _]}},
                 %SatOpInsert{row_data: %{values: [_, "Entry 2", _]}},
                 %SatOpInsert{row_data: %{values: [_, "John", _]}},
                 %SatOpInsert{row_data: %{values: [_, "Other 1", _]}}
               ] = sorted_entry_inserts(data)

        insert_entry(cxt, "Entry 3", Auth.user_id())
        insert_entry(cxt, "Entry 4", @other_user_id2)

        assert [
                 %NewRecord{
                   relation: {"public", "authored_entries"},
                   record: %{"content" => "Entry 3", "author_id" => ^user_id}
                 }
               ] = receive_txn_changes(conn, rel_map)

        assert [
                 %NewRecord{
                   relation: {"public", "authored_entries"},
                   record: %{"content" => "Entry 4", "author_id" => @other_user_id2}
                 },
                 %NewRecord{
                   relation: {"public", "users"},
                   record: %{"id" => @other_user_id2}
                 }
               ] = receive_txn_changes(conn, rel_map)
      end)
    end

    @tag scenario: :entries_and_documents,
         with_sql: """
         INSERT INTO public.users (id, name, role) VALUES ('#{Auth.user_id()}', 'John', 'reader');
         INSERT INTO public.users (id, name, role) VALUES ('#{@other_user_id1}', 'Other 1', 'reader');
         INSERT INTO public.users (id, name, role) VALUES ('#{@other_user_id2}', 'Other 2', 'reader');
         INSERT INTO public.authored_entries (id, content, author_id) VALUES ('#{uuid4()}', 'Entry 1', '#{Auth.user_id()}');
         INSERT INTO public.authored_entries (id, content, author_id) VALUES ('#{uuid4()}', 'Entry 2', '#{@other_user_id1}');
         """,
         ddlx: [
           "GRANT READ ON public.authored_entries TO 'reader' WHERE (row.author_id = auth.user_id)",
           "ASSIGN public.users.role TO public.users.id"
         ]
    test "filtered access returns valid rows", cxt do
      MockClient.with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
        start_replication_and_assert_response(conn, cxt.electrified_count)
        req_id = uuid4()
        sub_id = uuid4()

        request = %SatSubsReq{
          subscription_id: sub_id,
          shape_requests: [
            %SatShapeReq{
              request_id: req_id,
              shape_definition: %SatShapeDef{
                selects: [%SatShapeDef.Select{tablename: "authored_entries"}]
              }
            }
          ]
        }

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^req_id], data} = receive_subscription_data(conn, sub_id)

        assert [
                 %SatOpInsert{row_data: %{values: [_, "Entry 1", _]}}
               ] = sorted_entry_inserts(data)

        insert_entry(cxt, "Entry 3", Auth.user_id())
        insert_entry(cxt, "Entry 4", @other_user_id1)
        assert_receive_entry(conn, "Entry 3", Auth.user_id())
        refute_receive_entry(conn, "Entry 4")
      end)
    end

    @tag scenario: :entries_and_documents,
         with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{Auth.user_id()}', 'Just Me');
         INSERT INTO public.users (id, name) VALUES ('#{Auth.not_user_id()}', 'Not Nobody');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES ('#{@entry_id}', '#{Auth.user_id()}', 'Hello world');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES ('#{uuid4()}', '#{Auth.not_user_id()}', 'TTFN');
         INSERT INTO public.comments (id, entry_id, content, author_id) VALUES ('#{uuid4()}', '#{@entry_id}', 'Comment 1', '#{Auth.user_id()}');
         INSERT INTO public.comments (id, entry_id, content, author_id) VALUES ('#{uuid4()}', '#{@entry_id}', 'Comment 2', '#{Auth.not_user_id()}');
         """,
         ddlx: [
           "GRANT ALL ON public.comments TO (public.users, 'self')",
           "GRANT ALL ON public.authored_entries TO (public.users, 'self')",
           "GRANT SELECT ON public.users TO (public.users, 'self')",
           "GRANT UPDATE ON public.users TO (public.users, 'self')",
           # we need to be able to read the users table in order to follow fks from comments
           # because this schema is fairly pathalogical there's no way to grant a scoped read
           # permission for any row other than your own
           "GRANT READ ON public.users TO AUTHENTICATED",
           "ASSIGN (public.users, 'self') TO public.users.id"
         ]
    test "include tree with scoped permissions", %{conn: pg_conn} = cxt do
      user_id = Auth.user_id()
      not_user_id = Auth.not_user_id()

      MockClient.with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
        rel_map = start_replication_and_assert_response(conn, cxt.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(
            users: [
              # where: "this.name ILIKE '% doe'",
              include: [
                authored_entries: [over: "author_id", include: [comments: [over: "entry_id"]]]
              ]
            ]
          )

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], data} = receive_subscription_data(conn, sub_id)

        assert [
                 %SatOpInsert{row_data: %{values: [_id1, "Comment 1", @entry_id, ^user_id]}},
                 %SatOpInsert{row_data: %{values: [_id2, "Comment 2", @entry_id, ^not_user_id]}},
                 %SatOpInsert{row_data: %{values: [@entry_id, "Hello world", ^user_id]}},
                 %SatOpInsert{row_data: %{values: [^user_id, "Just Me", _]}},
                 %SatOpInsert{row_data: %{values: [^not_user_id, "Not Nobody", _]}}
               ] = Enum.sort_by(data, fn %{row_data: %{values: values}} -> Enum.at(values, 1) end)

        {:ok, 1} =
          :epgsql.equery(
            pg_conn,
            "INSERT INTO public.authored_entries (id, author_id, content) VALUES ($1, $2, $3)",
            [
              uuid4(),
              user_id,
              "Second item"
            ]
          )

        assert [
                 %NewRecord{
                   relation: {"public", "authored_entries"},
                   record: %{"content" => "Second item"}
                 }
               ] = receive_txn_changes(conn, rel_map)
      end)
    end
  end

  describe "linear-like" do
    @describetag scenario: :linear

    @account_id "bc3e95ea-fc35-4c90-a45a-41af8c3297d3"
    @tm1_id "eb802dff-592b-49e6-861d-1dbe04fd17d7"
    @tm2_id "b2f9136b-357b-4793-b29b-faac10f6c5c8"

    @project1_id "8fd5c7f1-3137-456b-9509-d84e967dd92c"
    @project2_id "47938814-fec1-493c-8cfb-dcabf6d07311"
    @project3_id "de0eab6f-831f-41b3-9176-a7d6a8c793e2"

    @issue1_id "a9cb074a-1ff7-4c87-bc44-de86b52762ca"
    @issue2_id "8c77d950-709e-4776-a8e6-6e761a104adc"

    @comment1_id "aaea9068-1df1-45a0-be26-233b60fa11c4"
    @comment2_id "7487f403-387e-4a8f-8c88-ee4cead732b3"
    @comment3_id "fe221818-1808-48b7-819e-1a33992ed2f1"
    @comment4_id "e599c858-5829-41f4-b983-ea7e9e746dfb"

    setup do
      {
        :ok,
        with_sql: """
        INSERT INTO public.users (id, name) VALUES ('#{Auth.user_id()}', 'Just Me');
        INSERT INTO public.users (id, name) VALUES ('#{Auth.not_user_id()}', 'Not Nobody');
        INSERT INTO public.accounts (id, name) VALUES ('#{@account_id}', 'Electric');

        INSERT INTO public.team_memberships (id, account_id, user_id, role) VALUES ('#{@tm1_id}', '#{@account_id}', '#{Auth.user_id()}', 'member');
        INSERT INTO public.team_memberships (id, account_id, user_id, role) VALUES ('#{@tm2_id}', '#{@account_id}', '#{Auth.not_user_id()}', 'member');

        INSERT INTO public.projects (id, account_id, name) VALUES ('#{@project1_id}', '#{@account_id}', 'Project 1');
        INSERT INTO public.projects (id, account_id, name) VALUES ('#{@project2_id}', '#{@account_id}', 'Project 2');
        INSERT INTO public.projects (id, account_id, name) VALUES ('#{@project3_id}', '#{@account_id}', 'Project 3');

        INSERT INTO public.issues (id, project_id, name, visible) VALUES ('#{@issue1_id}', '#{@project1_id}', 'Issue 1', true);
        INSERT INTO public.issues (id, project_id, name, visible) VALUES ('#{@issue2_id}', '#{@project2_id}', 'Issue 2', true);

        INSERT INTO public.comments (id, issue_id, author_id, comment) VALUES ('#{@comment1_id}', '#{@issue1_id}', '#{Auth.user_id()}', 'Comment 1');
        INSERT INTO public.comments (id, issue_id, author_id, comment) VALUES ('#{@comment2_id}', '#{@issue1_id}', '#{Auth.not_user_id()}', 'Comment 2');
        INSERT INTO public.comments (id, issue_id, author_id, comment) VALUES ('#{@comment3_id}', '#{@issue2_id}', '#{Auth.user_id()}', 'Comment 3');
        INSERT INTO public.comments (id, issue_id, author_id, comment) VALUES ('#{@comment4_id}', '#{@issue2_id}', '#{Auth.not_user_id()}', 'Comment 4');

        INSERT INTO public.project_memberships (id, team_membership_id, project_id, user_id, role) VALUES ('#{uuid4()}', '#{@tm1_id}', '#{@project1_id}', '#{Auth.user_id()}', 'member');
        INSERT INTO public.project_memberships (id, team_membership_id, project_id, user_id, role) VALUES ('#{uuid4()}', '#{@tm1_id}', '#{@project3_id}', '#{Auth.user_id()}', 'member');
        INSERT INTO public.project_memberships (id, team_membership_id, project_id, user_id, role) VALUES ('#{uuid4()}', '#{@tm2_id}', '#{@project2_id}', '#{Auth.not_user_id()}', 'member');
        -- INSERT INTO public.project_memberships (id, team_membership_id, project_id, user_id, role) VALUES ('#{uuid4()}', '#{@tm2_id}', '#{@project2_id}', '#{Auth.not_user_id()}', 'member');
        """,
        ddlx: [
          "GRANT READ ON public.accounts TO (public.accounts, 'member')",
          "GRANT READ ON public.projects TO (public.projects, 'member')",
          "GRANT ALL ON public.issues TO (public.projects, 'member') WHERE (row.visible = true)",
          "GRANT READ ON public.comments TO (public.projects, 'member')",
          "GRANT WRITE ON public.comments TO (public.projects, 'member') WHERE (row.author_id = auth.user_id)",
          "GRANT READ ON public.project_memberships TO (public.projects, 'member')",
          "GRANT ALL ON public.users TO (public.users, 'self')",
          # "GRANT READ ON public.users TO (public.projects, 'member')",
          "GRANT READ ON public.users TO AUTHENTICATED",
          "ASSIGN (public.accounts, public.team_memberships.role) TO public.team_memberships.user_id",
          "ASSIGN (public.projects, public.project_memberships.role) TO public.project_memberships.user_id",
          "ASSIGN (public.users, 'self') TO public.users.id"
        ]
      }
    end

    setup [
      :setup_replicated_db,
      :setup_electrified_tables,
      :setup_with_ddlx,
      :setup_with_sql_execute,
      :setup_ws
    ]

    test "shape with permissions context", cxt do
      user_id = Auth.user_id()
      not_user_id = Auth.not_user_id()

      MockClient.with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
        rel_map = start_replication_and_assert_response(conn, cxt.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(
            issues: [
              include: [comments: [over: "issue_id"]]
            ]
          )

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], data} = receive_subscription_data(conn, sub_id)

        assert_sync_data(cxt, data, [
          {{"public", "users"}, %{"id" => user_id}},
          {{"public", "users"}, %{"id" => not_user_id}},
          {{"public", "accounts"}, %{"id" => @account_id}},
          {{"public", "projects"}, %{"id" => @project1_id}},
          {{"public", "issues"}, %{"id" => @issue1_id}},
          {{"public", "comments"}, %{"id" => @comment1_id}},
          {{"public", "comments"}, %{"id" => @comment2_id}}
        ])

        visible_comment_id = uuid4()

        {:ok, 2} =
          :epgsql.equery(
            cxt.conn,
            "INSERT INTO public.comments (id, issue_id, author_id, comment) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)",
            [
              visible_comment_id,
              @issue1_id,
              user_id,
              "Visible",
              ##
              uuid4(),
              @issue2_id,
              not_user_id,
              "Invisible"
            ]
          )

        assert [
                 %NewRecord{
                   relation: {"public", "comments"},
                   record: %{"id" => ^visible_comment_id}
                 }
               ] = receive_txn_changes(conn, rel_map)
      end)
    end

    test "permissions move out after scope move", cxt do
      user_id = Auth.user_id()
      not_user_id = Auth.not_user_id()

      MockClient.with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
        rel_map = start_replication_and_assert_response(conn, cxt.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(
            issues: [
              include: [comments: [over: "issue_id"]]
            ]
          )

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], data} = receive_subscription_data(conn, sub_id)

        assert_sync_data(cxt, data, [
          {{"public", "users"}, %{"id" => user_id}},
          {{"public", "users"}, %{"id" => not_user_id}},
          {{"public", "accounts"}, %{"id" => @account_id}},
          {{"public", "projects"}, %{"id" => @project1_id}},
          {{"public", "issues"}, %{"id" => @issue1_id}},
          {{"public", "comments"}, %{"id" => @comment1_id}},
          {{"public", "comments"}, %{"id" => @comment2_id}}
        ])

        new_issue_id = uuid4()
        new_comment_id = uuid4()

        Client.with_transaction(cxt.conn, fn tx_conn ->
          {:ok, 1} =
            :epgsql.equery(
              tx_conn,
              "INSERT INTO public.issues (id, project_id, name, visible) VALUES ($1, $2, $3, $4);",
              [
                new_issue_id,
                @project1_id,
                "Visible issue",
                true
              ]
            )

          {:ok, 1} =
            :epgsql.equery(
              tx_conn,
              "INSERT INTO public.comments (id, issue_id, author_id, comment) VALUES ($1, $2, $3, $4);",
              [
                new_comment_id,
                new_issue_id,
                not_user_id,
                "Nothing to say"
              ]
            )

          {:ok, 1} =
            :epgsql.equery(
              tx_conn,
              "UPDATE public.issues SET project_id = $1 WHERE id = $2",
              [
                @project2_id,
                @issue1_id
              ]
            )
        end)

        # should remove the issue that has moved out of perms scope
        # and the comments attached to it
        assert [
                 %Gone{
                   relation: {"public", "comments"},
                   pk: [@comment1_id]
                 },
                 %Gone{
                   relation: {"public", "comments"},
                   pk: [@comment2_id]
                 },
                 %Gone{
                   relation: {"public", "issues"},
                   pk: [@issue1_id]
                 },
                 %Gone{
                   relation: {"public", "users"},
                   pk: [^user_id]
                 },
                 %NewRecord{
                   relation: {"public", "comments"},
                   record: %{"id" => ^new_comment_id}
                 },
                 %NewRecord{
                   relation: {"public", "issues"},
                   record: %{"id" => ^new_issue_id}
                 }
               ] = receive_txn_changes(conn, rel_map)
      end)
    end

    test "permissions move out after where clause change", cxt do
      user_id = Auth.user_id()
      not_user_id = Auth.not_user_id()

      MockClient.with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
        rel_map = start_replication_and_assert_response(conn, cxt.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(
            issues: [
              include: [comments: [over: "issue_id"]]
            ]
          )

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], data} = receive_subscription_data(conn, sub_id)

        assert_sync_data(cxt, data, [
          {{"public", "users"}, %{"id" => user_id}},
          {{"public", "users"}, %{"id" => not_user_id}},
          {{"public", "accounts"}, %{"id" => @account_id}},
          {{"public", "projects"}, %{"id" => @project1_id}},
          {{"public", "issues"}, %{"id" => @issue1_id}},
          {{"public", "comments"}, %{"id" => @comment1_id}},
          {{"public", "comments"}, %{"id" => @comment2_id}}
        ])

        {:ok, 1} =
          :epgsql.equery(
            cxt.conn,
            "UPDATE public.issues SET visible = $1 WHERE id = $2",
            [false, @issue1_id]
          )

        # should remove the issue that has moved out of perms scope
        # and the comments attached to it -- but since nothing else
        # referred to the rest of the attached tree - so the issue project
        # and the relevant account and user -- these are also affected
        assert [
                 %Gone{
                   relation: {"public", "accounts"},
                   pk: [@account_id]
                 },
                 %Gone{
                   relation: {"public", "comments"},
                   pk: [@comment1_id]
                 },
                 %Gone{
                   relation: {"public", "comments"},
                   pk: [@comment2_id]
                 },
                 %Gone{
                   relation: {"public", "issues"},
                   pk: [@issue1_id]
                 },
                 %Gone{
                   relation: {"public", "projects"},
                   pk: [@project1_id]
                 },
                 %Gone{
                   relation: {"public", "users"},
                   pk: [^not_user_id]
                 },
                 %Gone{
                   relation: {"public", "users"},
                   pk: [^user_id]
                 }
               ] = receive_txn_changes(conn, rel_map)
      end)
    end

    test "changes produced by secondary actions are filtered on permissions", cxt do
      MockClient.with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
        rel_map = start_replication_and_assert_response(conn, cxt.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(
            issues: [
              where: "this.name ILIKE 'nice %'",
              include: [
                projects: [over: "project_id", include: [issues: [over: "project_id"]]]
              ]
            ]
          )

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], []} = receive_subscription_data(conn, sub_id)

        new_issue_id = uuid4()

        # Update to an entry in the same txn where it's getting GONE is not propagated
        Client.with_transaction(cxt.conn, fn tx_conn ->
          {:ok, 1} =
            :epgsql.equery(
              tx_conn,
              "INSERT INTO public.issues (id, project_id, name, visible) VALUES ($1, $2, $3, $4)",
              [new_issue_id, @project1_id, "unrelated content", false]
            )

          {:ok, 1} =
            :epgsql.equery(
              tx_conn,
              "UPDATE public.issues SET name = $1 WHERE id = $2",
              ["nice job", @issue1_id]
            )
        end)

        assert [
                 %NewRecord{relation: {"public", "accounts"}, record: %{"name" => "Electric"}},
                 # not seeing the issue with visible = false
                 %NewRecord{
                   relation: {"public", "issues"},
                   record: %{"id" => @issue1_id, "name" => "nice job"}
                 },
                 %NewRecord{relation: {"public", "projects"}, record: %{"name" => "Project 1"}}
               ] = receive_txn_changes(conn, rel_map)
      end)
    end

    @tag :wip
    test "new permissions applied after update", cxt do
      user_id = Auth.user_id()
      not_user_id = Auth.not_user_id()

      MockClient.with_connect([auth: cxt, id: cxt.client_id, port: cxt.port], fn conn ->
        rel_map = start_replication_and_assert_response(conn, cxt.electrified_count)

        {sub_id, request_id, request} =
          ProtocolHelpers.simple_sub_request(
            issues: [
              include: [comments: [over: "issue_id"]]
            ]
          )

        assert {:ok, %SatSubsResp{err: nil}} =
                 MockClient.make_rpc_call(conn, "subscribe", request)

        assert {[^request_id], data} = receive_subscription_data(conn, sub_id)

        assert_sync_data(cxt, data, [
          {{"public", "users"}, %{"id" => user_id}},
          {{"public", "users"}, %{"id" => not_user_id}},
          {{"public", "accounts"}, %{"id" => @account_id}},
          {{"public", "projects"}, %{"id" => @project1_id}},
          {{"public", "issues"}, %{"id" => @issue1_id}},
          {{"public", "comments"}, %{"id" => @comment1_id}},
          {{"public", "comments"}, %{"id" => @comment2_id}}
        ])

        visible_comment_id = uuid4()

        {:ok, 2} =
          :epgsql.equery(
            cxt.conn,
            "INSERT INTO public.comments (id, issue_id, author_id, comment) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)",
            [
              visible_comment_id,
              @issue1_id,
              user_id,
              "Visible",
              ##
              uuid4(),
              @issue2_id,
              not_user_id,
              "Invisible"
            ]
          )

        assert [
                 %NewRecord{
                   relation: {"public", "comments"},
                   record: %{"id" => ^visible_comment_id}
                 }
               ] = receive_txn_changes(conn, rel_map)

        # give ourselves a new membership of project2
        {:ok, 1} =
          :epgsql.equery(
            cxt.conn,
            "INSERT INTO public.project_memberships (id, team_membership_id, project_id, user_id, role) VALUES ($1, $2, $3, $4, $5);",
            [
              uuid4(),
              @tm1_id,
              @project2_id,
              user_id,
              "member"
            ]
          )

        # under txid ordering + xmin insert
        # tx 1 INSERT granting new permission & move-in data request (xmin = 4)
        # tx 2 INSERT INTO comments 1 (new project)
        # NEW DATA MOVE IN
        # tx 4 INSERT INTO comments 2 (new project)

        new_comment_id = uuid4()

        # TODO(magnetised): adding a role should cause a subscription refresh, which would cause
        #                   new rows we can see being sent automatically. in lieu of that, force
        #                   the newly accessible data into the shape by doing an insert.

        # add a comment to project 2
        {:ok, 1} =
          :epgsql.equery(
            cxt.conn,
            "INSERT INTO public.comments (id, issue_id, author_id, comment) VALUES ($1, $2, $3, $4)",
            [
              new_comment_id,
              # issue 2 belongs to project 2
              @issue2_id,
              not_user_id,
              "Now Visible"
            ]
          )

        # FIXME(magnetised): when shapes and permissions are properly integrated, we should
        #                    receive the new comment plus all the associated elements of the new
        #                    project tree
        # assert [
        #          %NewRecord{
        #            relation: {"public", "comments"},
        #            record: %{"id" => ^new_comment_id}
        #          },
        #          %UpdatedRecord{
        #            relation: {"public", "issues"},
        #            record: %{"id" => @issue2_id}
        #          },
        #          %UpdatedRecord{
        #            relation: {"public", "projects"},
        #            record: %{"id" => @project2_id}
        #          }
        #        ] = receive_txn_changes(conn, rel_map)

        # in the meantime the correct situation is to receive nothing
        refute_receive {^conn, %SatOpLog{} = _oplog}
      end)
    end
  end
end
