defmodule Electric.Postgres.LogicalReplication.Messages do
  alias Electric.Postgres.LogicalReplication.Messages
  alias Electric.Postgres.Lsn

  @type relation_id() :: non_neg_integer

  defmodule Begin do
    defstruct([:final_lsn, :commit_timestamp, :xid])

    @type t() :: %__MODULE__{
            final_lsn: Lsn.t(),
            commit_timestamp: DateTime.t(),
            xid: Lsn.int32()
          }
  end

  defmodule Commit do
    defstruct([:flags, :lsn, :end_lsn, :commit_timestamp])

    @type t() :: %__MODULE__{
            flags: list(),
            lsn: Lsn.t(),
            end_lsn: Lsn.t(),
            commit_timestamp: DateTime.t()
          }
  end

  defmodule Origin do
    defstruct([:origin_commit_lsn, :name])

    @type t() :: %__MODULE__{
            origin_commit_lsn: Lsn.t(),
            name: String.t()
          }
  end

  defmodule Relation do
    defstruct([:id, :namespace, :name, :replica_identity, :columns])

    @type t() :: %__MODULE__{
            id: Messages.relation_id(),
            namespace: String.t(),
            name: String.t(),
            replica_identity: :default | :nothing | :all_columns | :index,
            columns: [Messages.Relation.Column.t()]
          }
  end

  defmodule Insert do
    defstruct([:relation_id, :tuple_data])

    @type t() :: %__MODULE__{
            relation_id: Messages.relation_id(),
            tuple_data: tuple()
          }
  end

  defmodule Update do
    defstruct([:relation_id, :changed_key_tuple_data, :old_tuple_data, :tuple_data])

    @type t() :: %__MODULE__{
            relation_id: Messages.relation_id(),
            changed_key_tuple_data: nil | {String.t(), nil | String.t()},
            old_tuple_data: tuple(),
            tuple_data: tuple()
          }
  end

  defmodule Delete do
    defstruct([:relation_id, :changed_key_tuple_data, :old_tuple_data])

    @type t() :: %__MODULE__{
            relation_id: Messages.relation_id(),
            changed_key_tuple_data: nil | {String.t(), nil | String.t()},
            old_tuple_data: nil | tuple()
          }
  end

  defmodule Truncate do
    defstruct([:number_of_relations, :options, :truncated_relations])

    @type t() :: %__MODULE__{
            number_of_relations: non_neg_integer(),
            options: [atom()],
            truncated_relations: [Messages.relation_id()]
          }
  end

  defmodule Type do
    defstruct([:id, :namespace, :name])

    @type t() :: %__MODULE__{
            id: non_neg_integer(),
            namespace: String.t(),
            name: String.t()
          }
  end

  defmodule Unsupported do
    defstruct([:data])
  end

  defmodule Relation.Column do
    defstruct([:flags, :name, :type, :type_modifier])

    @type t() :: %__MODULE__{
            flags: [:key],
            name: String.t(),
            type: atom(),
            type_modifier: integer()
          }
  end
end
