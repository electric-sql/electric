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
    :db_pool,
    :manual_table_publishing?,
    :publication_refresh_period,
    :restore_retry_timeout,
    relation_ref_counts: %{},
    prepared_relation_filters: MapSet.new(),
    committed_relation_filters: MapSet.new(),
    tracked_shape_handles: %{},
    waiters: %{},
    scheduled_updated_ref: nil,
    # start with optimistic assumption about what the
    # publication supports (altering and generated columns)
    # and rely on the first check to correct that
    publishes_generated_columns?: true,
    can_alter_publication?: true,
    next_update_forced?: false,
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
           update_debounce_timeout: timeout(),
           scheduled_updated_ref: nil | reference(),
           waiters: %{Electric.oid_relation() => [GenServer.from(), ...]},
           tracked_shape_handles: %{shape_handle() => publication_filter()},
           publication_name: String.t(),
           db_pool: term(),
           publishes_generated_columns?: boolean(),
           can_alter_publication?: boolean(),
           manual_table_publishing?: boolean(),
           publication_refresh_period: non_neg_integer(),
           next_update_forced?: boolean(),
           restore_waiters: [GenServer.from()],
           restore_complete?: boolean(),
           restore_retry_timeout: non_neg_integer()
         }

  # The default debounce timeout is 0, which means that the publication update
  # will be scheduled immediately to run at the end of the current process
  # mailbox, but we are leaving this configurable in case we want larger
  # windows to aggregate shape filter updates
  @default_debounce_timeout 0

  # The default retry timeout in case of failed restore attempts
  @default_restore_retry_timeout 1_000

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @genserver_name_schema {:or, [:atom, @name_schema_tuple]}
  @schema NimbleOptions.new!(
            name: [type: @genserver_name_schema, required: false],
            stack_id: [type: :string, required: true],
            publication_name: [type: :string, required: true],
            db_pool: [type: {:or, [:atom, :pid, @name_schema_tuple]}],
            manual_table_publishing?: [type: :boolean, required: false, default: false],
            update_debounce_timeout: [type: :timeout, default: @default_debounce_timeout],
            server: [type: :any, required: false],
            refresh_period: [type: :pos_integer, required: false, default: 60_000],
            restore_retry_timeout: [
              type: :pos_integer,
              required: false,
              default: @default_restore_retry_timeout
            ]
          )

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

  def notify_configuration_result(opts, oid_rel, result) do
    server = Access.get(opts, :server, name(opts))
    GenServer.cast(server, {:configuration_result, oid_rel, result})
  end

  def notify_publication_status(opts, status) do
    server = Access.get(opts, :server, name(opts))
    GenServer.cast(server, {:publication_status, status})
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      stack_id = Keyword.fetch!(opts, :stack_id)

      name = Keyword.get(opts, :name, name(stack_id))

      db_pool =
        Keyword.get(opts, :db_pool, Electric.Connection.Manager.admin_pool(stack_id))

      GenServer.start_link(__MODULE__, [name: name, db_pool: db_pool] ++ opts, name: name)
    end
  end

  # --- Private API ---

  @impl true
  def init(opts) do
    opts = Map.new(opts)

    Process.set_label({:publication_manager, opts.stack_id})
    Logger.metadata(stack_id: opts.stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts.stack_id)

    state = %__MODULE__{
      stack_id: opts.stack_id,
      update_debounce_timeout: Map.get(opts, :update_debounce_timeout, @default_debounce_timeout),
      publication_name: opts.publication_name,
      db_pool: opts.db_pool,
      manual_table_publishing?: opts.manual_table_publishing?,
      publication_refresh_period: opts.refresh_period,
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
            do: schedule_update_publication(0, true, state),
            else: mark_restore_complete(state)

        {:noreply, state, refresh_timeout(state)}
      end
    )
  end

  @impl true
  def handle_call({:add_shape, shape_handle, publication_filter}, from, state) do
    state = add_shape_to_publication_filters(shape_handle, publication_filter, state)
    state = schedule_update_if_necessary(state)

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
    state = schedule_update_if_necessary(state)

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
  def handle_info(:update_publication, state) do
    # Clear out the timer ref
    if state.scheduled_updated_ref, do: Process.cancel_timer(state.scheduled_updated_ref)
    state = %{state | scheduled_updated_ref: nil}

    # state =
    #   OpenTelemetry.with_span(
    #     "publication_manager.update_publication",
    #     [
    #       is_restore: not state.restore_complete?
    #     ],
    #     state.stack_id,
    #     fn ->

    #     end
    #   )

    Electric.Replication.PublicationManager.Configurator.configure_publication(
      state.stack_id,
      state.prepared_relation_filters
    )

    # Schedule a forced refresh to happen periodically unless there's an explicit call to
    # update the publication that happens sooner.
    {:noreply, state, refresh_timeout(state)}
  end

  def handle_info(:timeout, state) do
    case Electric.StatusMonitor.status(state.stack_id) do
      %{conn: :up} ->
        state = schedule_update_publication(0, true, state)
        {:noreply, state, refresh_timeout(state)}

      status ->
        Logger.debug("Publication update skipped due to inactive stack: #{inspect(status)}")
        {:noreply, state}
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

    state = %{
      state
      | can_alter_publication?: status.can_alter_publication?,
        publishes_generated_columns?: status.publishes_generated_columns?
    }

    {:noreply, state}
  end

  def handle_cast({:configuration_result, oid_rel, result}, state) do
    state = handle_publication_update_result(%{oid_rel => result}, state)
    {:noreply, state}
  end

  defguardp is_known_publication_error(error)
            when is_exception(error) and
                   (is_struct(error, Electric.DbConfigurationError) or
                      (is_struct(error, Postgrex.Error) and
                         error.postgres.code in [
                           :insufficient_privilege,
                           :undefined_table,
                           :undefined_function
                         ]))

  defp handle_publication_update_result(relations_configured, state) do
    relations_configured
    |> Enum.reduce(
      %{state | committed_relation_filters: MapSet.new()},
      fn
        {_oid_rel, {:ok, :dropped}}, state ->
          state

        {oid_rel, {:ok, op}}, state when op in [:validated, :added] ->
          state = reply_to_relation_waiters(oid_rel, :ok, state)

          %{
            state
            | committed_relation_filters: MapSet.put(state.committed_relation_filters, oid_rel)
          }

        {oid_rel, {:error, error}}, state ->
          log_level = if is_known_publication_error(error), do: :warning, else: :error

          Logger.log(
            log_level,
            "Failed to configure publication for relation #{inspect(oid_rel)}: #{inspect(error)}",
            relation: inspect(oid_rel)
          )

          state = reply_to_relation_waiters(oid_rel, {:error, error}, state)

          ShapeCleaner.remove_shapes_for_relations([oid_rel], stack_id: state.stack_id)

          state
      end
    )
  end

  defp schedule_update_if_necessary(state) do
    if update_needed?(state) do
      schedule_update_publication(state.update_debounce_timeout, state)
    else
      state
    end
  end

  @spec schedule_update_publication(timeout(), boolean(), state()) :: state()
  defp schedule_update_publication(timeout, forced? \\ false, state)

  defp schedule_update_publication(
         timeout,
         forced?,
         %__MODULE__{scheduled_updated_ref: nil} = state
       ) do
    ref = Process.send_after(self(), :update_publication, timeout)
    %{state | scheduled_updated_ref: ref, next_update_forced?: forced?}
  end

  defp schedule_update_publication(
         _timeout,
         forced?,
         %__MODULE__{scheduled_updated_ref: _} = state
       ),
       do: %{state | next_update_forced?: forced? or state.next_update_forced?}

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
end
