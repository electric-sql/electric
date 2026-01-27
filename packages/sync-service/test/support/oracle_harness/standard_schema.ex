defmodule Support.OracleHarness.StandardSchema do
  @moduledoc """
  Standard 4-level hierarchy schema for OracleHarness testing.

  Supports testing subqueries up to 4 levels deep.

  ## Schema Structure

      level_1 (id, active)
          ├── level_1_tags (level_1_id, tag)
          └── level_2 (id, level_1_id, active)
                  ├── level_2_tags (level_2_id, tag)
                  └── level_3 (id, level_2_id, active)
                          ├── level_3_tags (level_3_id, tag)
                          └── level_4 (id, level_3_id, value)
  """

  alias Support.OracleHarness
  alias Support.OracleHarness.WhereClauseGenerator

  # Standard IDs for seeded data
  @level_1_ids Enum.map(1..5, &"l1-#{&1}")
  @level_2_ids Enum.map(1..5, &"l2-#{&1}")
  @level_3_ids Enum.map(1..5, &"l3-#{&1}")
  @level_4_ids Enum.map(1..20, &"l4-#{&1}")
  @tags ["alpha", "beta", "gamma", "delta"]

  # ----------------------------------------------------------------------------
  # Standard Schema
  # ----------------------------------------------------------------------------

  def schema_sql do
    [
      "DROP TABLE IF EXISTS level_4 CASCADE",
      "DROP TABLE IF EXISTS level_3_tags CASCADE",
      "DROP TABLE IF EXISTS level_3 CASCADE",
      "DROP TABLE IF EXISTS level_2_tags CASCADE",
      "DROP TABLE IF EXISTS level_2 CASCADE",
      "DROP TABLE IF EXISTS level_1_tags CASCADE",
      "DROP TABLE IF EXISTS level_1 CASCADE",
      """
      CREATE TABLE level_1 (
        id TEXT PRIMARY KEY,
        active BOOLEAN NOT NULL DEFAULT true
      )
      """,
      """
      CREATE TABLE level_1_tags (
        level_1_id TEXT NOT NULL REFERENCES level_1(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (level_1_id, tag)
      )
      """,
      """
      CREATE TABLE level_2 (
        id TEXT PRIMARY KEY,
        level_1_id TEXT NOT NULL REFERENCES level_1(id) ON DELETE CASCADE,
        active BOOLEAN NOT NULL DEFAULT true
      )
      """,
      """
      CREATE TABLE level_2_tags (
        level_2_id TEXT NOT NULL REFERENCES level_2(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (level_2_id, tag)
      )
      """,
      """
      CREATE TABLE level_3 (
        id TEXT PRIMARY KEY,
        level_2_id TEXT NOT NULL REFERENCES level_2(id) ON DELETE CASCADE,
        active BOOLEAN NOT NULL DEFAULT true
      )
      """,
      """
      CREATE TABLE level_3_tags (
        level_3_id TEXT NOT NULL REFERENCES level_3(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (level_3_id, tag)
      )
      """,
      """
      CREATE TABLE level_4 (
        id TEXT PRIMARY KEY,
        level_3_id TEXT NOT NULL REFERENCES level_3(id) ON DELETE CASCADE,
        value TEXT NOT NULL
      )
      """
    ]
  end

  def seed_sql do
    level_1_values =
      @level_1_ids
      |> Enum.with_index()
      |> Enum.map(fn {id, idx} -> "('#{id}', #{rem(idx, 2) == 0})" end)
      |> Enum.join(", ")

    level_2_values =
      for {l2_id, idx} <- Enum.with_index(@level_2_ids) do
        l1_id = Enum.at(@level_1_ids, rem(idx, length(@level_1_ids)))
        "('#{l2_id}', '#{l1_id}', #{rem(idx, 2) == 0})"
      end
      |> Enum.join(", ")

    level_3_values =
      for {l3_id, idx} <- Enum.with_index(@level_3_ids) do
        l2_id = Enum.at(@level_2_ids, rem(idx, length(@level_2_ids)))
        "('#{l3_id}', '#{l2_id}', #{rem(idx, 2) == 0})"
      end
      |> Enum.join(", ")

    level_4_values =
      for {l4_id, idx} <- Enum.with_index(@level_4_ids) do
        l3_id = Enum.at(@level_3_ids, rem(idx, length(@level_3_ids)))
        "('#{l4_id}', '#{l3_id}', 'v#{idx}')"
      end
      |> Enum.join(", ")

    # Tags: assign tags in a pattern so we get variety
    level_1_tag_values =
      for {l1_id, idx} <- Enum.with_index(@level_1_ids),
          tag <- Enum.take(@tags, rem(idx, length(@tags)) + 1) do
        "('#{l1_id}', '#{tag}')"
      end
      |> Enum.join(", ")

    level_2_tag_values =
      for {l2_id, idx} <- Enum.with_index(@level_2_ids),
          tag <- Enum.take(@tags, rem(idx, length(@tags)) + 1) do
        "('#{l2_id}', '#{tag}')"
      end
      |> Enum.join(", ")

    level_3_tag_values =
      for {l3_id, idx} <- Enum.with_index(@level_3_ids),
          tag <- Enum.take(@tags, rem(idx, length(@tags)) + 1) do
        "('#{l3_id}', '#{tag}')"
      end
      |> Enum.join(", ")

    [
      "INSERT INTO level_1 (id, active) VALUES #{level_1_values}",
      "INSERT INTO level_2 (id, level_1_id, active) VALUES #{level_2_values}",
      "INSERT INTO level_3 (id, level_2_id, active) VALUES #{level_3_values}",
      "INSERT INTO level_4 (id, level_3_id, value) VALUES #{level_4_values}",
      "INSERT INTO level_1_tags (level_1_id, tag) VALUES #{level_1_tag_values}",
      "INSERT INTO level_2_tags (level_2_id, tag) VALUES #{level_2_tag_values}",
      "INSERT INTO level_3_tags (level_3_id, tag) VALUES #{level_3_tag_values}"
    ]
  end

  def level_1_ids, do: @level_1_ids
  def level_2_ids, do: @level_2_ids
  def level_3_ids, do: @level_3_ids
  def level_4_ids, do: @level_4_ids
  def tags, do: @tags

  # ----------------------------------------------------------------------------
  # Setup and Reset
  # ----------------------------------------------------------------------------

  @doc """
  Sets up the standard schema and seeds it with data.
  Call this once before running tests.
  """
  def setup_standard_schema(ctx) do
    OracleHarness.apply_sql(ctx, schema_sql())
    OracleHarness.apply_sql(ctx, seed_sql())
    :ok
  end

  @doc """
  Resets the standard schema data to its initial seeded state.
  Faster than full schema recreation.
  """
  def reset_standard_data(ctx) do
    # Delete in reverse order of dependencies (avoid TRUNCATE which invalidates shapes via replication)
    OracleHarness.apply_sql(ctx, [
      "DELETE FROM level_4",
      "DELETE FROM level_3_tags",
      "DELETE FROM level_3",
      "DELETE FROM level_2_tags",
      "DELETE FROM level_2",
      "DELETE FROM level_1_tags",
      "DELETE FROM level_1"
    ])

    OracleHarness.apply_sql(ctx, seed_sql())
    :ok
  end

  # ----------------------------------------------------------------------------
  # Shape Generation
  # ----------------------------------------------------------------------------

  @doc """
  Generates a list of diverse shape specs using StreamData-based generator.

  This exercises the full range of SQL patterns supported by the parser including:
  - OR/AND combinations with subqueries
  - NOT patterns (NOT IN, NOT LIKE, NOT BETWEEN)
  - Comparison operators (<, >, <=, >=, <>)
  - BETWEEN/NOT BETWEEN
  - LIKE/NOT LIKE with various patterns
  - Nested subqueries (1-3 levels)
  - Tag-based subqueries
  - Mixed compositions

  Uses the provided seed for deterministic generation.
  """
  def generate_diverse_shapes(count, seed) do
    WhereClauseGenerator.generate_where_clauses(count, seed)
    |> Enum.with_index(1)
    |> Enum.map(fn {where_spec, idx} ->
      %{
        name: "shape_#{idx}",
        table: "level_4",
        where: where_spec.where,
        columns: ["id", "level_3_id", "value"],
        pk: ["id"],
        optimized: where_spec.optimized
      }
    end)
  end

  # ----------------------------------------------------------------------------
  # Mutation Generation
  # ----------------------------------------------------------------------------

  @doc """
  Generates a list of mutations to apply.
  """
  def generate_mutations(count, seed \\ nil) do
    :rand.seed(:exsss, seed || :erlang.monotonic_time())

    Enum.map(1..count, fn idx ->
      generate_one_mutation(idx)
    end)
  end

  defp generate_one_mutation(idx) do
    case rem(idx, 8) do
      0 -> toggle_level_1_active()
      1 -> toggle_level_2_active()
      2 -> toggle_level_3_active()
      3 -> move_level_2_parent()
      4 -> move_level_3_parent()
      5 -> move_level_4_parent()
      6 -> add_or_remove_tag()
      7 -> update_level_4_value()
    end
  end

  defp toggle_level_1_active do
    id = Enum.random(@level_1_ids)
    %{name: "toggle_l1_#{id}", sql: "UPDATE level_1 SET active = NOT active WHERE id = '#{id}'"}
  end

  defp toggle_level_2_active do
    id = Enum.random(@level_2_ids)
    %{name: "toggle_l2_#{id}", sql: "UPDATE level_2 SET active = NOT active WHERE id = '#{id}'"}
  end

  defp toggle_level_3_active do
    id = Enum.random(@level_3_ids)
    %{name: "toggle_l3_#{id}", sql: "UPDATE level_3 SET active = NOT active WHERE id = '#{id}'"}
  end

  defp move_level_2_parent do
    id = Enum.random(@level_2_ids)
    new_parent = Enum.random(@level_1_ids)

    %{
      name: "move_l2_#{id}_to_#{new_parent}",
      sql: "UPDATE level_2 SET level_1_id = '#{new_parent}' WHERE id = '#{id}'"
    }
  end

  defp move_level_3_parent do
    id = Enum.random(@level_3_ids)
    new_parent = Enum.random(@level_2_ids)

    %{
      name: "move_l3_#{id}_to_#{new_parent}",
      sql: "UPDATE level_3 SET level_2_id = '#{new_parent}' WHERE id = '#{id}'"
    }
  end

  defp move_level_4_parent do
    id = Enum.random(@level_4_ids)
    new_parent = Enum.random(@level_3_ids)

    %{
      name: "move_l4_#{id}_to_#{new_parent}",
      sql: "UPDATE level_4 SET level_3_id = '#{new_parent}' WHERE id = '#{id}'"
    }
  end

  defp add_or_remove_tag do
    level = :rand.uniform(3)
    tag = Enum.random(@tags)

    case level do
      1 ->
        id = Enum.random(@level_1_ids)

        if :rand.uniform(2) == 1 do
          %{
            name: "add_tag_l1_#{id}_#{tag}",
            sql:
              "INSERT INTO level_1_tags (level_1_id, tag) VALUES ('#{id}', '#{tag}') ON CONFLICT DO NOTHING"
          }
        else
          %{
            name: "remove_tag_l1_#{id}_#{tag}",
            sql: "DELETE FROM level_1_tags WHERE level_1_id = '#{id}' AND tag = '#{tag}'"
          }
        end

      2 ->
        id = Enum.random(@level_2_ids)

        if :rand.uniform(2) == 1 do
          %{
            name: "add_tag_l2_#{id}_#{tag}",
            sql:
              "INSERT INTO level_2_tags (level_2_id, tag) VALUES ('#{id}', '#{tag}') ON CONFLICT DO NOTHING"
          }
        else
          %{
            name: "remove_tag_l2_#{id}_#{tag}",
            sql: "DELETE FROM level_2_tags WHERE level_2_id = '#{id}' AND tag = '#{tag}'"
          }
        end

      3 ->
        id = Enum.random(@level_3_ids)

        if :rand.uniform(2) == 1 do
          %{
            name: "add_tag_l3_#{id}_#{tag}",
            sql:
              "INSERT INTO level_3_tags (level_3_id, tag) VALUES ('#{id}', '#{tag}') ON CONFLICT DO NOTHING"
          }
        else
          %{
            name: "remove_tag_l3_#{id}_#{tag}",
            sql: "DELETE FROM level_3_tags WHERE level_3_id = '#{id}' AND tag = '#{tag}'"
          }
        end
    end
  end

  defp update_level_4_value do
    id = Enum.random(@level_4_ids)
    new_value = "v#{:rand.uniform(1000)}"

    %{
      name: "update_l4_#{id}",
      sql: "UPDATE level_4 SET value = '#{new_value}' WHERE id = '#{id}'"
    }
  end
end
