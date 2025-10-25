defmodule Electric.Replication.PublicationManager.RelationTracker do
  @moduledoc """
  Manages a PostgreSQL publication for a given Electric stack, tracking shapes
  and ensuring that the publication configuration matches the required set of
  relations that need to be published for the shapes to function correctly.

  Includes periodic checks of the publication to ensure that it remains valid,
  and expires any shapes that are no longer valid due to schema changes or
  permission issues.
  """
  use GenServer

  alias Electric.ShapeCache.ShapeCleaner
  alias Electric.Shapes.Shape
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @typep shape_handle() :: Electric.ShapeCacheBehaviour.shape_handle()

  defstruct [
    :stack_id,
    :update_debounce_timeout,
    :publication_name,
    :publication_refresh_period,
    :restore_retry_timeout,
    relation_ref_counts: %{},
    prepared_relation_filters: MapSet.new(),
    committed_relation_filters: MapSet.new(),
    tracked_shape_handles: %{},
    waiters: %{},
    # start with optimistic assumption about what the
    # publication supports (altering and generated columns)
    # and rely on the first check to correct that
    publishes_generated_columns?: true,
    restore_waiters: [],
    restore_complete?: false
  ]

  @type relation_filters() :: MapSet.t(Electric.oid_relation())
  @typep publication_filter() :: {Electric.oid_relation(), with_generated_cols :: boolean()}
  @typep state() :: %__MODULE__{
           stack_id: Electric.stack_id(),
           relation_ref_counts: %{Electric.oid_relation() => non_neg_integer()},
           prepared_relation_filters: relation_filters(),
           committed_relation_filters: relation_filters(),
           waiters: %{Electric.oid_relation() => [GenServer.from(), ...]},
           tracked_shape_handles: %{shape_handle() => publication_filter()},
           publication_name: String.t(),
           publishes_generated_columns?: boolean(),
           restore_waiters: [GenServer.from()],
           restore_complete?: boolean(),
           restore_retry_timeout: non_neg_integer()
         }

  @behaviour Electric.Replication.PublicationManager

  @impl Electric.Replication.PublicationManager
  def name(stack_id) when not is_map(stack_id) and not is_list(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    name(stack_id)
  end

  @impl Electric.Replication.PublicationManager
  def add_shape(shape_handle, shape, opts \\ []) do
    server = Access.get(opts, :server, name(opts))
    pub_filter = get_publication_filter_from_shape(shape)

    case GenServer.call(server, {:add_shape, shape_handle, pub_filter}) do
      :ok -> :ok
      {:error, err} -> raise err
    end
  end

  @impl Electric.Replication.PublicationManager
  def remove_shape(shape_handle, opts \\ []) do
    server = Access.get(opts, :server, name(opts))

    case GenServer.call(server, {:remove_shape, shape_handle}) do
      :ok -> :ok
      {:error, err} -> raise err
    end
  end

  @impl Electric.Replication.PublicationManager
  def wait_for_restore(opts \\ []) do
    server = Access.get(opts, :server, name(opts))

    GenServer.call(server, :wait_for_restore, Keyword.get(opts, :timeout, :infinity))
    :ok
  end

  @spec notify_configuration_result(
          Keyword.t(),
          Electric.oid_relation(),
          {:ok, term()} | {:error, any()}
        ) :: :ok
  def notify_configuration_result(opts, oid_rel, result) do
    server = Access.get(opts, :server, name(opts))
    GenServer.cast(server, {:configuration_result, oid_rel, result})
  end

  @spec notify_publication_status(
          Keyword.t(),
          Electric.Postgres.Configuration.publication_status()
        ) :: :ok
  def notify_publication_status(opts, status) do
    server = Access.get(opts, :server, name(opts))
    GenServer.cast(server, {:publication_status, status})
  end

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    GenServer.start_link(__MODULE__, opts, name: Keyword.get(opts, :name, name(stack_id)))
  end

  # --- Private API ---

  @impl true
  def init(opts) do
    opts = Map.new(opts)

    Process.set_label({:relation_tracker, opts.stack_id})
    Logger.metadata(stack_id: opts.stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts.stack_id)

    state = %__MODULE__{
      stack_id: opts.stack_id,
      publication_name: opts.publication_name,
      restore_retry_timeout: opts.restore_retry_timeout
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

        state =
          if update_needed?(state),
            do: update_publication(state),
            else: mark_restore_complete(state)

        {:noreply, state, refresh_timeout(state)}
      end
    )
  end

  @impl true
  def handle_call({:add_shape, shape_handle, publication_filter}, from, state) do
    state = add_shape_to_publication_filters(shape_handle, publication_filter, state)
    state = update_publication_if_necessary(state)

    {oid_rel, with_gen_cols} = publication_filter

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
          refresh_timeout(state)
        }

      # if the relation is already part of the committed publication filters,
      # we can reply immediately
      MapSet.member?(state.committed_relation_filters, oid_rel) ->
        {:reply, :ok, state, refresh_timeout(state)}

      # otherwise, add the caller to the waiters list and reply when the
      # publication is ready
      true ->
        state = add_waiter(from, shape_handle, publication_filter, state)
        {:noreply, state, refresh_timeout(state)}
    end
  end

  def handle_call({:remove_shape, shape_handle}, _from, state) do
    state = remove_shape_from_publication_filters(shape_handle, state)
    state = update_publication_if_necessary(state)

    # never wait for removals - reply immediately and let publication manager
    # reconcile the publication, otherwise you run into issues where only the last
    # removal fails and all others succeed. No removal guarantees anything about
    # the state of the publication.
    {:reply, :ok, state, refresh_timeout(state)}
  end

  def handle_call(:wait_for_restore, from, state) do
    if state.restore_complete? do
      {:reply, :ok, state, refresh_timeout(state)}
    else
      state = %{state | restore_waiters: [from | state.restore_waiters]}
      {:noreply, state, refresh_timeout(state)}
    end
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

    {:noreply, %{state | publishes_generated_columns?: status.publishes_generated_columns?}}
  end

  def handle_cast({:configuration_result, oid_rel, {:ok, :dropped}}, state) do
    new_committed_filters = MapSet.delete(state.committed_relation_filters, oid_rel)
    {:noreply, %{state | committed_relation_filters: new_committed_filters}}
  end

  def handle_cast({:configuration_result, oid_rel, {:ok, res}}, state)
      when res in [:validated, :added] do
    state = reply_to_relation_waiters(oid_rel, :ok, state)
    new_committed_filters = MapSet.put(state.committed_relation_filters, oid_rel)
    {:noreply, %{state | committed_relation_filters: new_committed_filters}}
  end

  def handle_cast({:configuration_result, oid_rel, {:error, error}}, state) do
    log_level = if is_known_publication_error(error), do: :warning, else: :error

    Logger.log(
      log_level,
      "Failed to configure publication for relation #{inspect(oid_rel)}: #{inspect(error)}",
      relation: inspect(oid_rel)
    )

    state = reply_to_relation_waiters(oid_rel, {:error, error}, state)

    ShapeCleaner.remove_shapes_for_relations([oid_rel], stack_id: state.stack_id)

    {:noreply, state}
  end

  @impl true
  def handle_info(:timeout, state) do
    case Electric.StatusMonitor.status(state.stack_id) do
      %{conn: :up} ->
        state = update_publication(state)
        {:noreply, state, refresh_timeout(state)}

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

    state
  end

  defp mark_restore_complete(%{restore_complete?: true} = state), do: state

  defp mark_restore_complete(state) do
    for waiter <- state.restore_waiters, do: GenServer.reply(waiter, :ok)
    %{state | restore_complete?: true, restore_waiters: []}
  end

  defp update_needed?(%__MODULE__{
         prepared_relation_filters: prepared,
         committed_relation_filters: committed
       }) do
    not MapSet.equal?(prepared, committed)
  end

  defp refresh_timeout(%{restore_complete?: false, restore_retry_timeout: timeout}), do: timeout
  defp refresh_timeout(%{publication_refresh_period: period}), do: period

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

  defp is_known_publication_error(%Postgrex.Error{postgres: %{code: code}})
       when code in [
              :insufficient_privilege,
              :undefined_table,
              :undefined_function
            ],
       do: true

  defp is_known_publication_error(_), do: false
end
