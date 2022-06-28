defmodule Electric.Postgres.OidDatabase do
  # TODO: This really should be queried from Postgres at system startup and cached in ETS
  @pg_oid_values """
                          typname         | oid  | typarray | typlen
                 -------------------------+------+----------+--------
                  bool                    |   16 |     1000 |      1
                  bytea                   |   17 |     1001 |     -1
                  char                    |   18 |     1002 |      1
                  name                    |   19 |     1003 |     64
                  int8                    |   20 |     1016 |      8
                  int2                    |   21 |     1005 |      2
                  int2vector              |   22 |     1006 |     -1
                  int4                    |   23 |     1007 |      4
                  regproc                 |   24 |     1008 |      4
                  text                    |   25 |     1009 |     -1
                  oid                     |   26 |     1028 |      4
                  tid                     |   27 |     1010 |      6
                  xid                     |   28 |     1011 |      4
                  cid                     |   29 |     1012 |      4
                  oidvector               |   30 |     1013 |     -1
                  json                    |  114 |      199 |     -1
                  xml                     |  142 |      143 |     -1
                  xid8                    | 5069 |      271 |      8
                  point                   |  600 |     1017 |     16
                  lseg                    |  601 |     1018 |     32
                  path                    |  602 |     1019 |     -1
                  box                     |  603 |     1020 |     32
                  polygon                 |  604 |     1027 |     -1
                  line                    |  628 |      629 |     24
                  float4                  |  700 |     1021 |      4
                  float8                  |  701 |     1022 |      8
                  unknown                 |  705 |        0 |     -2
                  circle                  |  718 |      719 |     24
                  money                   |  790 |      791 |      8
                  macaddr                 |  829 |     1040 |      6
                  inet                    |  869 |     1041 |     -1
                  cidr                    |  650 |      651 |     -1
                  macaddr8                |  774 |      775 |      8
                  aclitem                 | 1033 |     1034 |     12
                  bpchar                  | 1042 |     1014 |     -1
                  varchar                 | 1043 |     1015 |     -1
                  date                    | 1082 |     1182 |      4
                  time                    | 1083 |     1183 |      8
                  timestamp               | 1114 |     1115 |      8
                  timestamptz             | 1184 |     1185 |      8
                  interval                | 1186 |     1187 |     16
                  timetz                  | 1266 |     1270 |     12
                  bit                     | 1560 |     1561 |     -1
                  varbit                  | 1562 |     1563 |     -1
                  numeric                 | 1700 |     1231 |     -1
                  refcursor               | 1790 |     2201 |     -1
                  regprocedure            | 2202 |     2207 |      4
                  regoper                 | 2203 |     2208 |      4
                  regoperator             | 2204 |     2209 |      4
                  regclass                | 2205 |     2210 |      4
                  regcollation            | 4191 |     4192 |      4
                  regtype                 | 2206 |     2211 |      4
                  regrole                 | 4096 |     4097 |      4
                  regnamespace            | 4089 |     4090 |      4
                  uuid                    | 2950 |     2951 |     16
                  tsvector                | 3614 |     3643 |     -1
                  gtsvector               | 3642 |     3644 |     -1
                  tsquery                 | 3615 |     3645 |     -1
                  regconfig               | 3734 |     3735 |      4
                  regdictionary           | 3769 |     3770 |      4
                  jsonb                   | 3802 |     3807 |     -1
                  jsonpath                | 4072 |     4073 |     -1
                  txid_snapshot           | 2970 |     2949 |     -1
                  int4range               | 3904 |     3905 |     -1
                  numrange                | 3906 |     3907 |     -1
                  tsrange                 | 3908 |     3909 |     -1
                  tstzrange               | 3910 |     3911 |     -1
                  daterange               | 3912 |     3913 |     -1
                  int8range               | 3926 |     3927 |     -1
                  record                  | 2249 |     2287 |     -1
                  cstring                 | 2275 |     1263 |     -2
                 """
                 |> String.split("\n", trim: true)
                 |> Enum.drop(2)
                 |> Enum.map(&String.split(&1, ~r/[\s\|]+/, trim: true))
                 |> Enum.map(fn [name, oid, len, array_oid] ->
                   {String.to_atom(name), String.to_integer(oid), String.to_integer(array_oid),
                    String.to_integer(len)}
                 end)

  @doc """
  Get an atom name by the type OID
  """
  # TODO: Handle array oid type lookup
  for {type_name, oid, _, _} <- @pg_oid_values do
    def name_for_oid(unquote(oid)), do: unquote(type_name)
  end

  def name_for_oid(_), do: :unknown

  @doc """
  Get the type OID by the name atom
  """
  for {type_name, oid, _, _} <- @pg_oid_values do
    def oid_for_name(unquote(type_name)), do: unquote(oid)
  end

  @doc """
  Get type length of a type. Negative values mean the type is variable-length
  """
  for {type_name, oid, _, len} <- @pg_oid_values do
    def type_length(unquote(oid)), do: unquote(len)
    def type_length(unquote(type_name)), do: unquote(len)
  end
end
