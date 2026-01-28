defmodule Electric.Replication.Changes do
  @moduledoc """
  This module contains structs that are intermediate representation of Postgres and Satellite transactions.

  Some of the core assumptions in this module:
  - We require PK always to be present for all tables
  - For now PK modification is not supported
  - PG replication protocol is expected to always send the *whole* row
  when dealing with UPDATE changes, and optionally old row if REPLICA
  identity is set to FULL.
  """

  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.Postgres.Xid

  @type db_identifier() :: String.t()
  @type xid() :: Xid.anyxid()
  @type relation_name() :: {schema :: db_identifier(), table :: db_identifier()}
  @type record() :: %{(column_name :: db_identifier()) => column_data :: binary()}
  @type relation_id() :: non_neg_integer

  @typedoc """
  Tag has the form of `origin@timestamp`, where origin is a unique source id
  (UUID for Satellite clients) and timestamp is millisecond-precision UTC unix timestamp
  """
  @type tag() :: String.t()
  @type pk() :: [String.t(), ...]

  @type data_change() ::
          Changes.NewRecord.t()
          | Changes.UpdatedRecord.t()
          | Changes.DeletedRecord.t()

  @type change() :: data_change() | Changes.TruncatedRelation.t()

  defmodule Commit do
    @type t() :: %__MODULE__{
            commit_timestamp: DateTime.t() | nil,
            transaction_size: non_neg_integer(),
            txn_change_count: non_neg_integer(),
            received_at_mono: integer() | nil,
            initial_receive_lag: non_neg_integer() | nil
          }

    defstruct [
      :commit_timestamp,
      :received_at_mono,
      :initial_receive_lag,
      transaction_size: 0,
      txn_change_count: 0
    ]

    @doc """
    Calculate the initial receive lag in milliseconds, clamped to >= 0.

    This handles clock skew between Postgres and Electric by ensuring
    the lag is never negative even if the commit timestamp appears to
    be in the future from Electric's perspective.

    Note: When clocks are skewed such that the commit timestamp is ahead
    of Electric's clock, this function clamps the result to 0. This means
    information about actual network/replication lag is lost, and the
    final receive lag reported by `calculate_final_receive_lag/2` will
    only reflect Electric's internal processing time, not the true
    end-to-end lag from Postgres commit to Electric receipt.
    """
    @spec calculate_initial_receive_lag(DateTime.t(), DateTime.t()) :: non_neg_integer()
    def calculate_initial_receive_lag(commit_timestamp, current_time) do
      max(0, DateTime.diff(current_time, commit_timestamp, :millisecond))
    end

    @doc """
    Calculate the final receive lag in milliseconds.

    Combines the initial receive lag (captured when the commit was received)
    with the time elapsed within Electric (measured using monotonic time).

    Note: If the initial receive lag was clamped to 0 due to clock skew
    (see `calculate_initial_receive_lag/2`), the value returned here
    represents only Electric's internal processing time, not the true
    end-to-end lag from Postgres commit to acknowledgement.
    """
    @spec calculate_final_receive_lag(t(), integer()) :: non_neg_integer()
    def calculate_final_receive_lag(%__MODULE__{} = commit, current_mono) do
      elapsed_in_electric =
        System.convert_time_unit(
          current_mono - commit.received_at_mono,
          :native,
          :millisecond
        )

      commit.initial_receive_lag + elapsed_in_electric
    end
  end

  defmodule TransactionFragment do
    @moduledoc """
    Represents a transaction or part of a transaction from the replication stream.

    The `has_begin?` and `commit` fields indicate which portion of a transaction
    the fragment represents:

    - Full transaction: `has_begin?` is true and `commit` is set
    - Start of a transaction: `has_begin?` is true but no `commit`
    - Middle of a transaction: `has_begin?` is false and no `commit`
    - End of a transaction: `has_begin?` is false but `commit` is set
    """

    @type t() :: %__MODULE__{
            xid: Changes.xid() | nil,
            lsn: Electric.Postgres.Lsn.t() | nil,
            last_log_offset: LogOffset.t() | nil,
            has_begin?: boolean(),
            commit: Changes.Commit.t() | nil,
            changes: [Changes.change()],
            affected_relations: MapSet.t(Changes.relation_name()),
            change_count: non_neg_integer()
          }

    defstruct xid: nil,
              lsn: nil,
              # The last_log_offset must be the last offset seen in the
              # the range covered by this fragment. It may be not be
              # the last offset in the changes field here if the changes
              # have been filtered outside of postgres.
              last_log_offset: nil,
              has_begin?: false,
              commit: nil,
              changes: [],
              affected_relations: MapSet.new(),
              change_count: 0

    def complete_transaction?(%__MODULE__{has_begin?: true, commit: %Changes.Commit{}}), do: true
    def complete_transaction?(%__MODULE__{}), do: false
  end

  defmodule Transaction do
    alias Electric.Replication.Changes
    require Electric.Postgres.Xid

    @type t() :: %__MODULE__{
            xid: Changes.xid() | nil,
            changes: [Changes.change()],
            num_changes: non_neg_integer(),
            commit_timestamp: DateTime.t() | nil,
            lsn: Electric.Postgres.Lsn.t(),
            # The last_log_offset must be the last offset seen in the
            # the transaction. It may be not be the last offset in the changes
            # field here if the changes have been filtered outside of postgres.
            last_log_offset: LogOffset.t()
          }

    defstruct [
      :xid,
      :commit_timestamp,
      :lsn,
      :last_log_offset,
      changes: [],
      num_changes: 0
    ]

    @doc """
    Check if a transaction is visible in a snapshot.
    """
    @spec visible_in_snapshot?(
            t() | Xid.anyxid(),
            %{xmin: Xid.anyxid(), xmax: Xid.anyxid(), xip_list: [Xid.anyxid()]}
            | {Xid.anyxid(), Xid.anyxid(), [Xid.anyxid()]}
          ) :: boolean()
    def visible_in_snapshot?(%__MODULE__{xid: xid}, %{xmin: xmin, xmax: xmax, xip_list: xip_list}),
        do: visible_in_snapshot?(xid, {xmin, xmax, xip_list})

    def visible_in_snapshot?(%__MODULE__{xid: xid}, snapshot) when is_tuple(snapshot),
      do: visible_in_snapshot?(xid, snapshot)

    def visible_in_snapshot?(xid, {xmin, _, _}) when Xid.is_lt(xid, xmin), do: true
    def visible_in_snapshot?(xid, {_, xmax, _}) when not Xid.is_lt(xid, xmax), do: false
    def visible_in_snapshot?(_, {_, _, []}), do: true
    def visible_in_snapshot?(xid, {_, _, xip_list}), do: xid not in xip_list
  end

  defmodule NewRecord do
    defstruct [:relation, :record, :log_offset, :key, last?: false, move_tags: []]

    @type t() :: %__MODULE__{
            relation: Changes.relation_name(),
            record: Changes.record(),
            log_offset: LogOffset.t(),
            key: String.t() | nil,
            last?: boolean(),
            move_tags: [Changes.tag()]
          }
  end

  defmodule UpdatedRecord do
    defstruct [
      :relation,
      :old_record,
      :record,
      :log_offset,
      :key,
      :old_key,
      move_tags: [],
      removed_move_tags: [],
      changed_columns: MapSet.new(),
      last?: false
    ]

    @type t() :: %__MODULE__{
            relation: Changes.relation_name(),
            old_record: Changes.record() | nil,
            record: Changes.record(),
            log_offset: LogOffset.t(),
            key: String.t() | nil,
            old_key: String.t() | nil,
            move_tags: [Changes.tag()],
            removed_move_tags: [Changes.tag()],
            changed_columns: MapSet.t(),
            last?: boolean()
          }

    def new(attrs) do
      __MODULE__
      |> struct(attrs)
      |> build_changed_columns()
    end

    defp build_changed_columns(%{old_record: nil} = change) do
      change
    end

    defp build_changed_columns(change) do
      %{old_record: old, record: new} = change

      # if the value is in the new but NOT the old, then it's being updated
      # if it's in the old but NOT the new, then it's staying the same
      changed =
        Enum.reduce(new, MapSet.new(), fn {col_name, new_value}, changed ->
          case Map.fetch(old, col_name) do
            :error ->
              MapSet.put(changed, col_name)

            {:ok, old_value} ->
              if old_value == new_value,
                do: changed,
                else: MapSet.put(changed, col_name)
          end
        end)

      %{change | changed_columns: changed}
    end
  end

  defmodule DeletedRecord do
    defstruct [:relation, :old_record, :log_offset, :key, move_tags: [], last?: false]

    @type t() :: %__MODULE__{
            relation: Changes.relation_name(),
            old_record: Changes.record(),
            log_offset: LogOffset.t(),
            key: String.t() | nil,
            move_tags: [Changes.tag()],
            last?: boolean()
          }
  end

  defmodule TruncatedRelation do
    defstruct [:relation, :log_offset, last?: false]

    @type t() :: %__MODULE__{
            relation: Changes.relation_name(),
            log_offset: LogOffset.t(),
            last?: boolean()
          }
  end

  defmodule Column do
    @derive Jason.Encoder
    defstruct [:name, :type_oid]

    @type t() :: %__MODULE__{
            name: Changes.db_identifier(),
            type_oid: pos_integer()
          }
  end

  defmodule Relation do
    @derive Jason.Encoder
    defstruct [:id, :schema, :table, :columns, affected_columns: []]

    @type t() :: %__MODULE__{
            id: Changes.relation_id(),
            schema: Changes.db_identifier(),
            table: Changes.db_identifier(),
            columns: [Column.t()],
            affected_columns: [Changes.db_identifier()]
          }
  end

  @doc ~S"""
  Build a unique key for a given record based on its relation and PK.

  Uses the `/` symbol as a PK separator, so any `/`s in the PK will
  be escaped to avoid collisions.

  ## Examples

  Build key respects PK column order:

      iex> build_key({"hello", "world"}, %{"c" => "d", "a" => "b"}, ["a", "c"])
      ~S|"hello"."world"/"b"/"d"|

      iex> build_key({"hello", "world"}, %{"a" => "b", "c" => "d"}, ["c", "a"])
      ~S|"hello"."world"/"d"/"b"|

  Build key has `/` symbol in the PK escaped by repetition:

      iex> build_key({"hello", "world"}, %{"a" => "test/test", "c" => "test"}, ["a", "c"])
      ~S|"hello"."world"/"test//test"/"test"|

      iex> build_key({"hello", "world"}, %{"a" => "test", "c" => "test/test"}, ["a", "c"])
      ~S|"hello"."world"/"test"/"test//test"|

  If a table has no PK, all columns are used, sorted by the column name:

      iex> build_key({"hello", "world"}, %{"c" => "d", "a" => "b"}, [])
      ~S|"hello"."world"/"b"/"d"|

      iex> build_key({"hello", "world"}, %{"a" => "1", "b" => nil, "c" => "2"}, [])
      ~S|"hello"."world"/"1"/_/"2"|

  All pk sections are wrapped in quotes to allow for empty strings without generating a `//` pair.

      iex> build_key({"hello", "world"}, %{"a" => "1", "b" => "", "c" => "2"}, [])
      ~S|"hello"."world"/"1"/""/"2"|

  Dots and slashes in relation names are escaped by repetition:

      iex> build_key({"a\".\"b", "c"}, %{"a" => ""}, [])
      ~S|"a".."b"."c"/""|

      iex> build_key({"a", "b\".\"c"}, %{"a" => ""}, [])
      ~S|"a"."b".."c"/""|

      iex> build_key({"a", "b"}, %{"a" => "", "b" => ""}, [])
      ~S|"a"."b"/""/""|

      iex> build_key({"a", "b\"/\""}, %{"a" => ""}, [])
      ~S|"a"."b"//""/""|
  """
  def build_key(rel, record, pk_cols) when is_list(pk_cols) do
    IO.iodata_to_binary([prefix_from_rel(rel), join_escape_pk(record, pk_cols)])
  end

  def fill_key(%TruncatedRelation{} = tr, _pk), do: tr

  def fill_key(%UpdatedRecord{old_record: old_record, record: new_record} = change, pk) do
    old_key = build_key(change.relation, old_record, pk)
    new_key = build_key(change.relation, new_record, pk)

    if old_key == new_key,
      do: %{change | key: new_key},
      else: %{change | old_key: old_key, key: new_key}
  end

  def fill_key(%NewRecord{relation: relation, record: record} = change, pk),
    do: %{change | key: build_key(relation, record, pk)}

  def fill_key(%DeletedRecord{relation: relation, old_record: old_record} = change, pk),
    do: %{change | key: build_key(relation, old_record, pk)}

  defp prefix_from_rel({schema, table}),
    do: [?", escape_rel_component(schema), ?", ?., ?", escape_rel_component(table), ?"]

  defp escape_rel_component(relcomp),
    do: relcomp |> :binary.replace("/", "//", [:global]) |> :binary.replace(".", "..", [:global])

  defp join_escape_pk(record, []),
    do:
      record
      |> Enum.sort_by(&elem(&1, 0))
      |> Enum.map(fn {_, v} -> escape_pk_section(v) end)

  defp join_escape_pk(record, pk_cols),
    do: Enum.map(pk_cols, fn col -> escape_pk_section(Map.fetch!(record, col)) end)

  defp escape_pk_section(nil), do: [?/, ?_]

  defp escape_pk_section(v) when is_binary(v),
    do: [?/, ?", :binary.replace(v, "/", "//", [:global]), ?"]

  @doc """
  Convert an UpdatedRecord into the corresponding NewRecord or DeletedRecord
  based on the provided `to` option.

  ## Examples

      iex> convert_update(%UpdatedRecord{record: %{id: 1}}, to: :new_record)
      %NewRecord{record: %{id: 1}}

      iex> convert_update(%UpdatedRecord{record: %{id: 2}, old_record: %{id: 1}}, to: :deleted_record)
      %DeletedRecord{old_record: %{id: 1}}

      iex> convert_update(%UpdatedRecord{record: %{id: 1}}, to: :updated_record)
      %UpdatedRecord{record: %{id: 1}}
  """
  def convert_update(%UpdatedRecord{} = change, to: :new_record) do
    %NewRecord{
      move_tags: change.move_tags,
      relation: change.relation,
      record: change.record,
      key: change.key,
      log_offset: change.log_offset
    }
  end

  def convert_update(%UpdatedRecord{} = change, to: :deleted_record) do
    %DeletedRecord{
      relation: change.relation,
      old_record: change.old_record,
      key: change.old_key || change.key,
      log_offset: change.log_offset,
      move_tags: change.move_tags
    }
  end

  def convert_update(%UpdatedRecord{} = change, to: :updated_record), do: change

  @doc """
  Filter the columns of a change to include only those provided in `columns_to_keep`.

  ## Examples

      iex> filter_columns(%NewRecord{record: %{"a" => "b", "c" => "d"}}, ["a"])
      %NewRecord{record: %{"a" => "b"}}

      iex> filter_columns(UpdatedRecord.new(
      ...>  record: %{"a" => "b", "c" => "d"},
      ...>  old_record: %{"a" => "d", "c" => "f"}
      ...>  ), ["a"])
      UpdatedRecord.new(record: %{"a" => "b"}, old_record: %{"a" => "d"})

      iex> filter_columns(%DeletedRecord{old_record: %{"a" => "b", "c" => "d"}}, ["c"])
      %DeletedRecord{old_record: %{"c" => "d"}}
  """
  @spec filter_columns(change(), [String.t()]) :: change()
  def filter_columns(%NewRecord{} = change, columns_to_keep) do
    %{change | record: change.record |> Map.take(columns_to_keep)}
  end

  def filter_columns(%UpdatedRecord{} = change, columns_to_keep) do
    %{
      change
      | old_record: change.old_record |> Map.take(columns_to_keep),
        record: change.record |> Map.take(columns_to_keep),
        changed_columns:
          change.changed_columns
          |> MapSet.reject(fn col -> col not in columns_to_keep end)
    }
  end

  def filter_columns(%DeletedRecord{} = change, columns_to_keep) do
    %{change | old_record: change.old_record |> Map.take(columns_to_keep)}
  end

  def filter_columns(change, _), do: change
end
