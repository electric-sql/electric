defmodule Electric.Satellite.Permissions.Client do
  @moduledoc ~S"""
  Generates triggers that will enforce the the given set of permissions locally at the database
  level.

  ## Applying to database

  Before applying this permissions SQL, the client *MUST* clean up any existing triggers:

      transaction(fn tx ->
        if table_exists("__electric_permissions_triggers") do
          for {name, type} <- query(tx, "SELECT name, type FROM __electric_permissions_triggers") do
            case type do
              "trigger" -> execute(tx, "DROP TRIGGER IF EXISTS #{name};")
              "function" -> execute(tx, "DROP FUNCTION IF EXISTS #{name} CASCADE;")
            end
          end
        end
        execute(tx, trigger_sql)
      end)


  to remove any existing permissions triggers.

  It makes sense to use a transaction to wrap the perms trigger creation, the txn type should
  probably be `IMMEDIATE` (for SQLite) to prevent any other writes to the db while we're swapping
  perms triggers.

  ## Notes for PG version

  - we only need to record the trigger function, not the trigger itself as the `DROP FUNCTION ...
    CASCADE` statement will automatically drop the associated trigger.
  """

  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.Schema.FkGraph
  alias Electric.Satellite.Permissions

  import Electric.Satellite.Permissions.Client.Format

  @dialect Electric.Satellite.Permissions.Client.SQLite

  @doc false
  # public only to enable direct testing of the scope query code
  def scope_query(schema, root, table, where_clause) when is_function(where_clause, 1) do
    schema
    |> compile_schema()
    |> build_scope_query(root, table, where_clause)
    |> format()
  end

  defp build_scope_query(schema, root, table, where_clause, select_clause \\ nil)

  defp build_scope_query(schema, root, root, where_clause, select_clause) do
    {:ok, pks} = pks(schema, root)

    where =
      Enum.map(pks, fn pk ->
        [ref(root, pk, @dialect), " = ", where_clause.(pk)]
      end)
      |> and_()

    lines([
      [
        "SELECT ",
        select_clause || select_pk(root, schema)
      ],
      indent([
        ["FROM ", @dialect.table(root)],
        "WHERE",
        indent(where),
        "LIMIT 1"
      ])
    ])
  end

  defp build_scope_query(schema, root, table, where_clause, select_clause) do
    fk_path = FkGraph.fk_path(schema.fks, root, table)
    # to handle join tables, we need to know where to start the lookup.  if the first element of
    # the fk path is a reverse lookup, from the pk to an fk (which belongs to a join table), in
    # which case we need to construct the final where clause differently to exclude the table with
    # the pk
    {origin, fks, pks} =
      case fk_path do
        [{:one_to_many, {_, _fks}, {t, pks}} | _] ->
          {t, pks, pks}

        [{:many_to_one, {_t, fks}, {t, pks}} | _] ->
          {t, fks, pks}
      end

    joins =
      fk_path
      |> Stream.drop(1)
      |> Enum.reverse()
      |> Enum.map(fn {_, {a, fks}, {b, pks}} ->
        clauses =
          fks
          |> Stream.zip(pks)
          |> Stream.map(fn {fk, pk} -> [ref(a, fk, @dialect), " = ", ref(b, pk, @dialect)] end)
          |> and_()

        lines([["LEFT JOIN ", @dialect.table(a), " ON "], indent(clauses)])
      end)

    where =
      pks
      |> Stream.zip(fks)
      |> Stream.map(fn {pk, fk} -> [ref(origin, pk, @dialect), " = ", where_clause.(fk)] end)
      |> and_()

    lines([
      [
        "SELECT ",
        select_clause || select_pk(root, schema)
      ],
      indent([
        ["FROM ", @dialect.table(root)]
      ]),
      indent(joins),
      indent([
        ["WHERE"],
        indent(where),
        "LIMIT 1"
      ])
    ])
  end

  defp compile_schema(%{fks: _, tables: _, columns: _} = schema) do
    schema
  end

  defp compile_schema(%SchemaLoader.Version{} = schema_version) do
    %{
      fks: FkGraph.for_schema(schema_version),
      tables: Map.keys(schema_version.tables),
      columns:
        Map.new(schema_version.tables, fn {name, table_schema} ->
          {name, Enum.map(table_schema.columns, & &1.name)}
        end)
    }
  end

  @doc """
  Generate SQL to install permissions-enforcing triggers in a SQLite database.

  When updating a client from some set of old permissions to some updated set, pass the old
  permissions as the first argument.

  This will generate some cleanup queries that will garbage collect locally defined roles.
  """
  @spec permissions_triggers(Permissions.t() | nil, Permissions.t(), SchemaLoader.Version.t()) ::
          String.t()
  def permissions_triggers(previous_perms \\ nil, perms, schema_version) do
    schema = compile_schema(schema_version)

    Enum.concat([
      create_local_tables(),
      clear_triggers_table(),
      permissions_cleanup(previous_perms, perms),
      table_triggers(perms, schema),
      assign_triggers(perms, schema)
    ])
    |> format()
  end

  defp table_triggers(perms, schema) do
    Stream.map(schema.tables, &table_triggers(&1, perms, schema))
  end

  defp table_triggers(table, perms, schema) do
    table_grants =
      perms.source.rules.grants
      |> Stream.map(&Permissions.Grant.new/1)
      # can remove these because if they exist they'll be hard-coded into the tests
      # and this list of grants is only used to test for local roles
      |> Stream.reject(&(&1.role in [:ANYONE, :AUTHENTICATED]))
      |> Enum.filter(&(&1.table == table))

    Stream.map([:INSERT, :UPDATE, :DELETE], fn action ->
      %{scoped: scoped, unscoped: unscoped} =
        Map.get(perms.roles, {table, action}, %{scoped: [], unscoped: []})

      scoped_grants =
        table_grants
        |> Enum.filter(&(&1.privilege == action))
        |> Enum.group_by(& &1.scope)

      {unscoped_grants, scoped_grants} = Map.pop(scoped_grants, nil, [])

      # if we have an unscoped role in our role grant list for this action (on this table)
      # then we have permission (if the column list and the where clause match)
      tests =
        Enum.concat([
          unscoped_trigger_tests(unscoped, unscoped_grants, perms, schema, table, action),
          scoped_trigger_tests(scoped, scoped_grants, perms, schema, table, action)
        ])

      trigger_conditional =
        case tests do
          [] ->
            nil

          [_ | _] ->
            lines([
              "NOT (",
              indent([
                "SELECT CASE",
                indent([
                  lines(Enum.map(tests, &when_/1)),
                  "ELSE FALSE"
                ]),
                "END"
              ]),
              ")"
            ])
        end

      additional_triggers =
        Enum.concat([
          scope_move_triggers(scoped, scoped_grants, perms, schema, table, action)
        ])

      lines([
        @dialect.create_trigger(
          table: table,
          event: action,
          condition: trigger_conditional,
          body:
            @dialect.rollback(
              "permissions: does not have matching #{action} permissions on #{@dialect.table(table)}"
            )
        )
        | additional_triggers
      ])
    end)
    |> Enum.concat(global_triggers(table, schema))
  end

  defp global_triggers(table, schema) do
    {:ok, pks} = pks(schema, table)

    trigger_name = @dialect.trigger_name(table, :UPDATE, ["protect_pk"])

    [
      @dialect.create_trigger(
        name: trigger_name,
        table: table,
        event: :UPDATE,
        of: pks,
        body:
          @dialect.rollback(
            "permissions: invalid update of primary key on #{@dialect.table(table)}"
          )
      )
    ]
  end

  defp scope_move_triggers([_ | _] = role_grants, grants, perms, schema, table, :UPDATE) do
    scope_groups = Enum.group_by(role_grants, & &1.grant.scope)

    perms_scopes =
      scope_groups
      |> MapSet.new(fn {k, _} -> k end)
      |> MapSet.union(MapSet.new(grants, fn {k, _} -> k end))

    {:ok, pks} = pks(schema, table)

    grants =
      perms.source.rules.grants
      |> Stream.map(&Permissions.Grant.new/1)
      |> Permissions.Grant.for_table(table)
      |> Permissions.Grant.for_privilege(:UPDATE)

    Enum.flat_map(perms_scopes, fn scope ->
      case FkGraph.fk_path(schema.fks, scope, table) do
        nil ->
          []

        [{_, {^table, fks}, _} | _] ->
          grants =
            grants
            |> Permissions.Grant.for_scope(scope)
            |> Enum.filter(fn
              %{columns: :all} ->
                true

              %{columns: columns} ->
                # unless the grant allows the update to all the fks columns then it can't allow the scope move
                Enum.all?(fks, &MapSet.member?(columns, &1))
            end)

          scope_cols =
            Enum.map(Enum.with_index(pks), fn {pk, i} ->
              "#{ref(scope, pk, @dialect)} AS #{pk_alias(i)}"
            end)

          scope_query =
            build_scope_query(
              schema,
              scope,
              table,
              fn col -> ["NEW.", quot(col)] end,
              lst(scope_cols, & &1)
            )

          local_roles = local_role_query_scoped(grants, scope, schema, :UPDATE)
          role_grants = Map.get(scope_groups, scope, [])

          tomb_scope_name = fn role ->
            "__tomb__#{role.assign_id}"
          end

          assigned_roles =
            Enum.map(role_grants, fn %{role: %{scope: {^scope, scope_id}} = role} ->
              lines([
                "((#{lst(scope_id, &val/1)}) = (SELECT #{scope_id |> Enum.with_index() |> lst(&pk_alias/1)} FROM __scope__))",
                "AND (#{json(role.id)} NOT IN (SELECT row_id FROM #{quot(tomb_scope_name.(role))}))"
              ])
            end)

          tombs =
            role_grants
            |> Enum.uniq_by(& &1.role.assign_id)
            |> Enum.map(fn %{role: role} ->
              lines([
                "#{quot(tomb_scope_name.(role))} AS (",
                indent([
                  "SELECT row_id FROM #{@dialect.table(local_roles_tombstone_table())} WHERE assign_id IS #{val(role.assign_id)}"
                ]),
                " )"
              ])
            end)

          guard =
            if Enum.empty?(local_roles) && Enum.empty?(assigned_roles) do
              []
            else
              lte =
                lines([
                  "WITH",
                  indent([
                    " __scope__ AS (",
                    indent([scope_query]),
                    "),"
                  ]),
                  indent(tombs),
                  "SELECT CASE",
                  indent(
                    Enum.concat([
                      Enum.map(assigned_roles, &when_/1),
                      Enum.map(local_roles, &when_/1),
                      ["ELSE FALSE"]
                    ])
                  ),
                  "END"
                ])

              lines([
                "NOT (",
                indent([lte]),
                ")"
              ])
            end

          trigger_name = trigger_name(table, :UPDATE, @dialect, ["scope_move"])

          [
            @dialect.create_trigger(
              name: trigger_name,
              table: table,
              event: :UPDATE,
              of: fks,
              condition: guard,
              body:
                @dialect.rollback(
                  "permissions: does not have matching UPDATE permissions in new scope on #{@dialect.table(table)}"
                )
            )
          ]
      end
    end)
  end

  defp scope_move_triggers(_scoped, _grants, _perms, _schema, _table, _action) do
    []
  end

  defp column_protection(base_test, grant, schema, table, action) do
    case grant.columns do
      :all ->
        [base_test]

      allowed_columns ->
        {:ok, columns} = cols(schema, table)

        disallowed_columns = Enum.reject(columns, &MapSet.member?(allowed_columns, &1))

        [
          lines([
            "(",
            indent([column_test(disallowed_columns, action)]),
            ") AND (",
            indent([base_test]),
            ")"
          ])
        ]
    end
  end

  defp column_test(disallowed_columns, :INSERT) do
    [
      disallowed_columns
      |> Enum.map(&"NEW.#{&1} IS NULL")
      |> and_()
    ]
  end

  defp column_test(disallowed_columns, :UPDATE) do
    lines(
      disallowed_columns
      |> Enum.map(&~s[NEW."#{&1}" IS OLD."#{&1}"])
      |> and_()
    )
  end

  defp unscoped_trigger_tests(role_grants, grants, perms, schema, table, action) do
    Stream.concat([
      Stream.map(role_grants, &unscoped_trigger_test(&1, perms, schema, table, action)),
      local_role_query_unscoped(grants, schema, table, action)
    ])
  end

  # TODO: where clause (for all)
  defp unscoped_trigger_test(%{role: %type{}} = role_grant, _perms, schema, table, action)
       when type in [Permissions.Role.Authenticated, Permissions.Role.Anyone] do
    lines([
      column_protection(
        ["TRUE"],
        role_grant.grant,
        schema,
        table,
        action
      )
    ])
  end

  defp unscoped_trigger_test(%{role: role} = role_grant, _perms, schema, table, action) do
    lines([
      column_protection(
        lines([
          "#{json(role.id)} NOT IN (",
          indent([
            "SELECT row_id FROM #{@dialect.table(local_roles_tombstone_table())} WHERE assign_id IS #{val(role.assign_id)}"
          ]),
          ")"
        ]),
        role_grant.grant,
        schema,
        table,
        action
      )
    ])
  end

  defp scoped_trigger_tests(role_grants, grants, perms, schema, table, action) do
    scope_groups = Enum.group_by(role_grants, & &1.grant.scope)

    scopes =
      scope_groups
      |> MapSet.new(fn {k, _} -> k end)
      |> MapSet.union(MapSet.new(grants, fn {k, _} -> k end))

    Enum.flat_map(scopes, fn scope ->
      prefix = assign_trigger_prefix(action)

      scope_query =
        build_scope_query(schema, scope, table, fn col -> [prefix, ".", quot(col)] end)

      cases =
        Stream.concat([
          scope_groups
          |> Map.get(scope, [])
          |> Enum.map(&scoped_trigger_test(&1, perms, schema, table, action)),
          grants
          |> Map.get(scope, [])
          |> local_role_query_scoped(scope, schema, action)
        ])

      [
        lines([
          "WITH __scope__ AS (",
          indent([scope_query]),
          ") SELECT CASE",
          indent(Enum.map(cases, &when_/1) ++ ["ELSE FALSE"]),
          "END"
        ])
      ]
    end)
  end

  # TODO: where clause (for all)
  defp scoped_trigger_test(role_grant, _perms, schema, table, action) do
    %{role: %{scope: {root, scope_id}} = role} = role_grant

    scope_cols = scope_cols(root, schema)

    [
      lines([
        "WITH __tomb__ AS (",
        indent([
          "SELECT row_id FROM #{@dialect.table(local_roles_tombstone_table())}",
          indent(["WHERE assign_id IS #{val(role.assign_id)}"])
        ]),
        ")",
        "SELECT (",
        indent([
          column_protection(
            lines([
              "(",
              indent([
                "(#{lst(scope_id, &val/1)}) = (SELECT #{lst(scope_cols, &quot/1)} FROM __scope__)",
                "AND (#{json(role.id)} NOT IN (SELECT row_id FROM __tomb__))"
              ]),
              ")"
            ]),
            role_grant.grant,
            schema,
            table,
            action
          )
        ]),
        ")"
      ])
    ]
  end

  defp pk_alias({_, i}) do
    pk_alias(i)
  end

  defp pk_alias(i) do
    "pk#{i}"
  end

  defp scope_cols(table, schema) do
    {:ok, pks} = pks(schema, table)

    pks
    |> Enum.with_index()
    |> Enum.map(&pk_alias/1)
  end

  defp local_role_query_scoped(grants, scope_table, schema, action) do
    cols = scope_cols(scope_table, schema)

    Enum.map(grants, fn grant ->
      column_protection(
        lines([
          "SELECT 1 FROM #{@dialect.table(local_roles_table())}",
          indent([
            "WHERE (scope = #{val(@dialect.table(scope_table, false))})",
            "AND (scope_id = (SELECT json_array(#{lst(cols, &quot/1)}) FROM __scope__))",
            "AND (role = #{val(grant.role)})"
          ])
        ]),
        grant,
        schema,
        grant.table,
        action
      )
    end)
  end

  defp local_role_query_unscoped(grants, schema, table, action) do
    Enum.map(grants, fn grant ->
      column_protection(
        lines([
          ["SELECT 1 FROM ", @dialect.table(local_roles_table())],
          indent([
            "WHERE (scope IS NULL) AND (role IS #{val(grant.role)})"
          ])
        ]),
        grant,
        schema,
        table,
        action
      )
    end)
  end

  defp create_local_tables do
    # replace with [proper migration](https://linear.app/electric-sql/issue/VAX-1385/internal-schema-migration-for-client-side-db-schema)
    # Not adding indexes for the roles table:
    # CREATE INDEX IF NOT EXISTS "#{@local_roles_table}_role_idx" ON "#{@local_roles_table}" (role);
    # CREATE INDEX IF NOT EXISTS "#{@local_roles_table}_scope_idx" ON "#{@local_roles_table}" (scope);
    # although those columns are used in the local role lookups because in all likelihood the
    # number of local roles will be very small (they only exist until the role addition comes back
    # again from pg)
    [
      """
      CREATE TABLE IF NOT EXISTS #{@dialect.table(local_roles_table())} (
          assign_id TEXT NOT NULL,
          row_id    TEXT NOT NULL,
          scope     TEXT,
          scope_id  TEXT,
          role      TEXT NOT NULL,
          PRIMARY KEY (assign_id, row_id)
      );

      CREATE TABLE IF NOT EXISTS #{@dialect.table(local_roles_tombstone_table())} (
          assign_id TEXT NOT NULL,
          row_id    TEXT NOT NULL,
          PRIMARY KEY (assign_id, row_id)
      );

      CREATE TABLE IF NOT EXISTS #{@dialect.table(triggers_and_functions_table())} (
          name    TEXT NOT NULL,
          type    TEXT NOT NULL,
          PRIMARY KEY (name, type)
      );
      """
    ]
  end

  defp clear_triggers_table do
    ["DELETE FROM #{@dialect.table(triggers_and_functions_table())};\n"]
  end

  defp permissions_cleanup(nil, _perms) do
    []
  end

  defp permissions_cleanup(old_perms, new_perms) do
    old_roles = MapSet.new(old_perms.source.roles, &role_id/1)
    new_roles = MapSet.new(new_perms.source.roles, &role_id/1)
    removed_roles = MapSet.difference(old_roles, new_roles)
    added_roles = MapSet.difference(new_roles, old_roles)

    Enum.concat([
      [
        "-- @permissions_cleanup BEGIN"
      ],
      # once a role has been removed, the new generated triggers will no longer include it
      # so we can remove the tombstone entries that were blocking it locally
      Enum.map(removed_roles, &cleanup_local_role(&1, local_roles_tombstone_table())),
      # once a role that was added locally makes the loop back and arrives in the defined
      # permissions then we can remove the local role entries that were granting access because
      # they're now encoded in the triggers
      Enum.map(added_roles, &cleanup_local_role(&1, local_roles_table())),
      [
        "-- @permissions_cleanup END"
      ]
    ])
  end

  defp role_id(role) do
    %{"assign_id" => role.assign_id, "row_id" => Jason.encode!(role.row_id)}
  end

  defp cleanup_local_role(role, table) do
    filter =
      Enum.map_join(role, " AND ", fn {col, val} ->
        "(#{col} = #{val(val)})"
      end)

    "DELETE FROM #{@dialect.table(table)} WHERE #{filter};"
  end

  defp assign_triggers(perms, schema) do
    Stream.flat_map(perms.source.rules.assigns, &assign_triggers(&1, perms, schema))
  end

  defp assign_triggers(assign, perms, schema) when not is_nil(perms.auth.user_id) do
    # FIXME: should only run when user id of membership table = ME
    user_id = perms.auth.user_id

    Enum.map([:INSERT, :UPDATE, :DELETE], fn action ->
      role =
        case assign.role_column do
          nil ->
            assign.role_name

          column ->
            ~s[#{assign_trigger_prefix(action)}."#{column}"]
        end

      body =
        case action do
          :INSERT ->
            [
              {
                [],
                lines([
                  "INSERT INTO #{@dialect.table(local_roles_table())}",
                  indent([
                    "(assign_id, row_id, scope, scope_id, role)"
                  ]),
                  "VALUES (",
                  indent([
                    "#{val(assign.id)},",
                    "#{assign_row_id(assign, schema, action)},",
                    "#{assign_scope(assign, schema, action)},",
                    "#{assign_scope_id(assign, schema, action)},",
                    "#{role}"
                  ]),
                  ");"
                ])
              }
            ]

          :DELETE ->
            existing_roles = Enum.filter(perms.source.roles, &(&1.assign_id == assign.id))

            guards =
              case existing_roles do
                [] ->
                  []

                existing_roles ->
                  {:ok, pks} = pks(schema, {assign.table.schema, assign.table.name})

                  Enum.map_join(existing_roles, " OR ", fn role ->
                    paren([
                      "json_array",
                      lst(pks, &"OLD.#{quot(&1)}") |> paren(),
                      " = ",
                      json(role.row_id)
                    ])
                  end)
                  |> paren()
                  |> IO.iodata_to_binary()
                  |> List.wrap()
              end

            [
              {
                [],
                lines([
                  "DELETE FROM #{@dialect.table(local_roles_table())}",
                  indent([
                    "WHERE assign_id IS #{val(assign.id)}",
                    indent([
                      "AND row_id IS #{assign_row_id(assign, schema, action)};"
                    ])
                  ])
                ])
              },
              {
                guards,
                lines([
                  "INSERT INTO #{@dialect.table(local_roles_tombstone_table())}",
                  indent(["(assign_id, row_id)"]),
                  "VALUES (",
                  indent([
                    "#{val(assign.id)},",
                    "#{assign_row_id(assign, schema, action)}"
                  ]),
                  ");"
                ])
              }
            ]

          :UPDATE ->
            case assign.role_column do
              nil ->
                []

              column ->
                [
                  {
                    [],
                    lines([
                      "UPDATE #{@dialect.table(local_roles_table())}",
                      indent([
                        "SET role = NEW.#{quot(column)}",
                        "WHERE assign_id IS #{val(assign.id)}",
                        indent([
                          "AND row_id IS #{assign_row_id(assign, schema, action)};"
                        ])
                      ])
                    ])
                  }
                ]
            end
        end

      body
      |> Enum.with_index()
      |> Enum.map(fn {{guards, stmt}, n} ->
        trigger_name = @dialect.trigger_name(assign.table, action, ["assign", assign.id, "#{n}"])

        when_guard =
          [
            "(#{assign_trigger_prefix(action)}.#{quot(assign.user_column)} IS #{val(user_id)})"
            | guards
          ]
          |> and_()

        @dialect.create_trigger(
          name: trigger_name,
          table: assign.table,
          event: action,
          condition: lines(["(", indent(when_guard), ")"]),
          body: stmt
        )
      end)
    end)
  end

  defp assign_triggers(_assign, _perms, _schema) do
    []
  end

  defp assign_row_id(assign, schema, action) do
    {:ok, pks} = pks(schema, assign.table.schema, assign.table.name)
    prefix = assign_trigger_prefix(action)
    pk_cols = lst(pks, &~s[#{prefix}."#{&1}"])

    ["json_array", paren(pk_cols)]
  end

  defp assign_scope(%{scope: nil} = _assign, _schema, _action) do
    "NULL"
  end

  defp assign_scope(assign, _schema, _action) do
    assign.scope
    |> @dialect.table(false)
    |> val()
  end

  defp assign_scope_id(%{scope: nil} = _assign, _schema, _action) do
    "NULL"
  end

  defp assign_scope_id(assign, schema, action) do
    %{
      table: %{schema: sname, name: tname},
      scope: %{schema: scope_schema, name: scope_table}
    } = assign

    scope = {scope_schema, scope_table}
    table = {sname, tname}

    prefix = assign_trigger_prefix(action)

    [{:many_to_one, {^table, fks}, _} | _] = FkGraph.fk_path(schema.fks, scope, table)

    fk_cols = lst(fks, &~s[#{prefix}."#{&1}"])

    ["json_array", paren(fk_cols)]
  end

  defp assign_trigger_prefix(action) do
    case action do
      :INSERT -> "NEW"
      :UPDATE -> "OLD"
      :DELETE -> "OLD"
    end
  end

  defp select_pk({_, _} = table, schema) do
    {:ok, pks} = pks(schema, table)

    pks
    |> Enum.with_index()
    |> lst(fn {pk, i} ->
      [ref(table, pk, @dialect), " AS ", pk_alias(i)]
    end)
  end

  defp pks(schema, sname, tname) do
    pks(schema, {sname, tname})
  end

  defp pks(schema, table) do
    FkGraph.primary_keys(schema.fks, table)
  end

  defp cols(schema, table) do
    Map.fetch(schema.columns, table)
  end
end
