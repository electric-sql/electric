defprotocol Electric.Postgres.Schema.Catalog do
  @fallback_to_any true
  # @type name :: %AST.Relation{} | binary
  def rename_column(t, oldname, newname)
  # column in another table has been renamed
  def rename_column(t, table_name, oldname, newname)
  def rename_table(t, oldname, newname)
  def depends_on_column?(t, column_name)
  # version for foreign keys
  # @spec depends_on_column?(t, name, binary) :: [binary]
  def depends_on_column?(t, table_name, column_name)
  def depends_on_table?(t, table_name)
  def depends_on_constraint?(c, table_name, columns)
  # gives list of columns included in constraint
  # @spec columns(t) :: [binary]
  def keys(t)
  # columns + included
  # def all_columns(t)
end

alias Electric.Postgres.Schema.Catalog

defimpl Catalog, for: Any do
  def rename_column(c, _oldname, _newname) do
    c
  end

  def rename_column(c, _table_name, _oldname, _newname) do
    c
  end

  def rename_table(c, _oldname, _newname) do
    c
  end

  def depends_on_column?(_c, _name) do
    false
  end

  def depends_on_column?(_c, _table_name, _column_name) do
    false
  end

  def depends_on_table?(_c, _table_name) do
    false
  end

  def depends_on_constraint?(_c, _table_name, _columns) do
    false
  end

  def keys(_c) do
    []
  end
end

defimpl Catalog, for: Tuple do
  def rename_column({tag, struct}, oldname, newname) when is_struct(struct) do
    {tag, Catalog.rename_column(struct, oldname, newname)}
  end

  def rename_column({tag, struct}, table_name, oldname, newname) when is_struct(struct) do
    {tag, Catalog.rename_column(struct, table_name, oldname, newname)}
  end

  def rename_table({tag, struct}, oldname, newname) do
    {tag, Catalog.rename_table(struct, oldname, newname)}
  end

  def depends_on_column?({_tag, struct}, name) do
    Catalog.depends_on_column?(struct, name)
  end

  def depends_on_column?({_tag, struct}, table_name, column_name) do
    Catalog.depends_on_column?(struct, table_name, column_name)
  end

  def depends_on_table?({_tag, struct}, table_name) do
    Catalog.depends_on_table?(struct, table_name)
  end

  def depends_on_constraint?({_tag, struct}, table_name, columns) do
    Catalog.depends_on_constraint?(struct, table_name, columns)
  end

  def keys({_tag, struct}) do
    Catalog.keys(struct)
  end
end
