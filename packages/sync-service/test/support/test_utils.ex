defmodule Support.TestUtils do
  alias Electric.LogItems
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.TransactionFragment
  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Shape

  require ExUnit.Assertions

  @doc """
  Build a transaction fragment that contains an entire transaction.
  """
  def complete_txn_fragment(xid, lsn, changes) do
    txn_fragment(xid, lsn, changes, has_begin?: true, has_commit?: true)
  end

  @doc """
  Build a list of transaction fragments from the given list of maps.
  """
  @spec txn_fragments(pos_integer, pos_integer | Electric.Postgres.Lsn.t(), [
          %{changes: list(), has_begin?: boolean, has_commit?: boolean}
        ]) :: [TransactionFragment.t()]
  def txn_fragments(xid, lsn, fragment_maps) do
    Enum.map(fragment_maps, fn fragment_map ->
      {changes, opts_map} = Map.pop(fragment_map, :changes)
      txn_fragment(xid, lsn, changes, Enum.to_list(opts_map))
    end)
  end

  @doc """
  Build a transaction fragment that may or may not have begin and commit parts.
  """
  def txn_fragment(xid, lsn, changes, opts) do
    [%{log_offset: last_log_offset} | _] = Enum.reverse(changes)

    lsn =
      case lsn do
        %Electric.Postgres.Lsn{} -> lsn
        num when is_integer(num) -> Electric.Postgres.Lsn.from_integer(num)
      end

    %TransactionFragment{
      xid: xid,
      lsn: lsn,
      last_log_offset: last_log_offset,
      has_begin?: Keyword.get(opts, :has_begin?, false),
      commit: if(Keyword.get(opts, :has_commit?, false), do: %Changes.Commit{}),
      changes: changes,
      affected_relations: MapSet.new(changes, & &1.relation)
    }
  end

  @doc """
  Preprocess a list of `Changes.data_change()` structs in the same way they
  are preprocessed before reaching storage.
  """
  def changes_to_log_items(changes, opts \\ []) do
    pk = Keyword.get(opts, :pk, ["id"])
    xid = Keyword.get(opts, :xid, 1)
    replica = Keyword.get(opts, :replica, :default)

    changes
    |> Enum.map(&Changes.fill_key(&1, pk))
    |> Enum.flat_map(&LogItems.from_change(&1, xid, pk, replica))
    |> Enum.map(fn {offset, item} ->
      {offset, item.key, item.headers.operation, Jason.encode!(item)}
    end)
  end

  def with_electric_instance_id(ctx) do
    %{electric_instance_id: String.to_atom(full_test_name(ctx))}
  end

  def full_test_name(ctx) do
    "#{inspect(ctx.module)} #{ctx.test}"
  end

  def ins(opts) do
    offset = Keyword.fetch!(opts, :offset) |> LogOffset.new()
    relation = Keyword.get(opts, :relation, {"public", "test_table"})
    record = Keyword.fetch!(opts, :rec) |> Map.new(fn {k, v} -> {to_string(k), to_string(v)} end)
    %Changes.NewRecord{relation: relation, record: record, log_offset: offset}
  end

  def del(opts) do
    offset = Keyword.fetch!(opts, :offset) |> LogOffset.new()
    relation = Keyword.get(opts, :relation, {"public", "test_table"})

    old_record =
      Keyword.fetch!(opts, :rec) |> Map.new(fn {k, v} -> {to_string(k), to_string(v)} end)

    %Changes.DeletedRecord{relation: relation, old_record: old_record, log_offset: offset}
  end

  def upd(opts) do
    offset = Keyword.fetch!(opts, :offset) |> LogOffset.new()
    relation = Keyword.get(opts, :relation, {"public", "test_table"})

    {old, new} =
      Enum.reduce(Keyword.fetch!(opts, :rec), {%{}, %{}}, fn
        {k, {old, new}}, {old_acc, new_acc} ->
          {Map.put(old_acc, to_string(k), to_string(old)),
           Map.put(new_acc, to_string(k), to_string(new))}

        {k, v}, {old, new} ->
          {Map.put(old, to_string(k), to_string(v)), Map.put(new, to_string(k), to_string(v))}
      end)

    Changes.UpdatedRecord.new(
      relation: relation,
      old_record: old,
      record: new,
      log_offset: offset
    )
  end

  def set_status_to_active(%{stack_id: stack_id}) do
    Electric.StatusMonitor.mark_pg_lock_acquired(stack_id, self())
    Electric.StatusMonitor.mark_replication_client_ready(stack_id, self())
    Electric.StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
    Electric.StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
    Electric.StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
    Electric.StatusMonitor.mark_supervisor_processes_ready(stack_id, self())
    Electric.StatusMonitor.mark_integrety_checks_passed(stack_id, self())
    Electric.StatusMonitor.wait_for_messages_to_be_processed(stack_id)
  end

  def set_status_to_errored(%{stack_id: stack_id}, error_message) do
    Electric.StatusMonitor.mark_pg_lock_as_errored(stack_id, error_message)
  end

  def generate_shape(relation, where_clause \\ nil, selected_columns \\ nil) do
    all_columns = Enum.uniq(["id", "value", "foo_enum"] ++ (selected_columns || []))
    selected_columns = selected_columns || all_columns

    {oid, relation} =
      case relation do
        {oid, {namespace, table}}
        when is_integer(oid) and oid > 0 and is_binary(namespace) and is_binary(table) ->
          relation

        {namespace, table} when is_binary(namespace) and is_binary(table) ->
          {1, relation}
      end

    %Shape{
      root_table: relation,
      root_table_id: oid,
      root_pk: ["id"],
      selected_columns: selected_columns,
      flags: %{
        selects_all_columns: selected_columns == all_columns,
        non_primitive_columns_in_where:
          where_clause && is_map_key(where_clause.used_refs, ["foo_enum"])
      },
      where: where_clause
    }
  end

  def lookup_relation_oid(conn, {namespace, table}) do
    %Postgrex.Result{columns: ["oid"], rows: [[oid]]} =
      Postgrex.query!(conn, "SELECT '#{namespace}.#{table}'::regclass::oid")

    oid
  end

  def fetch_publication_tables(conn, publication_name) do
    %Postgrex.Result{rows: rows} =
      Postgrex.query!(
        conn,
        "SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = '#{publication_name}'"
      )

    for [schema_name, table_name] <- rows, do: {schema_name, table_name}
  end

  def fetch_pg_version(conn) do
    %Postgrex.Result{rows: [[version]]} =
      Postgrex.query!(conn, "SELECT current_setting('server_version_num')::int")

    version
  end

  def fetch_supported_features(conn) do
    {:ok, features} = Electric.Postgres.Inspector.DirectInspector.load_supported_features(conn)
    features
  end

  def patch_snapshotter(fun) do
    test_pid = self()

    Repatch.patch(
      Electric.Shapes.Consumer.Snapshotter,
      :start_streaming_snapshot_from_db,
      [mode: :shared],
      fn consumer, shape_handle, shape, %{stack_id: stack_id, storage: storage} = ctx ->
        send(test_pid, {:snapshot, shape_handle, self()})

        # make it easier to do the right thing here by providing a wrapper
        make_snapshot_fun = fn stream ->
          Electric.Shapes.make_new_snapshot!(stream, storage, stack_id, shape_handle)
        end

        fun.(consumer, shape_handle, shape, Map.put(ctx, :snapshot_fun, make_snapshot_fun))
      end
    )

    activate_mocks_for_descendant_procs(Electric.Shapes.Consumer.Snapshotter)
  end

  def patch_calls(module, global_opts \\ [], funs) do
    Enum.each(funs, fn
      {name, {fun, opts}} when is_function(fun) ->
        Repatch.patch(
          module,
          name,
          Electric.Utils.merge_all([[mode: :shared], global_opts, opts]),
          fun
        )

      {name, fun} when is_function(fun) ->
        Repatch.patch(module, name, Keyword.merge([mode: :shared], global_opts), fun)
    end)
  end

  def expect_calls(module, global_opts \\ [], expectations) do
    Enum.each(expectations, fn
      {name, {fun, opts}} when is_function(fun) ->
        Repatch.Expectations.expect(
          module,
          name,
          Electric.Utils.merge_all([[mode: :shared], global_opts, opts]),
          fun
        )

      {name, fun} when is_function(fun) ->
        Repatch.Expectations.expect(
          module,
          name,
          Keyword.merge([mode: :shared], global_opts),
          fun
        )
    end)
  end

  def patch_shape_status(opts \\ [], funs) do
    patch_calls(Electric.ShapeCache.ShapeStatus, opts, funs)
  end

  def expect_shape_status(opts \\ [], expectations) do
    expect_calls(Electric.ShapeCache.ShapeStatus, opts, expectations)
  end

  def expect_storage(opts \\ [], expectations) do
    expect_calls(Electric.ShapeCache.Storage, opts, expectations)
  end

  def patch_storage(opts \\ [], funs) do
    patch_calls(Electric.ShapeCache.Storage, opts, funs)
  end

  def expect_shape_cache(opts \\ [], expectations) do
    expect_calls(Electric.ShapeCache, opts, expectations)
  end

  def patch_shape_cache(opts \\ [], funs) do
    patch_calls(Electric.ShapeCache, opts, funs)
  end

  def assert_shape_cleanup(shape_handle, timeout \\ 5000) do
    ExUnit.Assertions.assert_receive(
      {Electric.ShapeCache.ShapeCleaner, :cleanup, ^shape_handle},
      timeout
    )
  end

  def activate_mocks_for_descendant_procs(mod) do
    self_pid = self()

    callback_fun = fn pid ->
      Repatch.allow(self_pid, pid)
    end

    callbacks = Process.get(:callback_for_descendant_procs, %{})

    # The descendant process running module `mod` will look up this callback in
    # its root ancestor and execute it.
    Process.put(:callback_for_descendant_procs, Map.put(callbacks, mod, callback_fun))

    :ok
  end

  # This function is normally called inside the init() callback of an OTP behaviour to inherit any
  # `Repatch.patch()`ed functions from the test process.
  #
  # It looks up the test process' PID in the caller process' dictionary and executes the
  # function under the `:callback_for_descendant_procs` key matching the caller's module (if
  # any).
  def activate_mocked_functions_for_module(caller_mod) do
    with {:dictionary, test_process_dict} <-
           Process.get(:"$ancestors") |> List.last() |> Process.info(:dictionary),
         %{^caller_mod => fun} <-
           Keyword.get(test_process_dict, :callback_for_descendant_procs) do
      fun.(self())
    end
  end
end
