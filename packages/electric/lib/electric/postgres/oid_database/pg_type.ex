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

  type_kind_mapping = [
    {"b", :BASE},
    {"c", :COMPOSITE},
    {"d", :DOMAIN},
    {"e", :ENUM},
    {"p", :PSEUDO},
    {"r", :RANGE},
    {"m", :MULTIRANGE}
  ]

  @spec decode_kind(binary) :: kind
  for {typtype, kind} <- type_kind_mapping do
    def decode_kind(unquote(typtype)), do: unquote(kind)
  end

  @spec encode_kind(kind) :: binary
  for {typtype, kind} <- type_kind_mapping do
    def encode_kind(unquote(kind)), do: unquote(typtype)
  end

  def pg_type_from_tuple(pg_type() = type), do: type

  def pg_type_from_tuple({namespace, name, oid, array_oid, element_oid, len, typtype}) do
    kind = decode_kind(typtype)

    pg_type(
      namespace: namespace,
      name: type_name(namespace, name, kind),
      oid: String.to_integer(oid),
      array_oid: String.to_integer(array_oid),
      element_oid: String.to_integer(element_oid),
      length: len,
      kind: kind,
      is_array: array_oid == "0"
    )
  end

  # All BASE type names are converted to atoms. This is useful for pattern-matching against literal type names.
  defp type_name("pg_catalog", name, :BASE), do: String.to_atom(name)

  # We currently define a single DOMAIN type named electric.tag. It is looked up in OidDatabase as an atom, so we
  # convert domain types to atoms for now.
  defp type_name("electric", name, :DOMAIN), do: String.to_atom("electric." <> name)

  # User-defined and other custom types are strings containing a schema-qualified name or a plain name, if the type's
  # schema is "public".
  defp type_name("public", name, _kind), do: name
  defp type_name(namespace, name, _kind), do: namespace <> "." <> name
end
