defmodule Support.StubInspector do
  alias Electric.Utils
  @behaviour Electric.Postgres.Inspector

  def new(opts), do: {__MODULE__, opts}

  @impl true
  def load_column_info(_relation, column_list) when is_list(column_list) do
    column_list
    |> Enum.map(fn column ->
      column
      |> Map.put_new(:pk_position, nil)
      |> Map.put_new(:type, "text")
      |> Map.put_new(:type_id, {25, -1})
    end)
    |> then(&{:ok, &1})
  end

  def load_column_info(relation, opts) when is_map(opts) and is_map_key(opts, relation) do
    opts
    |> Map.fetch!(relation)
    |> then(&load_column_info(relation, &1))
  end

  @impl true
  def load_relation(table, _) do
    regex =
      ~r/^((?<schema>([\p{L}_][\p{L}0-9_$]*|"(""|[^"])+"))\.)?(?<table>([\p{L}_][\p{L}0-9_$]*|"(""|[^"])+"))$/u

    case Regex.run(regex, table, capture: :all_names) do
      ["", table_name] when table_name != "" ->
        table_name = Utils.parse_quoted_name(table_name)
        rel = {"public", table_name}
        {:ok, %{relation: rel, relation_id: :erlang.phash2(rel)}}

      [schema_name, table_name] when table_name != "" ->
        schema_name = Utils.parse_quoted_name(schema_name)
        table_name = Utils.parse_quoted_name(table_name)
        rel = {schema_name, table_name}
        {:ok, %{relation: rel, relation_id: :erlang.phash2(rel)}}

      _ ->
        {:error, "invalid name syntax"}
    end
  end

  @impl true
  def clean_column_info(_, _), do: true

  @impl true
  def clean_relation(_, _), do: true

  @impl true
  def clean(_, _), do: true
end
