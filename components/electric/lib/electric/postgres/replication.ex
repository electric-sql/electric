defmodule Electric.Postgres.Replication do
  defmodule Column do
    alias Electric.Postgres

    defstruct [
      :name,
      :type,
      :nullable?,
      type_modifier: -1,
      part_of_identity?: false
    ]

    @type name() :: Postgres.name()

    @type t() :: %__MODULE__{
            name: name(),
            type: atom(),
            nullable?: boolean(),
            type_modifier: integer(),
            part_of_identity?: boolean() | nil
          }
  end

  defmodule Table do
    alias Electric.Postgres

    defstruct [
      :schema,
      :name,
      :oid,
      primary_keys: [],
      replica_identity: :index,
      columns: []
    ]

    @type t() :: %__MODULE__{
            schema: Postgres.name(),
            name: Postgres.name(),
            oid: Postgres.oid(),
            primary_keys: [Postgres.name()],
            replica_identity: :all_columns | :default | :nothing | :index,
            columns: [Column.t()]
          }
  end
end
