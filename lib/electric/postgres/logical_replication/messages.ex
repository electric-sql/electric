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

  defmodule Lsn do
    defstruct [:segment, :offset]

    defimpl Inspect do
      def inspect(%{segment: segment, offset: offset}, _opts) do
        "#Lsn<#{Integer.to_string(segment, 16)}/#{Integer.to_string(offset, 16)}>"
      end
    end

    defimpl String.Chars do
      alias Electric.Postgres.LogicalReplication.Messages.Lsn
      def to_string(lsn), do: Lsn.to_string(lsn)
    end

    def to_string(%__MODULE__{segment: segment, offset: offset}),
      do: Integer.to_string(segment, 16) <> "/" <> Integer.to_string(offset, 16)

    def from_string(x) when is_binary(x) do
      [segment, offset] = String.split(x, "/")
      %__MODULE__{segment: String.to_integer(segment, 16), offset: String.to_integer(offset, 16)}
    end

    def from_integer(x) when is_integer(x) do
      <<segment::32, offset::32>> = <<x::64>>
      %__MODULE__{segment: segment, offset: offset}
    end

    def to_integer(%__MODULE__{segment: s, offset: o}) do
      <<i::64>> = <<s::32, o::32>>
      i
    end

    def compare(%{segment: s1}, %{segment: s2}) when s1 < s2, do: :lt
    def compare(%{segment: s1}, %{segment: s2}) when s1 > s2, do: :gt
    def compare(%{offset: o1}, %{offset: o2}) when o1 < o2, do: :lt
    def compare(%{offset: o1}, %{offset: o2}) when o1 > o2, do: :gt
    def compare(%{offset: o1}, %{offset: o2}) when o1 == o2, do: :eq

    def increment(lsn, step \\ 10)

    def increment(%__MODULE__{segment: s, offset: o}, step) when o + step < 0xFFFFFFFF,
      do: %__MODULE__{segment: s, offset: o + step}

    def increment(%__MODULE__{segment: s, offset: o}, step),
      do: %__MODULE__{segment: s + 1, offset: rem(o + step, 0xFFFFFFFF)}
  end
end
