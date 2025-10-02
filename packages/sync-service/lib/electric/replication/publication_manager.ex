defmodule Electric.Replication.PublicationManager do
  @moduledoc false
  use GenServer

  alias Electric.Postgres.Configuration
  alias Electric.ShapeCache.ShapeCleaner
  alias Electric.Shapes.Shape
  alias Electric.Utils

  require Logger

  @typep shape_handle() :: Electric.ShapeCacheBehaviour.shape_handle()

  @callback name(binary() | Keyword.t()) :: term()
  @callback add_shape(shape_handle(), Shape.t(), Keyword.t()) :: :ok
  @callback remove_shape(shape_handle(), Keyword.t()) :: :ok

  defstruct [
    :stack_id,
    :update_debounce_timeout,
    :publication_name,
    :db_pool,
    :can_alter_publication?,
    :manual_table_publishing?,
    :publication_refresh_period,
    relation_ref_counts: %{},
    prepared_relation_filters: MapSet.new(),
    committed_relation_filters: MapSet.new(),
    tracked_shape_handles: %{},
    waiters: %{},
    scheduled_updated_ref: nil,
    next_update_forced?: false
  ]

  @type relation_filters() :: MapSet.t(Electric.oid_relation())
  @typep state() :: %__MODULE__{
           stack_id: Electric.stack_id(),
           relation_ref_counts: %{Electric.oid_relation() => non_neg_integer()},
           prepared_relation_filters: relation_filters(),
           committed_relation_filters: relation_filters(),
           update_debounce_timeout: timeout(),
           scheduled_updated_ref: nil | reference(),
           waiters: %{Electric.oid_relation() => [GenServer.from(), ...]},
           tracked_shape_handles: %{shape_handle() => Electric.oid_relation()},
           publication_name: String.t(),
           db_pool: term(),
           can_alter_publication?: boolean(),
           manual_table_publishing?: boolean(),
           publication_refresh_period: non_neg_integer(),
           next_update_forced?: boolean()
         }

  # The default debounce timeout is 0, which means that the publication update
  # will be scheduled immediately to run at the end of the current process
  # mailbox, but we are leaving this configurable in case we want larger
  # windows to aggregate shape filter updates
  @default_debounce_timeout 0

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @genserver_name_schema {:or, [:atom, @name_schema_tuple]}
  @schema NimbleOptions.new!(
            name: [type: @genserver_name_schema, required: false],
            stack_id: [type: :string, required: true],
            publication_name: [type: :string, required: true],
            db_pool: [type: {:or, [:atom, :pid, @name_schema_tuple]}],
            can_alter_publication?: [type: :boolean, required: false, default: true],
            manual_table_publishing?: [type: :boolean, required: false, default: false],
            update_debounce_timeout: [type: :timeout, default: @default_debounce_timeout],
            server: [type: :any, required: false],
            refresh_period: [type: :pos_integer, required: false, default: 60_000]
          )

  @behaviour __MODULE__

  @impl __MODULE__
  def name(stack_id) when not is_map(stack_id) and not is_list(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    name(stack_id)
  end

  @impl __MODULE__
  def add_shape(shape_id, shape, opts \\ []) do
    server = Access.get(opts, :server, name(opts))
    oid_relation = get_oid_relation_from_shape(shape)

    case GenServer.call(server, {:add_shape, shape_id, oid_relation}) do
      :ok -> :ok
      {:error, err} -> raise err
    end
  end

  @impl __MODULE__
  def remove_shape(shape_id, opts \\ []) do
    server = Access.get(opts, :server, name(opts))

    case GenServer.call(server, {:remove_shape, shape_id}) do
      :ok -> :ok
      {:error, err} -> raise err
    end
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
      can_alter_publication?: opts.can_alter_publication?,
      manual_table_publishing?: opts.manual_table_publishing?,
      publication_refresh_period: opts.refresh_period
    }

    {:ok, state, state.publication_refresh_period}
  end

  @impl true
  def handle_call({:add_shape, shape_handle, oid_rel}, from, state) do
    state = add_shape_to_relation_filters(shape_handle, oid_rel, state)
    state = schedule_update_if_necessary(state)

    if not relation_tracked?(oid_rel, state) do
      state = add_waiter(from, oid_rel, state)
      {:noreply, state}
    else
      {:reply, :ok, state, state.publication_refresh_period}
    end
  end

  def handle_call({:remove_shape, shape_handle}, _from, state) do
    state = remove_shape_from_relation_filters(shape_handle, state)
    state = schedule_update_if_necessary(state)

    # never wait for removals - reply immediately and let publication manager
    # reconcile the publication, otherwise you run into issues where only the last
    # removal fails and all others succeed. No removal guarantees anything about
    # the state of the publication.
    {:reply, :ok, state, state.publication_refresh_period}
  end

  @impl true
  def handle_info(:update_publication, state) do
    # Clear out the timer ref
    if state.scheduled_updated_ref, do: Process.cancel_timer(state.scheduled_updated_ref)
    state = %{state | scheduled_updated_ref: nil}

    state =
      case check_publication_status(state) do
        {:ok, state} ->
          configure_publication(state)

        {:error, err, state} ->
          Logger.warning("Failed to confirm publication status: #{inspect(err)}")
          reply_to_all_waiters({:error, err}, state)
      end

    # Schedule a forced refresh to happen periodically unless there's an explicit call to
    # update the publication that happens sooner.
    {:noreply, state, state.publication_refresh_period}
  end

  def handle_info(:timeout, state),
    do: handle_info(:update_publication, %{state | next_update_forced?: true})

  @spec check_publication_status(state()) :: {:ok, state()} | {:error, any(), state()}
  defp check_publication_status(state) do
    Configuration.check_publication_status!(state.db_pool, state.publication_name)
    {:ok, %{state | can_alter_publication?: true}}
  rescue
    err in Electric.DbConfigurationError ->
      case err.type do
        :publication_not_owned ->
          # if we can't alter the publication, we can still validate it
          {:ok, %{state | can_alter_publication?: false}}

        _ ->
          # TODO: notify connection manager about misconfiguration so that
          # it can restart itself and set up the publication correctly
          {:error, err, state}
      end

    err ->
      {:error, err, state}
  end

  # Updates are forced when we're doing periodic checks: we expect no changes to the filters,
  # but we'll write them anyway because that'll verify that no tables have been dropped/renamed
  # since the last update. Useful when we're not altering the publication often to catch changes
  # to the DB.
  @spec configure_publication(state()) :: state()
  defp configure_publication(state) do
    can_update? = can_update_publication?(state)

    # If row filtering is disabled, we only care about changes in actual relations
    # included in the publication
    if not state.next_update_forced? and not update_needed?(state) do
      key_word = if can_update?, do: "update", else: "validation"
      Logger.debug("No changes to publication, skipping #{key_word}")
      reply_to_all_waiters(:ok, state)
    else
      state = %{state | next_update_forced?: false}

      try do
        relations_configured =
          if can_update? do
            Configuration.configure_publication!(
              state.db_pool,
              state.publication_name,
              state.prepared_relation_filters
            )
          else
            Configuration.validate_publication_configuration!(
              state.db_pool,
              state.publication_name,
              state.prepared_relation_filters
            )
          end

        handle_publication_update_result(relations_configured, state)
      rescue
        err ->
          key_word = if can_update?, do: "configure", else: "validate"
          Logger.warning("Failed to #{key_word} publication: #{inspect(err)}")
          reply_to_all_waiters({:error, err}, state)
      end
    end
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
      state,
      fn
        {oid_rel, :ok}, state ->
          state = reply_to_relation_waiters(oid_rel, :ok, state)
          new_committed_filters = MapSet.put(state.committed_relation_filters, oid_rel)
          %{state | committed_relation_filters: new_committed_filters}

        {oid_rel, {:error, reason}}, state ->
          error = publication_error(reason, oid_rel, state) || reason

          log_level = if is_known_publication_error(error), do: :warning, else: :error

          Logger.log(
            log_level,
            "Failed to configure publication for relation #{inspect(oid_rel)}: #{inspect(reason)}",
            relation: inspect(oid_rel)
          )

          state = reply_to_relation_waiters(oid_rel, {:error, error}, state)

          prepared_filters = MapSet.delete(state.prepared_relation_filters, oid_rel)
          committed_filters = MapSet.delete(state.committed_relation_filters, oid_rel)
          ShapeCleaner.remove_shapes_for_relations([oid_rel], stack_id: state.stack_id)

          %{
            state
            | committed_relation_filters: committed_filters,
              prepared_relation_filters: prepared_filters
          }
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

  defp relation_tracked?(oid_rel, %__MODULE__{committed_relation_filters: committed}) do
    MapSet.member?(committed, oid_rel)
  end

  defp update_needed?(%__MODULE__{
         prepared_relation_filters: prepared,
         committed_relation_filters: committed
       }) do
    not MapSet.equal?(prepared, committed)
  end

  defp can_update_publication?(%__MODULE__{
         can_alter_publication?: can_alter,
         manual_table_publishing?: manual
       }) do
    can_alter and not manual
  end

  defguardp is_tracking_shape_handle?(shape_handle, state)
            when is_map_key(state.tracked_shape_handles, shape_handle)

  @spec add_shape_to_relation_filters(shape_handle(), Electric.oid_relation(), state()) :: state()
  defp add_shape_to_relation_filters(shape_handle, _rel_key, state)
       when is_tracking_shape_handle?(shape_handle, state) do
    Logger.debug("Shape handle already tracked: #{inspect(shape_handle)}")
    state
  end

  defp add_shape_to_relation_filters(shape_handle, rel_key, state) do
    do_update_relation_filters_with_shape(shape_handle, rel_key, :add, state)
  end

  @spec remove_shape_from_relation_filters(shape_handle(), state()) :: state()
  defp remove_shape_from_relation_filters(shape_handle, state)
       when not is_tracking_shape_handle?(shape_handle, state) do
    Logger.debug("Shape handle already not tracked: #{inspect(shape_handle)}")
    state
  end

  defp remove_shape_from_relation_filters(shape_handle, state) do
    rel_key = fetch_tracked_shape_relation!(shape_handle, state)
    do_update_relation_filters_with_shape(shape_handle, rel_key, :remove, state)
  end

  @spec do_update_relation_filters_with_shape(
          shape_handle(),
          Electric.oid_relation(),
          :add | :remove,
          state()
        ) :: state()
  defp do_update_relation_filters_with_shape(
         shape_handle,
         {_oid, _rel} = rel_key,
         operation,
         %__MODULE__{prepared_relation_filters: prepared, relation_ref_counts: counts} = state
       ) do
    current = Map.get(counts, rel_key, 0)

    {new_count, state} =
      case operation do
        :add ->
          {current + 1, track_shape_handle(shape_handle, rel_key, state)}

        :remove ->
          {max(current - 1, 0), untrack_shape_handle(shape_handle, state)}
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

  @spec add_waiter(GenServer.from(), Electric.oid_relation(), state()) :: state()
  defp add_waiter(from, oid_rel, %__MODULE__{waiters: waiters} = state) do
    %{state | waiters: Map.update(waiters, oid_rel, [from], &[from | &1])}
  end

  @spec reply_to_relation_waiters(Electric.oid_relation(), any(), state()) :: state()
  defp reply_to_relation_waiters(oid_rel, reply, %__MODULE__{waiters: waiters} = state) do
    rel_waiters = Map.get(waiters, oid_rel, [])
    for from <- rel_waiters, do: GenServer.reply(from, reply)
    %{state | waiters: Map.delete(waiters, oid_rel)}
  end

  @spec reply_to_all_waiters(any(), state()) :: state()
  defp reply_to_all_waiters(reply, %__MODULE__{waiters: waiters} = state) do
    Enum.reduce(waiters, state, fn {rel, _}, state ->
      reply_to_relation_waiters(rel, reply, state)
    end)
  end

  defp fetch_tracked_shape_relation!(
         shape_handle,
         %__MODULE__{
           tracked_shape_handles: tracked_shape_handles
         } = state
       )
       when is_tracking_shape_handle?(shape_handle, state) do
    Map.fetch!(tracked_shape_handles, shape_handle)
  end

  defp track_shape_handle(
         shape_handle,
         relation,
         %__MODULE__{tracked_shape_handles: tracked_shape_handles} = state
       )
       when not is_tracking_shape_handle?(shape_handle, state) do
    %{state | tracked_shape_handles: Map.put_new(tracked_shape_handles, shape_handle, relation)}
  end

  defp untrack_shape_handle(
         shape_handle,
         %__MODULE__{tracked_shape_handles: tracked_shape_handles} = state
       )
       when is_tracking_shape_handle?(shape_handle, state) do
    %{state | tracked_shape_handles: Map.delete(tracked_shape_handles, shape_handle)}
  end

  defp get_oid_relation_from_shape(%Shape{root_table: relation, root_table_id: oid}),
    do: {oid, relation}

  defp publication_error(:relation_missing_from_publication, oid_rel, state) do
    tail =
      cond do
        state.manual_table_publishing? ->
          "the ELECTRIC_MANUAL_TABLE_PUBLISHING setting prevents Electric from adding it"

        not state.can_alter_publication? ->
          "Electric lacks privileges to add it"
      end

    {_oid, rel} = oid_rel
    table = rel |> Utils.relation_to_sql() |> Utils.quote_name()

    %Electric.DbConfigurationError{
      type: :relation_missing_from_publication,
      message:
        "Database table #{table} is missing from " <>
          "the publication #{Utils.quote_name(state.publication_name)} and " <>
          tail
    }
  end

  defp publication_error(:misconfigured_replica_identity, oid_rel, _state) do
    {_oid, rel} = oid_rel
    table = rel |> Utils.relation_to_sql() |> Utils.quote_name()

    %Electric.DbConfigurationError{
      type: :misconfigured_replica_identity,
      message: "Database table #{table} does not have its replica identity set to FULL"
    }
  end

  defp publication_error(:schema_changed, oid_rel, _state) do
    {_oid, rel} = oid_rel

    table = rel |> Utils.relation_to_sql() |> Utils.quote_name()

    %Electric.DbConfigurationError{
      type: :schema_changed,
      message: "Database table #{table} has been dropped or renamed"
    }
  end

  defp publication_error(_reason, _oid_rel, _state), do: nil
end
