defmodule Electric.Postgres.OidDatabase.PgType do
  require Record

  Record.defrecord(:pg_type,
    oid: :_,
    namespace: :_,
    name: :_,
    array_oid: :_,
    element_oid: :_,
    length: :_,
    kind: :_,
    is_array: :_
  )

  @type kind :: :BASE | :COMPOSITE | :DOMAIN | :ENUM | :PSEUDO | :RANGE | :MULTIRANGE
  @type t ::
          record(:pg_type,
            oid: pos_integer,
            namespace: binary,
            name: atom | binary,
            array_oid: non_neg_integer,
            element_oid: non_neg_integer,
            length: integer,
            kind: kind,
            is_array: boolean
          )

  @spec kind(binary) :: kind
  def kind("b"), do: :BASE
  def kind("c"), do: :COMPOSITE
  def kind("d"), do: :DOMAIN
  def kind("e"), do: :ENUM
  def kind("p"), do: :PSEUDO
  def kind("r"), do: :RANGE
  def kind("m"), do: :MULTIRANGE

  def pg_type_from_tuple(pg_type() = type), do: type

  def pg_type_from_tuple({namespace, name, oid, array_oid, element_oid, len, typtype}) do
    kind = kind(typtype)
    array_oid = String.to_integer(array_oid)

    pg_type(
      namespace: namespace,
      name: type_name(namespace, name, kind),
      oid: String.to_integer(oid),
      array_oid: array_oid,
      element_oid: String.to_integer(element_oid),
      length: String.to_integer(len),
      kind: kind,
      is_array: array_oid == 0
    )
  end

  # All BASE type names are converted to atoms. This is useful for pattern-matching against literal type names.
  defp type_name("pg_catalog", name, :BASE), do: String.to_atom(name)

  # We currently define a single DOMAIN type named electric.tag. It is looked up in OidDatabase as an atom, so we
  # convert domain types to atoms for now.
  defp type_name("electric", name, :DOMAIN), do: String.to_atom("electric." <> name)

  # User-defined and other custom types get schema-qualified names as strings.
  defp type_name(namespace, name, _kind), do: namespace <> "." <> name
end
