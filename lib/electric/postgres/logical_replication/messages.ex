defmodule Electric.Postgres.LogicalReplication.Messages do
  defmodule Begin, do: defstruct([:final_lsn, :commit_timestamp, :xid])
  defmodule Commit, do: defstruct([:flags, :lsn, :end_lsn, :commit_timestamp])
  defmodule Origin, do: defstruct([:origin_commit_lsn, :name])
  defmodule Relation, do: defstruct([:id, :namespace, :name, :replica_identity, :columns])
  defmodule Insert, do: defstruct([:relation_id, :tuple_data])

  defmodule Update,
    do: defstruct([:relation_id, :changed_key_tuple_data, :old_tuple_data, :tuple_data])

  defmodule Delete,
    do: defstruct([:relation_id, :changed_key_tuple_data, :old_tuple_data])

  defmodule Truncate,
    do: defstruct([:number_of_relations, :options, :truncated_relations])

  defmodule Type, do: defstruct([:id, :namespace, :name])

  defmodule Unsupported, do: defstruct([:data])

  defmodule Relation.Column, do: defstruct([:flags, :name, :type, :type_modifier])
end
