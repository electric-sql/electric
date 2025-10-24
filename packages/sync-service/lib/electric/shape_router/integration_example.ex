defmodule Electric.ShapeRouter.IntegrationExample do
  @moduledoc """
  Example integration of ShapeRouter with Electric's existing architecture.

  This shows how the new router would replace/augment the current
  `Electric.Shapes.Filter` implementation.
  """

  alias Electric.ShapeRouter
  alias Electric.Shapes.Shape
  alias Electric.Replication.Changes

  @doc """
  Example: Replace Filter.affected_shapes/2 with ShapeRouter

  Current (Electric.Shapes.Filter):
    affected_shapes(table, changes) -> [shapes]

  New (Electric.ShapeRouter):
    route(router, wal_change) -> [shape_ids]
  """
  def route_wal_change_example do
    # Setup: Create router for (tenant, table)
    {:ok, router} = ShapeRouter.new("tenant_1", "todos")

    # Register shapes
    # Shape 1: User-specific todos
    ShapeRouter.add_shape(
      router,
      1,
      "user_id = 123",
      [1, 2, 3, 10, 11, 12]  # Initial PKs
    )

    # Shape 2: Active todos
    ShapeRouter.add_shape(
      router,
      2,
      "status IN (1, 2)",
      [1, 5, 6, 10, 15]
    )

    # Shape 3: Priority todos
    ShapeRouter.add_shape(
      router,
      3,
      "priority = 1",
      [1, 7, 8, 9]
    )

    # Route an INSERT operation
    insert_change = %{
      pk: 42,
      new_record: %{
        id: 42,
        user_id: 123,
        status: 1,
        priority: 1,
        title: "New todo"
      },
      changed_columns: []  # All columns for INSERT
    }

    # This operation matches shapes 1, 2, and 3
    matched = ShapeRouter.route(router, insert_change)
    # => [1, 2, 3]

    # Route an UPDATE operation (status change)
    update_change = %{
      pk: 10,
      old_record: %{id: 10, user_id: 123, status: 1, priority: 0},
      new_record: %{id: 10, user_id: 123, status: 2, priority: 0},
      changed_columns: [2]  # status column
    }

    matched = ShapeRouter.route(router, update_change)
    # => [1, 2]  # Still matches user_id and status conditions

    # Route a DELETE operation
    delete_change = %{
      pk: 10,
      old_record: %{id: 10, user_id: 123, status: 2, priority: 0},
      changed_columns: []
    }

    matched = ShapeRouter.route(router, delete_change)
    # => [1, 2]  # Shapes need to know about the deletion

    {:ok, router, matched}
  end

  @doc """
  Integration point 1: ShapeLogCollector

  Modify Electric.Replication.ShapeLogCollector to use ShapeRouter
  instead of Filter.affected_shapes/2
  """
  def integrate_with_shape_log_collector do
    # Pseudo-code showing integration

    quote do
      defmodule Electric.Replication.ShapeLogCollector do
        # Add router registry
        @routers :persistent_term.get(:shape_routers, %{})

        def handle_transaction(xid, changes) do
          # Group changes by (tenant, table)
          changes_by_table = Enum.group_by(changes, &{&1.tenant, &1.table})

          Enum.flat_map(changes_by_table, fn {{tenant, table}, table_changes} ->
            # Get or create router for this (tenant, table)
            router = get_or_create_router(tenant, table)

            # Route each change
            Enum.flat_map(table_changes, fn change ->
              shape_ids = ShapeRouter.route(router, change)

              # Convert to consumer messages
              Enum.map(shape_ids, fn shape_id ->
                {shape_id, change}
              end)
            end)
          end)
        end

        defp get_or_create_router(tenant, table) do
          key = {tenant, table}

          case Map.get(@routers, key) do
            nil ->
              {:ok, router} = ShapeRouter.new(tenant, table)
              :persistent_term.put(:shape_routers, Map.put(@routers, key, router))
              router

            router ->
              router
          end
        end
      end
    end
  end

  @doc """
  Integration point 2: Shape lifecycle

  When shapes are created/deleted, update the router
  """
  def integrate_with_shape_lifecycle do
    quote do
      defmodule Electric.ShapeCache do
        def create_shape(shape_def) do
          # ... existing shape creation logic ...

          # Register with router
          router = get_router(shape_def.root_table)
          where_clause = shape_def.where

          # Get initial PKs that match this shape
          initial_pks = query_initial_pks(shape_def)

          ShapeRouter.add_shape(
            router,
            shape_def.shape_id,
            where_clause,
            initial_pks
          )

          # ... continue with existing logic ...
        end

        def delete_shape(shape_id) do
          # ... existing deletion logic ...

          # Unregister from router
          router = get_router(shape.root_table)
          ShapeRouter.remove_shape(router, shape_id)

          # Trigger rebuild if needed
          maybe_trigger_rebuild(router)
        end

        defp maybe_trigger_rebuild(router) do
          metrics = ShapeRouter.metrics(router)

          # Rebuild if delta overlay is too large
          if metrics["delta_size"] > metrics["base_size"] * 0.05 do
            ShapeRouter.rebuild(router)
          end
        end
      end
    end
  end

  @doc """
  Integration point 3: WHERE clause compilation

  Use pg_query_ex to parse WHERE clauses and compile to router format
  """
  def compile_where_clause_with_pg_query(where_clause, schema) do
    # Parse WHERE clause using pg_query_ex
    case PgQuery.parse("SELECT * FROM table WHERE #{where_clause}") do
      {:ok, parsed} ->
        # Extract WHERE clause from parse tree
        where_tree = extract_where_clause(parsed)

        # Compile to predicate bytecode
        compile_to_bytecode(where_tree, schema)

      {:error, reason} ->
        {:error, {:invalid_where_clause, reason}}
    end
  end

  defp extract_where_clause(%{"stmts" => [%{"stmt" => %{"SelectStmt" => select}}]}) do
    select["whereClause"]
  end

  defp compile_to_bytecode(where_tree, schema) do
    # This would be a full compiler from PostgreSQL parse tree to bytecode
    # For prototype, we simplified to basic operations

    # Example compilation:
    # WHERE user_id = 123 AND status IN (1, 2)
    # Compiles to:
    # [
    #   {:load_column, :user_id},
    #   {:push_const, 123},
    #   {:eq},
    #   {:load_column, :status},
    #   {:push_const_set, [1, 2]},
    #   {:in},
    #   {:and},
    #   {:return}
    # ]

    bytecode = compile_expression(where_tree, schema)
    {:ok, bytecode}
  end

  defp compile_expression(nil, _schema), do: [{:push_true}, {:return}]

  defp compile_expression(%{"A_Expr" => expr}, schema) do
    # Compile binary expressions (=, <, >, etc.)
    compile_binary_expr(expr, schema)
  end

  defp compile_expression(%{"BoolExpr" => bool_expr}, schema) do
    # Compile AND/OR/NOT expressions
    compile_bool_expr(bool_expr, schema)
  end

  defp compile_expression(_expr, _schema) do
    # Fallback for unsupported expressions
    [{:push_true}, {:return}]
  end

  defp compile_binary_expr(_expr, _schema) do
    # Simplified - real implementation would handle all PostgreSQL operators
    []
  end

  defp compile_bool_expr(_expr, _schema) do
    # Simplified - real implementation would handle AND/OR/NOT
    []
  end

  @doc """
  Integration point 4: Observability

  Export router metrics to Electric's telemetry system
  """
  def integrate_observability do
    quote do
      defmodule Electric.ShapeRouter.Telemetry do
        def report_metrics do
          # Get all routers
          routers = :persistent_term.get(:shape_routers, %{})

          Enum.each(routers, fn {{tenant, table}, router} ->
            metrics = ShapeRouter.metrics(router)

            # Emit telemetry events
            :telemetry.execute(
              [:electric, :shape_router, :metrics],
              %{
                avg_route_us: metrics["avg_route_us"],
                presence_hit_rate: metrics["presence_hit_rate"],
                false_positive_rate: metrics["false_positive_rate"],
                route_calls: metrics["route_calls"]
              },
              %{tenant: tenant, table: table}
            )
          end)
        end

        def setup_periodic_reporting do
          # Report metrics every 60 seconds
          :timer.send_interval(60_000, self(), :report_router_metrics)
        end
      end
    end
  end

  @doc """
  Full integration example: Process a WAL transaction
  """
  def full_integration_example do
    # 1. Setup phase (on Electric startup)
    setup_routers()

    # 2. WAL transaction arrives
    transaction = %{
      xid: 12345,
      changes: [
        %Changes.NewRecord{
          relation: {"public", "todos"},
          record: %{id: 100, user_id: 5, status: 1, title: "Test"}
        },
        %Changes.UpdatedRecord{
          relation: {"public", "todos"},
          old_record: %{id: 50, user_id: 5, status: 1},
          record: %{id: 50, user_id: 5, status: 2},
          changed_columns: ["status"]
        }
      ]
    }

    # 3. Route changes to shapes
    route_transaction(transaction)
  end

  defp setup_routers do
    # Create routers for common tables
    {:ok, todos_router} = ShapeRouter.new("public", "todos")

    # Register existing shapes
    # (In production, load from ShapeCache)
    ShapeRouter.add_shape(todos_router, 1, "user_id = 5", [50, 51, 52])
    ShapeRouter.add_shape(todos_router, 2, "status = 1", [100, 101, 102])

    # Store in registry
    :persistent_term.put(:shape_routers, %{
      {"public", "todos"} => todos_router
    })
  end

  defp route_transaction(transaction) do
    Enum.flat_map(transaction.changes, fn change ->
      {schema, table} = change.relation
      router = get_router(schema, table)

      # Convert Change to ShapeRouter format
      wal_op = %{
        pk: change.record.id,
        old_record: Map.get(change, :old_record),
        new_record: change.record,
        changed_columns: map_changed_columns(Map.get(change, :changed_columns, []))
      }

      # Route to shapes
      shape_ids = ShapeRouter.route(router, wal_op)

      # Return (shape_id, change) pairs
      Enum.map(shape_ids, fn shape_id ->
        {shape_id, change}
      end)
    end)
  end

  defp get_router(schema, table) do
    routers = :persistent_term.get(:shape_routers, %{})
    Map.get(routers, {schema, table})
  end

  defp map_changed_columns(column_names) do
    # Map column names to column IDs
    # In production, use schema registry
    Enum.map(column_names, fn name ->
      case name do
        "id" -> 0
        "user_id" -> 1
        "status" -> 2
        "title" -> 3
        _ -> 99  # Unknown column
      end
    end)
  end
end
