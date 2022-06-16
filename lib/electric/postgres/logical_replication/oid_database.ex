defmodule Electric.Postgres.LogicalReplication.OidDatabase do
  # Lifted from epgsql (src/epgsql_binary.erl), this module licensed under
  # 3-clause BSD found here: https://raw.githubusercontent.com/epgsql/epgsql/devel/LICENSE

  oid_db = [
    {:bool, 16, 1000},
    {:bpchar, 1042, 1014},
    {:bytea, 17, 1001},
    {:char, 18, 1002},
    {:cidr, 650, 651},
    {:date, 1082, 1182},
    {:daterange, 3912, 3913},
    {:float4, 700, 1021},
    {:float8, 701, 1022},
    {:geometry, 17063, 17071},
    {:hstore, 16935, 16940},
    {:inet, 869, 1041},
    {:int2, 21, 1005},
    {:int4, 23, 1007},
    {:int4range, 3904, 3905},
    {:int8, 20, 1016},
    {:int8range, 3926, 3927},
    {:interval, 1186, 1187},
    {:json, 114, 199},
    {:jsonb, 3802, 3807},
    {:macaddr, 829, 1040},
    {:macaddr8, 774, 775},
    {:point, 600, 1017},
    {:text, 25, 1009},
    {:time, 1083, 1183},
    {:timestamp, 1114, 1115},
    {:timestamptz, 1184, 1185},
    {:timetz, 1266, 1270},
    {:tsrange, 3908, 3909},
    {:tstzrange, 3910, 3911},
    {:uuid, 2950, 2951},
    {:varchar, 1043, 1015}
  ]

  # TODO: Handle array oid type lookup
  for {type_name, type_id, _array_oid} <- oid_db do
    def name_for_type_id(unquote(type_id)), do: unquote(type_name)
  end

  for {type_name, type_id, _array_oid} <- oid_db do
    def type_id_for_name(unquote(type_name)), do: unquote(type_id)
  end

  def name_for_type_id(_), do: :unknown
end
