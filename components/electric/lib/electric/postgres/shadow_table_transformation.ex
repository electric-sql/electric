defmodule Electric.Postgres.ShadowTableTransformation do
  import Electric.Postgres.Extension,
    only: [
      shadow_of: 1,
      is_shadow_relation: 1,
      is_tombstone_relation: 1,
      infer_shadow_primary_keys: 1,
      is_extension_relation: 1
    ]

  import Electric.Utils, only: [parse_pg_array: 1]

  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Replication.Changes.DeletedRecord

  @type column :: %{name: String.t()}
  @type relations_map :: %{
          optional(Changes.relation()) => %{
            primary_keys: [String.t(), ...],
            columns: [column()]
          }
        }

  @doc """
  Splits the change event into main table event and shadow table event to be handled by
  Postgres triggers for conflict resolution.

  It accepts a change that's going to be split, a map of relations which describe columns
  of both the main table and the shadow table, and a tag that's going to be assigned to the
  change.

  This function is meant to work together with Postgres conflict resolution triggers,
  which expect that all operations coming from Electric are `INSERT`s and consist of
  two operations: one for main table and one for shadow table.

  The operations must all be `INSERT`s so that PostgreSQL will execute a trigger for each of
  them: for `UPDATE`s it will not execute any triggers if the row is missing. We convert
  all operations to `INSERT`s, even `DELETE`s, since the actual operation is going to be
  determined by the triggers based on the shadow row contents.

  Shadow row operation is built based on the incoming change, and we set the following:
  - Primary key columns (same as on the main table)
  - If the operation is a `DELETE`
  - Observed tags for the operation
  - Modified columns bitmask

  The actual data is sent in the main table `INSERT`, and how that is applied is determined
  by the shadow table `INSERT`. We "resend" the deleted data as the `INSERT` instead of a
  `DELETE` operation, since it's likely valid and it will get discarded anyway.

  The order of operation is very important here: triggers expect main table `INSERT` to come
  before the shadow table `INSERT`. The reason for this choice is the locking order: when
  writing triggers for PG-originating transactions, we cannot alter the locking order: the
  `BEFORE UPDATE` triggers on the main table that want to alter the shadow table will run
  only after the lock has been taken out on the main table. To avoid same-table deadlocks,
  we're explicitly ordering the operations on the replication stream in the same order
  as they would be on PG-originating transactions.
  """
  @spec split_change_into_main_and_shadow(
          change :: Changes.change(),
          relations :: relations_map(),
          tag :: {DateTime.t(), String.t()} | String.t(),
          origin :: String.t()
        ) :: [Changes.change()]
  def split_change_into_main_and_shadow(change, relations, tag, origin)

  def split_change_into_main_and_shadow(change, relations, {_, _} = tag, origin),
    do: split_change_into_main_and_shadow(change, relations, serialize_tag_to_pg(tag), origin)

  def split_change_into_main_and_shadow(change, relations, tag, origin) do
    main_table_info = relations[change.relation]
    main_record = get_record(change)
    shadow_table_info = relations[shadow_of(change.relation)]

    non_pk_columns = Enum.map(main_table_info.columns, & &1.name) -- main_table_info.primary_keys

    modified_bitmask = build_bitmask(change, non_pk_columns)
    primary_keys = Map.take(main_record, shadow_table_info.primary_keys)

    shadow_record =
      shadow_table_info.columns
      |> Map.new(&{&1.name, nil})
      |> Map.merge(primary_keys)
      |> Map.merge(%{
        "_tag" => tag,
        "_is_a_delete_operation" =>
          if(is_struct(change, Changes.DeletedRecord), do: "t", else: "f"),
        "_observed_tags" => convert_tag_list_satellite_to_pg(change.tags, origin),
        "_modified_columns_bit_mask" => serialize_pg_array(modified_bitmask)
      })

    [
      %Changes.NewRecord{relation: change.relation, record: main_record},
      %Changes.NewRecord{relation: shadow_of(change.relation), record: shadow_record}
    ]
  end

  defp build_bitmask(%Changes.NewRecord{}, columns), do: Enum.map(columns, fn _ -> "t" end)

  defp build_bitmask(%Changes.UpdatedRecord{old_record: nil}, columns),
    do: Enum.map(columns, fn _ -> "f" end)

  defp build_bitmask(%Changes.UpdatedRecord{old_record: old, record: new}, columns),
    do: Enum.map(columns, fn col -> if old[col] != new[col], do: "t", else: "f" end)

  defp build_bitmask(%Changes.DeletedRecord{}, columns), do: Enum.map(columns, fn _ -> "f" end)

  defp get_record(%{record: record}) when is_map(record), do: record
  defp get_record(%{old_record: record}), do: record

  @doc """
  Returns a transaction with origin & timestamp set based on the shadow operations,
  and with `tags` for each operation filled from relevant shadow operation.

  Expects a transaction, where for each "main" table change, there exists a "shadow"
  change that sets the `_tags` field to the correct value. This function only uses two
  fields from the `shadow` changes: `_tag` and `_tags`. Shadow operations are removed
  from the changes.

  The `_tag` is expected to be a transient value which doesn't get affected by the
  triggers on Postgres side, so we can use it to restore the origin & timestamp of
  the transaction. Within a transaction, all "shadow" changes are expected to have the
  same tag, so we're just getting a first one we can find.

  The `_tags` field may be set to different values within the transaction, but since
  we're sending a "source of truth" set of tags from here, we can take the latest
  "shadow" change for a given row and use those tags for all operations in the transaction.

  The "delete" operation is special-cased here, as it should have an empty tag set always,
  if sent from PG.
  """
  @spec enrich_tx_from_shadow_ops(transaction :: Transaction.t()) :: Transaction.t()
  def enrich_tx_from_shadow_ops(%Transaction{} = tx) do
    # tx.changes is REVERSED at this point, so `shadow` and `non_shadow` will be too
    {shadow, non_shadow} =
      tx.changes
      |> Enum.reject(&is_tombstone_relation(&1.relation))
      |> Enum.split_with(&is_shadow_relation(&1.relation))

    # Convert changes touching any shadow tables, intentionally keeping only latest ones
    #   `shadow_map` is keyed by a pair of the relation and a map with all the PK column values
    #   `pk_specs` is keyed by a relation and contains an unordered list of PK column names
    {shadow_map, pk_specs} =
      shadow
      |> Enum.reverse()
      |> Enum.reject(&is_struct(&1, DeletedRecord))
      |> Enum.reduce({%{}, %{}}, fn change, {shadow_map, pk_specs} ->
        %{relation: {"electric", "shadow__" <> ns_and_name}} = change
        [ns, name] = String.split(ns_and_name, "__", parts: 2)

        pk_specs =
          Map.put_new_lazy(pk_specs, {ns, name}, fn ->
            infer_shadow_primary_keys(change.record)
          end)

        pk_list = Map.fetch!(pk_specs, {ns, name})

        shadow_map = Map.put(shadow_map, {{ns, name}, Map.take(change.record, pk_list)}, change)

        {shadow_map, pk_specs}
      end)

    # Find any shadow change, and take it's tag.
    # `DELETE` changes aren't expected on shadow tables, so we skip those unexpected ops.
    {timestamp, origin} =
      case Enum.find(shadow, &(not is_struct(&1, DeletedRecord))) do
        nil -> {tx.commit_timestamp, tx.origin}
        %{record: %{"_tag" => tag}} -> parse_pg_electric_tag(tag, tx.origin)
      end

    %{
      tx
      | commit_timestamp: timestamp,
        origin: origin,
        changes: merge_shadow_changes(non_shadow, shadow_map, pk_specs, tx.origin)
    }
  end

  # This function uses tail recursion which reverses the list, but that's expected since source is reversed
  @spec merge_shadow_changes(
          non_shadow_changes :: [Changes.change()],
          shadow_map :: %{optional({Changes.relation(), map()}) => Changes.change()},
          pk_specs :: %{optional(Changes.relation()) => list(String.t())},
          default_origin :: String.t(),
          acc :: [Changes.change()]
        ) :: [Changes.change()]
  defp merge_shadow_changes(non_shadow_changes, shadow_map, pk_specs, default_origin, acc \\ [])

  defp merge_shadow_changes([], _, _, _, acc), do: acc

  defp merge_shadow_changes(
         [%DeletedRecord{} = change | rest],
         shadow_map,
         pk_specs,
         default_origin,
         acc
       )
       when is_map_key(pk_specs, change.relation) do
    # Although this function is (currently) applied to both PG-originating txs and Electric-originating txs,
    # the actual `DELETE` operation can show up on the replication stream only in two cases:
    #    1. It's PG-originating, meaning that tags are magically handled as overriding everything already
    #    2. It's Electric-originating AND PG had resolved the tags to be an empty set (otherwise a DELETE wouldn't have been executed)
    # Hence, we can assign empty tag set on the downstream path in both occasions
    acc = [%{change | tags: []} | acc]
    merge_shadow_changes(rest, shadow_map, pk_specs, default_origin, acc)
  end

  defp merge_shadow_changes([change | rest], shadow_map, pk_specs, default_origin, acc)
       when is_map_key(pk_specs, change.relation) do
    pk_map = Map.take(change.record, pk_specs[change.relation])

    case Map.fetch(shadow_map, {change.relation, pk_map}) do
      {:ok, %{record: %{"_tags" => tags}}} ->
        change = %{change | tags: convert_tag_list_pg_to_satellite(tags, default_origin)}

        merge_shadow_changes(rest, shadow_map, pk_specs, default_origin, [change | acc])

      :error ->
        merge_shadow_changes(rest, shadow_map, pk_specs, default_origin, [change | acc])
    end
  end

  defp merge_shadow_changes([change | rest], shadow_map, pk_specs, default_origin, acc) do
    # Shadow entry is missing completely, best we can do is just pass this through
    merge_shadow_changes(rest, shadow_map, pk_specs, default_origin, [change | acc])
  end

  @doc """
  Adds shadow relation for every mentioned non-extension relation to the list

  ## Examples

      iex> add_shadow_relations([{"public", "test"}])
      [{"public", "test"}, {"electric", "shadow__public__test"}]

      iex> add_shadow_relations([{"public", "test"}, {"electric", "testing"}])
      [{"electric", "testing"}, {"public", "test"}, {"electric", "shadow__public__test"}]
  """
  def add_shadow_relations(relations, acc \\ [])
  def add_shadow_relations([], acc), do: acc

  def add_shadow_relations([relation | tail], acc) when is_extension_relation(relation),
    do: add_shadow_relations(tail, [relation | acc])

  def add_shadow_relations([relation | tail], acc),
    do: add_shadow_relations(tail, [relation, shadow_of(relation) | acc])

  @doc """
  Parse a postgres string-serialized electric.tag value into an origin & a timestamp.

  If the origin in the tuple is empty, returns `default_origin` instead (`nil` by default)

  ## Examples

      iex> ~s|("2023-06-15 11:18:05.372698+00",)| |> parse_pg_electric_tag()
      {~U[2023-06-15 11:18:05.372698Z], nil}

      iex> ~s|("2023-06-15 11:18:05.372698+00",test)| |> parse_pg_electric_tag()
      {~U[2023-06-15 11:18:05.372698Z], "test"}

      iex> ~s|("2023-06-15 11:18:05.372698+00",)| |> parse_pg_electric_tag("default")
      {~U[2023-06-15 11:18:05.372698Z], "default"}
  """
  def parse_pg_electric_tag(tag, default_origin \\ nil) when is_binary(tag) do
    [ts, origin] =
      tag
      |> String.slice(1..-2//1)
      |> String.split(",", parts: 2)
      |> Enum.map(&String.trim(&1, ~s|"|))
      |> Enum.map(&String.replace(&1, ~S|\"|, ~S|"|))

    {:ok, ts, _} = DateTime.from_iso8601(ts)

    {ts, if(origin == "", do: default_origin, else: origin)}
  end

  @doc """
  Serialize an origin-timestamp pair into a postgres string-serialized electric.tag value

  If the origin matches `nil_origin` (second argument), then `null` PG value will be used in place

  ## Examples

      iex> {~U[2023-06-15 11:18:05.372698Z], nil} |> serialize_tag_to_pg()
      ~s|("2023-06-15T11:18:05.372698Z",)|

      iex> {~U[2023-06-15 11:18:05.372698Z], "test"} |> serialize_tag_to_pg()
      ~s|("2023-06-15T11:18:05.372698Z","test")|

      iex> {~U[2023-06-15 11:18:05.372698Z], "default"} |> serialize_tag_to_pg("default")
      ~s|("2023-06-15T11:18:05.372698Z",)|
  """
  def serialize_tag_to_pg({timestamp, origin}, nil_origin \\ nil) do
    origin =
      if origin == nil_origin, do: nil, else: ~s|"#{String.replace(origin, ~S|"|, ~S|\"|)}"|

    ~s|("#{DateTime.to_iso8601(timestamp)}",#{origin})|
  end

  @doc ~S"""
  Parse a PG array of electric tags and serialize them as Satellite-formatted tags.

  There is some loss in precision here, as PG serializes the timestamp with microseconds,
  while satellite string tags are millisecond-precision unix timestamps

  ## Examples

      iex> ~s|{"(\\"2023-06-15 11:18:05.372698+00\\",)"}| |> convert_tag_list_pg_to_satellite("postgres")
      ["postgres@1686827885372"]
  """
  def convert_tag_list_pg_to_satellite(array, default_origin \\ nil) when is_binary(array) do
    array
    |> parse_pg_array()
    |> Enum.map(&parse_pg_electric_tag(&1, default_origin))
    |> Enum.map(&pg_electric_tag_to_satellite_tag/1)
  end

  @doc ~S"""
  Parse a list of electric tags and serialize them to pg array.

  ## Examples

      iex> ["postgres@1686827885372"] |> convert_tag_list_satellite_to_pg("postgres")
      ~s|{"(\\"2023-06-15T11:18:05.372Z\\",)"}|
  """
  def convert_tag_list_satellite_to_pg(array, nil_origin \\ nil) do
    array
    |> Enum.map(&split_satellite_tag/1)
    |> Enum.map(&serialize_tag_to_pg(&1, nil_origin))
    |> serialize_pg_array()
  end

  @doc ~S"""
  Serialize a list of strings into a postgres string-serialized array into a list of strings, wrapping the contents

  ## Examples

      iex> [~s|("2023-06-15 11:18:05.372698+00",)|] |> serialize_pg_array()
      ~s|{"(\\"2023-06-15 11:18:05.372698+00\\",)"}|

      iex> [~s|("2023-06-15 11:18:05.372698+00",)|, ~s|("2023-06-15 11:18:05.372698+00",)|] |> serialize_pg_array()
      ~s|{"(\\"2023-06-15 11:18:05.372698+00\\",)","(\\"2023-06-15 11:18:05.372698+00\\",)"}|

      iex> str = ~s|{"(\\"2023-06-15 11:18:05.372698+00\\",)","(\\"2023-06-15 11:18:05.372698+00\\",)"}|
      iex> str |> parse_pg_array |> serialize_pg_array
      str
  """
  def serialize_pg_array(array) when is_list(array) do
    array
    |> Enum.map_join(",", fn
      nil -> "null"
      val when is_binary(val) -> ~s|"| <> String.replace(val, ~s|"|, ~S|\"|) <> ~s|"|
    end)
    |> then(&"{#{&1}}")
  end

  def split_satellite_tag(tag) do
    [origin, ts] = String.split(tag, "@", parts: 2)
    {DateTime.from_unix!(String.to_integer(ts), :millisecond), origin}
  end

  defp pg_electric_tag_to_satellite_tag({timestamp, origin}),
    do: "#{origin}@#{DateTime.to_unix(timestamp, :millisecond)}"
end
