defmodule Electric.Replication.Changes do
  defmodule(Transaction, do: defstruct([:changes, :commit_timestamp]))
  defmodule(NewRecord, do: defstruct([:relation, :record]))
  defmodule(UpdatedRecord, do: defstruct([:relation, :old_record, :record]))
  defmodule(DeletedRecord, do: defstruct([:relation, :old_record]))
  defmodule(TruncatedRelation, do: defstruct([:relation]))
end
