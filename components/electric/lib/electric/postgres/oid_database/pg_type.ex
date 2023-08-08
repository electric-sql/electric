defmodule Electric.Postgres.OidDatabase.PgType do
  require Record

  Record.defrecord(:pg_type,
    oid: :_,
    namespace: :_,
    name: :_,
    array_oid: :_,
    element_oid: :_,
    length: :_,
    type: :_,
    base_type: :_,
    rel_id: :_,
    is_array: :_,
    postgrex_ext: :_
  )

  def map_type("b"), do: :base
  def map_type("c"), do: :composite
  def map_type("d"), do: :domain
  def map_type("e"), do: :enum
  def map_type("p"), do: :pseudo
  def map_type("r"), do: :range
  def map_type("m"), do: :multirange

  def pg_type_from_tuple(pg_type() = type), do: type

  def pg_type_from_tuple({
        namespace,
        name,
        oid,
        array_oid,
        element_oid,
        len,
        type,
        base_type,
        rel_id,
        is_array
      }),
      do:
        pg_type(
          oid: String.to_integer(oid),
          namespace: String.to_atom(namespace),
          name:
            String.to_atom(if namespace == "pg_catalog", do: name, else: namespace <> "." <> name),
          array_oid: String.to_integer(array_oid),
          element_oid: String.to_integer(element_oid),
          length: String.to_integer(len),
          type: map_type(type),
          base_type: String.to_integer(base_type),
          rel_id: String.to_integer(rel_id),
          is_array: Map.fetch!(%{"t" => true, "f" => false}, is_array)
        )
end
