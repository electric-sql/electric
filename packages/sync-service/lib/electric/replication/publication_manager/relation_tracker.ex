defmodule Electric.Replication.PublicationManager.RelationTracker do
  @moduledoc """
  Provides interface for shapes to register and deregister themselves
  from a publication, and tracks the overall set of relations that need
  to be published using reference counting.

  Relies on Electric.Replication.PublicationManager.Configurator
  to perform the actual publication updates and handles status updates
  to reply to shapes requesting to be registered.
  """
  use GenServer

  alias Electric.ShapeCache.ShapeCleaner
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @typep shape_handle() :: Electric.ShapeCacheBehaviour.shape_handle()

  defstruct [
    :stack_id,
    :publication_name,
    :publication_refresh_period,
    relation_ref_counts: %{},
    prepared_relation_filters: MapSet.new(),
    submitted_relation_filters: MapSet.new(),
    committed_relation_filters: MapSet.new(),
    tracked_shape_handles: %{},
    waiters: %{},
    # start with optimistic assumption about what the
    # publication supports (altering and generated columns)
    # and rely on the first check to correct that
    publishes_generated_columns?: true
  ]

  @type relation_filters() :: MapSet.t(Electric.oid_relation())
  @typep publication_filter() :: {Electric.oid_relation(), with_generated_cols :: boolean()}
  @typep state() :: %__MODULE__{
           stack_id: Electric.stack_id(),
           relation_ref_counts: %{Electric.oid_relation() => non_neg_integer()},
           prepared_relation_filters: relation_filters(),
           submitted_relation_filters: relation_filters(),
           committed_relation_filters: relation_filters(),
           waiters: %{Electric.oid_relation() => [GenServer.from(), ...]},
           tracked_shape_handles: %{shape_handle() => publication_filter()},
           publication_name: String.t(),
           publishes_generated_columns?: boolean(),
           publication_refresh_period: non_neg_integer()
         }

  @behaviour Electric.Replication.PublicationManager

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
  end

  @impl Electric.Replication.PublicationManager
  def add_shape(stack_id, shape_handle, shape) do
    pub_filter = get_publication_filter_from_shape(shape)

    case GenServer.call(name(stack_id), {:add_shape, shape_handle, pub_filter}) do
      :ok -> :ok
      {:error, err} -> raise err
    end
  end

  @impl Electric.Replication.PublicationManager
  def remove_shape(stack_id, shape_handle) do
    case GenServer.call(name(stack_id), {:remove_shape, shape_handle}) do
      :ok -> :ok
      {:error, err} -> raise err
    end
  end

  @impl Electric.Replication.PublicationManager
  def wait_for_restore(stack_id, opts \\ []) do
    GenServer.call(name(stack_id), :wait_for_restore, Keyword.get(opts, :timeout, :infinity))
  end

  @spec notify_relation_configuration_result(
          Electric.oid_relation(),
          {:ok, term()} | {:error, any()},
          Keyword.t()
        ) :: :ok
  def notify_relation_configuration_result(oid_rel, result, opts) do
    server = Access.get(opts, :server, name(opts))
    GenServer.cast(server, {:relation_configuration_result, oid_rel, result})
  end

  @spec notify_configuration_error({:error, any()}, Keyword.t()) :: :ok
  def notify_configuration_error(result, opts) do
    server = Access.get(opts, :server, name(opts))
    GenServer.cast(server, {:configuration_error, result})
  end

  @spec notify_publication_status(
          Electric.Postgres.Configuration.publication_status(),
          Keyword.t()
        ) :: :ok
  def notify_publication_status(status, opts) do
    server = Access.get(opts, :server, name(opts))
    GenServer.cast(server, {:publication_status, status})
  end

  @spec fetch_current_filters!(Keyword.t()) :: relation_filters()
  def fetch_current_filters!(opts) do
    server = Access.get(opts, :server, name(opts))
    GenServer.call(server, :fetch_current_filters)
  end

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    GenServer.start_link(__MODULE__, opts, name: name(stack_id))
  end

  # --- Private API ---

  @impl true
  def init(opts) do
    opts = Map.new(opts)

    Process.set_label({:publication_manager_relation_tracker, opts.stack_id})
    Logger.metadata(stack_id: opts.stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts.stack_id)

    state = %__MODULE__{
      stack_id: opts.stack_id,
      publication_name: opts.publication_name,
      publication_refresh_period: opts.refresh_period
    }

    {:ok, state, {:continue, :restore_relations}}
  end

  @impl true
  def handle_continue(:restore_relations, state) do
    OpenTelemetry.with_span(
      "publication_manager.restore_relations",
      [],
      state.stack_id,
      fn ->
        state =
          state.stack_id
          |> Electric.ShapeCache.ShapeStatus.list_shapes()
          |> Enum.reduce(
            state,
            fn {shape_handle, shape}, state ->
              add_shape_to_publication_filters(
                shape_handle,
                get_publication_filter_from_shape(shape),
                state
              )
            end
          )

        # filters will be pulled by the configurator on startup, so no
        # need to explicitly call for an update here
        {:noreply, state, state.publication_refresh_period}
      end
    )
  end

  @impl true
  def handle_call({:add_shape, shape_handle, publication_filter}, from, state) do
    {oid_rel, with_gen_cols} = publication_filter

    # if the relation is already committed AND part of the last made
    # update submission, we can consider it ready
    relation_ready? =
      MapSet.member?(state.submitted_relation_filters, oid_rel) and
        MapSet.member?(state.committed_relation_filters, oid_rel)

    state = add_shape_to_publication_filters(shape_handle, publication_filter, state)
    state = update_publication_if_necessary(state)

    cond do
      # if the publication doesn't support generated columns, fail any shapes
      # that require them immediately
      with_gen_cols and not state.publishes_generated_columns? ->
        {
          :reply,
          {:error,
           Electric.DbConfigurationError.publication_missing_generated_columns(
             state.publication_name
           )},
          state,
          state.publication_refresh_period
        }

      relation_ready? ->
        {:reply, :ok, state, state.publication_refresh_period}

      # otherwise, add the caller to the waiters list and reply when the
      # publication is ready
      true ->
        state = add_waiter(from, shape_handle, publication_filter, state)
        {:noreply, state}
    end
  end

  def handle_call({:remove_shape, shape_handle}, _from, state) do
    state = remove_shape_from_publication_filters(shape_handle, state)
    state = update_publication_if_necessary(state)

    # never wait for removals - reply immediately and let publication manager
    # reconcile the publication, otherwise you run into issues where only the last
    # removal fails and all others succeed. No removal guarantees anything about
    # the state of the publication.
    {:reply, :ok, state, state.publication_refresh_period}
  end

  def handle_call(:wait_for_restore, _from, state) do
    {:reply, :ok, state, state.publication_refresh_period}
  end

  def handle_call(:fetch_current_filters, _from, state) do
    {:reply, state.prepared_relation_filters, state, state.publication_refresh_period}
  end

  @impl true
  def handle_cast({:publication_status, status}, state) do
    # if the publication has switched from being able to publish generated columns
    # to not being able to publish them, we need to fail any shapes that depend on
    # that feature
    state =
      if state.publishes_generated_columns? and not status.publishes_generated_columns?,
        do: fail_generated_column_shapes(state),
        else: state

    {:noreply, %{state | publishes_generated_columns?: status.publishes_generated_columns?},
     state.publication_refresh_period}
  end

  def handle_cast({:relation_configuration_result, oid_rel, {:ok, :dropped}}, state) do
    new_committed_filters = MapSet.delete(state.committed_relation_filters, oid_rel)

    {:noreply, %{state | committed_relation_filters: new_committed_filters},
     state.publication_refresh_period}
  end

  def handle_cast({:relation_configuration_result, oid_rel, {:ok, :configured}}, state) do
    state = reply_to_relation_waiters(oid_rel, :ok, state)
    new_committed_filters = MapSet.put(state.committed_relation_filters, oid_rel)

    {:noreply, %{state | committed_relation_filters: new_committed_filters},
     state.publication_refresh_period}
  end

  def handle_cast({:relation_configuration_result, oid_rel, {:error, error}}, state) do
    log_level = if is_known_publication_error(error), do: :warning, else: :error

    Logger.log(
      log_level,
      "Failed to configure publication for relation #{inspect(oid_rel)}: #{inspect(error)}",
      relation: inspect(oid_rel)
    )

    state = reply_to_relation_waiters(oid_rel, {:error, error}, state)

    if not is_struct(error, DBConnection.ConnectionError) do
      ShapeCleaner.remove_shapes_for_relations(
        state.stack_id,
        [oid_rel],
        {:error, Electric.SnapshotError.from_error(error)}
      )
    end

    {:noreply, state, state.publication_refresh_period}
  end

  def handle_cast({:configuration_error, {:error, error}}, state) do
    {:noreply, reply_to_all_waiters({:error, error}, state), state.publication_refresh_period}
  end

  @impl true
  def handle_info(:timeout, state) do
    case Electric.StatusMonitor.status(state.stack_id) do
      %{conn: :up} ->
        state = update_publication(state)
        {:noreply, state, state.publication_refresh_period}

      status ->
        Logger.debug("Publication update skipped due to inactive stack: #{inspect(status)}")
        {:noreply, state}
    end
  end

  @spec update_publication_if_necessary(state()) :: state()
  defp update_publication_if_necessary(state) do
    if update_needed?(state), do: update_publication(state), else: state
  end

  @spec update_publication(state()) :: state()
  defp update_publication(state) do
    Electric.Replication.PublicationManager.Configurator.configure_publication(
      state.stack_id,
      state.prepared_relation_filters
    )

    %{state | submitted_relation_filters: state.prepared_relation_filters}
  end

  defp update_needed?(%__MODULE__{
         prepared_relation_filters: prepared,
         submitted_relation_filters: submitted,
         committed_relation_filters: committed
       }) do
    not MapSet.equal?(prepared, submitted) or not MapSet.equal?(submitted, committed)
  end

  defguardp is_tracking_shape_handle?(shape_handle, state)
            when is_map_key(state.tracked_shape_handles, shape_handle)

  @spec add_shape_to_publication_filters(shape_handle(), publication_filter(), state()) :: state()
  defp add_shape_to_publication_filters(shape_handle, _pub_filter, state)
       when is_tracking_shape_handle?(shape_handle, state) do
    Logger.debug("Shape handle already tracked: #{inspect(shape_handle)}")
    state
  end

  defp add_shape_to_publication_filters(shape_handle, {rel_key, _} = pub_filter, state) do
    state = track_shape_handle(shape_handle, pub_filter, state)
    do_update_relation_filters(rel_key, :add, state)
  end

  @spec remove_shape_from_publication_filters(shape_handle(), state()) :: state()
  defp remove_shape_from_publication_filters(shape_handle, state)
       when not is_tracking_shape_handle?(shape_handle, state) do
    Logger.debug("Shape handle already not tracked: #{inspect(shape_handle)}")
    state
  end

  defp remove_shape_from_publication_filters(shape_handle, state) do
    rel_key = fetch_tracked_shape_relation!(shape_handle, state)
    state = untrack_shape_handle(shape_handle, state)
    do_update_relation_filters(rel_key, :remove, state)
  end

  @spec do_update_relation_filters(
          Electric.oid_relation(),
          :add | :remove,
          state()
        ) :: state()
  defp do_update_relation_filters(
         {_oid, _rel} = rel_key,
         operation,
         %__MODULE__{prepared_relation_filters: prepared, relation_ref_counts: counts} = state
       ) do
    current = Map.get(counts, rel_key, 0)

    new_count =
      case operation do
        :add -> current + 1
        :remove -> max(current - 1, 0)
      end

    # we could rederive the prepared filters from the keys of the counts map
    # but since we're keeping both arouond might as well not iterate over the
    # whole map every time
    {prepared, counts} =
      cond do
        new_count == 0 and current > 0 ->
          {MapSet.delete(prepared, rel_key), Map.delete(counts, rel_key)}

        current == 0 and new_count > 0 ->
          {MapSet.put(prepared, rel_key), Map.put(counts, rel_key, new_count)}

        new_count > 0 ->
          {prepared, Map.put(counts, rel_key, new_count)}

        true ->
          {prepared, counts}
      end

    if not MapSet.member?(prepared, rel_key) do
      reply_to_relation_waiters(
        rel_key,
        {:error, %RuntimeError{message: "Shape removed before updating publication"}},
        state
      )
    end

    %{state | prepared_relation_filters: prepared, relation_ref_counts: counts}
  end

  @spec add_waiter(GenServer.from(), shape_handle(), publication_filter(), state()) ::
          state()
  defp add_waiter(from, shape_handle, pub_filter, %__MODULE__{waiters: waiters} = state) do
    {oid_rel, _} = pub_filter
    from_tuple = {from, shape_handle}
    %{state | waiters: Map.update(waiters, oid_rel, [from_tuple], &[from_tuple | &1])}
  end

  @spec reply_to_relation_waiters(Electric.oid_relation(), any(), state()) :: state()
  defp reply_to_relation_waiters(oid_rel, reply, %__MODULE__{waiters: waiters} = state) do
    rel_waiters = Map.get(waiters, oid_rel, [])
    for {from, _} <- rel_waiters, do: GenServer.reply(from, reply)
    %{state | waiters: Map.delete(waiters, oid_rel)}
  end

  @spec reply_to_all_waiters(any(), state()) :: state()
  defp reply_to_all_waiters(reply, %__MODULE__{waiters: waiters} = state) do
    for {_oid_rel, rel_waiters} <- waiters,
        {from, _} <- rel_waiters,
        do: GenServer.reply(from, reply)

    %{state | waiters: %{}}
  end

  # In case the publication switches from publishing to not publishing generated columns,
  # we fail any shapes and waiters that depend on that feature. We use an inefficient O(n)
  # scan through our tracked shapes to find those that depend on generated columns as this
  # is only expected to happen in the rare cases of publication reconfiguration at runtime.
  @spec fail_generated_column_shapes(state()) :: state()
  defp fail_generated_column_shapes(state) do
    missing_gen_col_error =
      Electric.DbConfigurationError.publication_missing_generated_columns(state.publication_name)

    to_fail =
      state.tracked_shape_handles
      |> Map.filter(fn {_handle, {_oid_rel, with_gen_cols}} -> with_gen_cols end)

    # scan through and reply to any waiters for shapes that require generated columns
    new_waiters =
      to_fail
      |> Enum.group_by(fn {_handle, {oid_rel, _}} -> oid_rel end, fn {handle, _} -> handle end)
      |> Enum.reduce(state.waiters, fn {oid_rel, handles_to_fail}, waiters ->
        if rel_waiters = Map.get(waiters, oid_rel) do
          {to_fail, to_keep} =
            rel_waiters |> Enum.split_with(fn {_from, handle} -> handle in handles_to_fail end)

          for {from, _} <- to_fail,
              do: GenServer.reply(from, {:error, missing_gen_col_error})

          if to_keep == [],
            do: Map.delete(waiters, oid_rel),
            else: Map.put(waiters, oid_rel, to_keep)
        else
          waiters
        end
      end)

    # schedule removals for any tracked shapes that require generated columns
    for {handle, _} <- to_fail do
      ShapeCleaner.remove_shape_async(handle, stack_id: state.stack_id)
    end

    %{state | waiters: new_waiters}
  end

  @spec fetch_tracked_shape_relation!(shape_handle(), state()) :: Electric.oid_relation()
  defp fetch_tracked_shape_relation!(
         shape_handle,
         %__MODULE__{
           tracked_shape_handles: tracked_shape_handles
         } = state
       )
       when is_tracking_shape_handle?(shape_handle, state) do
    {oid_rel, _} = Map.fetch!(tracked_shape_handles, shape_handle)
    oid_rel
  end

  @spec track_shape_handle(shape_handle(), publication_filter(), state()) :: state()
  defp track_shape_handle(
         shape_handle,
         pub_filter,
         %__MODULE__{tracked_shape_handles: tracked_shape_handles} = state
       )
       when not is_tracking_shape_handle?(shape_handle, state) do
    %{state | tracked_shape_handles: Map.put_new(tracked_shape_handles, shape_handle, pub_filter)}
  end

  @spec untrack_shape_handle(shape_handle(), state()) :: state()
  defp untrack_shape_handle(
         shape_handle,
         %__MODULE__{tracked_shape_handles: tracked_shape_handles} = state
       )
       when is_tracking_shape_handle?(shape_handle, state) do
    %{state | tracked_shape_handles: Map.delete(tracked_shape_handles, shape_handle)}
  end

  @spec get_publication_filter_from_shape(Shape.t()) :: publication_filter()
  defp get_publication_filter_from_shape(%Shape{
         root_table: relation,
         root_table_id: oid,
         flags: flags
       }),
       do: {{oid, relation}, Map.get(flags, :selects_generated_columns, false)}

  defp is_known_publication_error(%Electric.DbConfigurationError{}), do: true
  defp is_known_publication_error(%DBConnection.ConnectionError{}), do: true

  defp is_known_publication_error(%Postgrex.Error{postgres: %{code: code}})
       when code in [
              :insufficient_privilege,
              :undefined_table,
              :undefined_function
            ],
       do: true

  defp is_known_publication_error(_), do: false
end
