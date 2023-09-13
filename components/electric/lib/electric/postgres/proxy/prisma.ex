defmodule Electric.Postgres.Proxy.Prisma do
  defstruct server_version: {"14.9", 140_009}

  @type t() :: %__MODULE__{server_version: {binary(), integer()}}

  alias Electric.Postgres.Proxy.Injector

  def parse_query("SELECT version()" <> _rest) do
    {:ok, Electric.Postgres.Proxy.Prisma.Query.VersionV5_2}
  end

  def parse_query(sql) do
    with [stmt] <- Electric.Postgres.parse!(sql) do
      analyse_stmt(stmt)
    end
  end

  defp analyse_stmt(%PgQuery.SelectStmt{} = stmt) do
    case target_list_names(stmt) do
      ["", "", "numeric_version"] ->
        {:ok, Electric.Postgres.Proxy.Prisma.Query.NamespaceVersionV5_2}

      ["namespace_name"] ->
        {:ok, Electric.Postgres.Proxy.Prisma.Query.NamespaceV5_2}

      [
        "table_name",
        "namespace",
        "is_partition",
        "has_subclass",
        "has_row_level_security",
        "reloptions",
        "description"
      ] ->
        {:ok, Electric.Postgres.Proxy.Prisma.Query.TableV5_2}

      [
        "namespace",
        "table_name",
        "constraint_name",
        "constraint_type",
        "constraint_definition",
        "is_deferrable",
        "is_deferred"
      ] ->
        {:ok, Electric.Postgres.Proxy.Prisma.Query.ConstraintV5_2}

      ["view_name", "view_sql", "namespace", "description"] ->
        {:ok, Electric.Postgres.Proxy.Prisma.Query.ViewV5_2}

      ["name", "value", "namespace", "description"] ->
        {:ok, Electric.Postgres.Proxy.Prisma.Query.TypeV5_2}

      [
        "oid.namespace",
        "info.table_name",
        "info.column_name",
        "formatted_type",
        "info.numeric_precision",
        "info.numeric_scale",
        "info.numeric_precision_radix",
        "info.datetime_precision",
        "info.data_type",
        "type_schema_name",
        "full_data_type",
        "column_default",
        "info.is_nullable",
        "info.is_identity",
        "info.character_maximum_length",
        "description"
      ] ->
        {:ok, Electric.Postgres.Proxy.Prisma.Query.ColumnV5_2}

      [
        "con_id",
        "child_column",
        "parent_table",
        "parent_column",
        "con.confdeltype",
        "con.confupdtype",
        "referenced_schema_name",
        "constraint_name",
        "child",
        "parent",
        "table_name",
        "namespace",
        "condeferrable",
        "condeferred"
      ] ->
        {:ok, Electric.Postgres.Proxy.Prisma.Query.ForeignKeyV5_2}

      [
        "namespace",
        "index_name",
        "table_name",
        "column_name",
        "is_unique",
        "is_primary_key",
        "column_index",
        "opclass",
        "opcdefault",
        "index_algo",
        "column_order",
        "nulls_first",
        "condeferrable",
        "condeferred"
      ] ->
        {:ok, Electric.Postgres.Proxy.Prisma.Query.IndexV5_2}

      ["name", "namespace", "definition"] ->
        {:ok, Electric.Postgres.Proxy.Prisma.Query.FunctionV5_2}

      ["extension_name", "extension_version", "extension_relocatable", "extension_schema"] ->
        {:ok, Electric.Postgres.Proxy.Prisma.Query.ExtensionV5_2}

      [
        "sequence_name",
        "namespace",
        "",
        "min_value",
        "max_value",
        "increment_by",
        "cycle",
        "cache_size"
      ] ->
        {:ok, Electric.Postgres.Proxy.Prisma.Query.SequenceV5_2}
    end
  end

  defp target_list_names(%{target_list: target_list}) do
    Enum.map(target_list, fn
      %{node: {:res_target, %{name: "", val: %{node: {:column_ref, %{fields: fields}}}}}} ->
        Enum.map(fields, fn %{node: {:string, %{sval: s}}} -> s end) |> Enum.join(".")

      %{node: {:res_target, %{name: name}}} ->
        name
    end)
  end

  defmacro i32 do
    quote do: integer - signed - big - 32
  end

  # the only array params used are to hold the list of schemas
  # which is a 1-dimensional array of type 19 (name)
  # it looks like this:
  # <<
  #   0, 0, 0, 1,  # dimensions
  #   0, 0, 0, 0,  # null bitmap
  #   0, 0, 0, 19, # type of elements
  #   0, 0, 0, 1,  # size of 1st dimension
  #   0, 0, 0, 1,  # starting index first dimension
  #   0, 0, 0, 6,  # length of 1st element
  #   112, 117, 98, 108, 105, 99 # data for 1st element
  # >>
  def parse_bind_array(encoded_array) do
    case encoded_array do
      <<
        1::i32(),
        0::i32(),
        19::i32(),
        1::i32(),
        1::i32(),
        len::i32(),
        value::binary-size(len)
      >> ->
        [value]
    end
  end

  def injector(config, opts \\ []) do
    capture = {Injector.Capture.Prisma, config: config}

    Injector.new(Keyword.merge(opts, capture_mode: [default: capture]),
      username: "username",
      database: "database"
    )
  end
end
