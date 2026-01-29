defmodule Electric.Integration.OracleViewTest do
  @moduledoc """
  Hand-written oracle tests using the standard schema.

  These tests verify specific scenarios with explicit shapes and mutations
  to ensure coverage of important edge cases.

  Run with: mix test --include oracle
  """

  use ExUnit.Case, async: false

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.IntegrationSetup
  import Support.OracleHarness
  import Support.OracleHarness.StandardSchema

  @moduletag :oracle
  @moduletag timeout: :infinity
  @moduletag :tmp_dir

  setup [:with_unique_db]
  setup :with_complete_stack
  setup :with_electric_client

  setup ctx do
    setup_standard_schema(ctx)
    :ok
  end

  describe "simple where clauses" do
    test "equality on parent_id", ctx do
      shapes = [
        %{
          name: "l4_by_l3",
          table: "level_4",
          where: "level_3_id = 'l3-1'",
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: true
        }
      ]

      mutations = [
        %{name: "update_value", sql: "UPDATE level_4 SET value = 'updated' WHERE id = 'l4-1'"},
        %{name: "move_out", sql: "UPDATE level_4 SET level_3_id = 'l3-2' WHERE id = 'l4-1'"},
        %{name: "move_in", sql: "UPDATE level_4 SET level_3_id = 'l3-1' WHERE id = 'l4-6'"}
      ]

      test_against_oracle(ctx, shapes, mutations)
    end
  end

  describe "1-level subqueries" do
    test "IN subquery on active parent", ctx do
      shapes = [
        %{
          name: "active_l3_children",
          table: "level_4",
          where: "level_3_id IN (SELECT id FROM level_3 WHERE active = true)",
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: false
        }
      ]

      mutations = [
        %{name: "noop_toggle", sql: "UPDATE level_3 SET active = false WHERE id = 'l3-2'"},
        %{name: "deactivate_l3", sql: "UPDATE level_3 SET active = false WHERE id = 'l3-1'"},
        %{name: "activate_l3", sql: "UPDATE level_3 SET active = true WHERE id = 'l3-2'"},
        %{name: "update_child", sql: "UPDATE level_4 SET value = 'changed' WHERE id = 'l4-2'"},
        %{name: "move_child", sql: "UPDATE level_4 SET level_3_id = 'l3-3' WHERE id = 'l4-1'"}
      ]

      test_against_oracle(ctx, shapes, mutations)
    end

    test "IN subquery on specific grandparent", ctx do
      shapes = [
        %{
          name: "l2_1_descendants",
          table: "level_4",
          where: "level_3_id IN (SELECT id FROM level_3 WHERE level_2_id = 'l2-1')",
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: false
        }
      ]

      mutations = [
        %{name: "move_l3_out", sql: "UPDATE level_3 SET level_2_id = 'l2-2' WHERE id = 'l3-1'"},
        %{name: "move_l3_in", sql: "UPDATE level_3 SET level_2_id = 'l2-1' WHERE id = 'l3-2'"},
        %{name: "move_l4", sql: "UPDATE level_4 SET level_3_id = 'l3-3' WHERE id = 'l4-1'"}
      ]

      test_against_oracle(ctx, shapes, mutations)
    end
  end

  describe "2-level subqueries" do
    test "nested active flags", ctx do
      shapes = [
        %{
          name: "active_l2_l3_children",
          table: "level_4",
          where:
            "level_3_id IN (SELECT id FROM level_3 WHERE active = true AND level_2_id IN (SELECT id FROM level_2 WHERE active = true))",
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: false
        }
      ]

      mutations = [
        %{name: "toggle_l2", sql: "UPDATE level_2 SET active = NOT active WHERE id = 'l2-1'"},
        %{name: "toggle_l3", sql: "UPDATE level_3 SET active = NOT active WHERE id = 'l3-1'"},
        %{name: "move_l3", sql: "UPDATE level_3 SET level_2_id = 'l2-3' WHERE id = 'l3-1'"},
        %{name: "move_l4", sql: "UPDATE level_4 SET level_3_id = 'l3-4' WHERE id = 'l4-1'"}
      ]

      test_against_oracle(ctx, shapes, mutations)
    end

    test "through specific level_1", ctx do
      shapes = [
        %{
          name: "l1_1_descendants",
          table: "level_4",
          where:
            "level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id = 'l1-1'))",
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: false
        }
      ]

      mutations = [
        %{name: "move_l2", sql: "UPDATE level_2 SET level_1_id = 'l1-2' WHERE id = 'l2-1'"},
        %{name: "move_l3", sql: "UPDATE level_3 SET level_2_id = 'l2-3' WHERE id = 'l3-1'"},
        %{name: "move_l4", sql: "UPDATE level_4 SET level_3_id = 'l3-3' WHERE id = 'l4-1'"}
      ]

      test_against_oracle(ctx, shapes, mutations)
    end
  end

  describe "3-level subqueries" do
    test "through active level_1", ctx do
      shapes = [
        %{
          name: "active_l1_descendants",
          table: "level_4",
          where:
            "level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id IN (SELECT id FROM level_1 WHERE active = true)))",
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: false
        }
      ]

      mutations = [
        %{name: "toggle_l1_1", sql: "UPDATE level_1 SET active = NOT active WHERE id = 'l1-1'"},
        %{name: "toggle_l1_2", sql: "UPDATE level_1 SET active = NOT active WHERE id = 'l1-2'"},
        %{name: "move_l2", sql: "UPDATE level_2 SET level_1_id = 'l1-3' WHERE id = 'l2-1'"},
        %{name: "move_l3", sql: "UPDATE level_3 SET level_2_id = 'l2-4' WHERE id = 'l3-1'"},
        %{name: "update_l4", sql: "UPDATE level_4 SET value = 'new' WHERE id = 'l4-1'"}
      ]

      test_against_oracle(ctx, shapes, mutations)
    end
  end

  describe "tag-based subqueries" do
    test "1-level tag filter", ctx do
      shapes = [
        %{
          name: "alpha_l3_children",
          table: "level_4",
          where:
            "level_3_id IN (SELECT id FROM level_3 WHERE id IN (SELECT level_3_id FROM level_3_tags WHERE tag = 'alpha'))",
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: false
        }
      ]

      mutations = [
        %{
          name: "add_alpha_tag",
          sql:
            "INSERT INTO level_3_tags (level_3_id, tag) VALUES ('l3-2', 'alpha') ON CONFLICT DO NOTHING"
        },
        %{
          name: "remove_alpha_tag",
          sql: "DELETE FROM level_3_tags WHERE level_3_id = 'l3-1' AND tag = 'alpha'"
        },
        %{name: "move_l4", sql: "UPDATE level_4 SET level_3_id = 'l3-3' WHERE id = 'l4-1'"}
      ]

      test_against_oracle(ctx, shapes, mutations)
    end

    test "2-level tag filter through level_2", ctx do
      shapes = [
        %{
          name: "beta_l2_descendants",
          table: "level_4",
          where:
            "level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE id IN (SELECT level_2_id FROM level_2_tags WHERE tag = 'beta')))",
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: false
        }
      ]

      mutations = [
        %{
          name: "add_beta_tag",
          sql:
            "INSERT INTO level_2_tags (level_2_id, tag) VALUES ('l2-3', 'beta') ON CONFLICT DO NOTHING"
        },
        %{
          name: "remove_beta_tag",
          sql: "DELETE FROM level_2_tags WHERE level_2_id = 'l2-2' AND tag = 'beta'"
        },
        %{name: "move_l3", sql: "UPDATE level_3 SET level_2_id = 'l2-4' WHERE id = 'l3-1'"}
      ]

      test_against_oracle(ctx, shapes, mutations)
    end

    test "3-level tag filter through level_1", ctx do
      shapes = [
        %{
          name: "gamma_l1_descendants",
          table: "level_4",
          where:
            "level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id IN (SELECT id FROM level_1 WHERE id IN (SELECT level_1_id FROM level_1_tags WHERE tag = 'gamma'))))",
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: false
        }
      ]

      mutations = [
        %{
          name: "add_gamma_tag",
          sql:
            "INSERT INTO level_1_tags (level_1_id, tag) VALUES ('l1-2', 'gamma') ON CONFLICT DO NOTHING"
        },
        %{
          name: "remove_gamma_tag",
          sql: "DELETE FROM level_1_tags WHERE level_1_id = 'l1-3' AND tag = 'gamma'"
        },
        %{name: "move_l2", sql: "UPDATE level_2 SET level_1_id = 'l1-4' WHERE id = 'l2-1'"}
      ]

      test_against_oracle(ctx, shapes, mutations)
    end
  end

  describe "multiple parallel shapes" do
    test "same mutation affects different shapes differently", ctx do
      shapes = [
        %{
          name: "l3_1_children",
          table: "level_4",
          where: "level_3_id = 'l3-1'",
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: true
        },
        %{
          name: "l3_2_children",
          table: "level_4",
          where: "level_3_id = 'l3-2'",
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: true
        },
        %{
          name: "active_l3_children",
          table: "level_4",
          where: "level_3_id IN (SELECT id FROM level_3 WHERE active = true)",
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: false
        }
      ]

      mutations = [
        # This moves l4-1 from l3-1 to l3-2, affecting first two shapes
        %{name: "move_l4_1", sql: "UPDATE level_4 SET level_3_id = 'l3-2' WHERE id = 'l4-1'"},
        # This affects the subquery shape by changing which l3s are active
        %{name: "toggle_l3_1", sql: "UPDATE level_3 SET active = NOT active WHERE id = 'l3-1'"},
        # Move it back
        %{name: "move_l4_1_back", sql: "UPDATE level_4 SET level_3_id = 'l3-1' WHERE id = 'l4-1'"}
      ]

      test_against_oracle(ctx, shapes, mutations)
    end
  end
end
