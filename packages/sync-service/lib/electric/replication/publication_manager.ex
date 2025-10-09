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
    # %{ {oid, relation} => count }
    :relation_ref_counts,
    # %MapSet{{oid, relation}}
    :prepared_relation_filters,
    # same shape as above (what DB/pub currently has)
    :committed_relation_filters,
    :update_debounce_timeout,
    :scheduled_updated_ref,
    :retries,
    :waiters,
    # MapSet of shape handles we've seen
    :tracked_shape_handles,
    :publication_name,
    :db_pool,
    :can_alter_publication?,
    :manual_table_publishing?,
    :publication_refresh_period,
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
           waiters: list(GenServer.from()),
           tracked_shape_handles: %{shape_handle() => Electric.oid_relation()},
           publication_name: String.t(),
           db_pool: term(),
           publication_refresh_period: non_neg_integer(),
           next_update_forced?: boolean()
         }

  @retry_timeout 300
  @max_retries 3

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
      relation_ref_counts: %{},
      prepared_relation_filters: MapSet.new(),
      committed_relation_filters: MapSet.new(),
      scheduled_updated_ref: nil,
      retries: 0,
      waiters: [],
      tracked_shape_handles: %{},
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

    if update_needed?(state) do
      state = add_waiter(from, state)
      state = schedule_update_publication(state.update_debounce_timeout, state)
      {:noreply, state}
    else
      {:reply, :ok, state, state.publication_refresh_period}
    end
  end

  def handle_call({:remove_shape, shape_handle}, from, state) do
    state = remove_shape_from_relation_filters(shape_handle, state)

    if update_needed?(state) do
      state = add_waiter(from, state)
      state = schedule_update_publication(state.update_debounce_timeout, state)
      {:noreply, state}
    else
      {:reply, :ok, state, state.publication_refresh_period}
    end
  end

  defguardp is_fatal(err)
            when is_exception(err, Postgrex.Error) and
                   err.postgres.code in ~w|undefined_function undefined_table insufficient_privilege|a

  @impl true
  def handle_info(:update_publication, state) do
    # Clear out the timer ref
    if state.scheduled_updated_ref, do: Process.cancel_timer(state.scheduled_updated_ref)
    state = %{state | scheduled_updated_ref: nil}

    # Invoke the actual handler for the publication update
    updated_state =
      if not state.can_alter_publication? or state.manual_table_publishing? do
        check_publication_relations(state)
      else
        update_publication_state(state)
      end

    with {:ok, state} <- updated_state do
      # Schedule a forced refresh to happen periodically unless there's an explicit call to
      # update the publication that happens sooner.
      {:noreply, state, state.publication_refresh_period}
    end
  end

  def handle_info(:timeout, state) do
    case Electric.StatusMonitor.status(state.stack_id) do
      %{conn: :up} ->
        handle_info(:update_publication, %{state | next_update_forced?: true})

      status ->
        Logger.debug("Publication update skipped due to inactive stack: #{inspect(status)}")
        {:noreply, state}
    end
  end

  defp check_publication_relations(
         %__MODULE__{
           committed_relation_filters: committed_filters,
           prepared_relation_filters: current_filters,
           next_update_forced?: forced?
         } = state
       ) do
    if not forced? and filters_are_equal?(current_filters, committed_filters) do
      Logger.debug("No changes to publication, skipping checkup")
      {:ok, reply_to_waiters(:ok, state)}
    else
      # We cannot modify the publication, so we only check whether it is in the right state for
      # the set of currently active relation filters.
      case Configuration.check_publication_relations_and_identity(
             state.db_pool,
             committed_filters,
             current_filters,
             state.publication_name
           ) do
        {:ok, modified_relations} ->
          update_relation_filters(state, modified_relations)

        {:error, reason} ->
          # Whatever the error, we must invalidate the shapes that match the errored relations
          # to ensure there's no missed data for a shape after the publication state has been
          # corrected by the database admin.
          {error_type, relations} = reason

          Logger.info(
            "Cleaning up shapes for misconfigured or unpublished relations #{inspect(relations)}"
          )

          relations
          |> MapSet.to_list()
          |> ShapeCleaner.remove_shapes_for_relations(stack_id: state.stack_id)

          tables = Enum.map(relations, fn {_oid, relation} -> Utils.relation_to_sql(relation) end)
          message = publication_error_message(error_type, tables, state)
          error = %Electric.DbConfigurationError{type: reason, message: message}

          state = reply_to_waiters({:error, error}, state)
          {:ok, %{state | next_update_forced?: false}}
      end
    end
  end

  defp update_publication_state(%__MODULE__{retries: retries} = state) do
    state = %{state | retries: 0}

    case update_publication(state) do
      {:ok, state, missing_relations} ->
        update_relation_filters(state, missing_relations)

      # Handle the case where the publication is not present as a fatal one
      {:error,
       %Postgrex.Error{
         postgres: %{
           code: :undefined_object,
           message: "publication" <> _,
           severity: "ERROR",
           pg_code: "42704"
         }
       } = err} ->
        Logger.warning(
          "The publication was expected to be present but was not found: #{inspect(err)}"
        )

        state = reply_to_waiters({:error, err}, state)
        {:stop, {:shutdown, err}, state}

      {:error, err} when retries < @max_retries and not is_fatal(err) ->
        Logger.warning("Failed to configure publication, retrying: #{inspect(err)}")
        state = schedule_update_publication(@retry_timeout, %{state | retries: retries + 1})
        {:ok, state}

      {:error, err} ->
        Logger.error("Failed to configure publication: #{inspect(err)}")
        state = reply_to_waiters({:error, err}, state)
        {:ok, %{state | next_update_forced?: false}}
    end
  end

  # invalidated_relations are those that have been modified or dropped from the publication.
  defp update_relation_filters(state, invalidated_relations) do
    if MapSet.size(invalidated_relations) > 0 do
      Logger.info(
        "Relations dropped/renamed since last publication update: #{inspect(MapSet.to_list(invalidated_relations))}"
      )

      invalidated_relations
      |> MapSet.to_list()
      |> ShapeCleaner.remove_shapes_for_relations(stack_id: state.stack_id)
    end

    state = reply_to_waiters(:ok, state)
    committed_filters = MapSet.difference(state.prepared_relation_filters, invalidated_relations)

    {:ok,
     %{
       state
       | committed_relation_filters: committed_filters,
         next_update_forced?: false,
         # We're setting "prepared" filters to the committed filters, despite us maybe dropping missing relations from these filters.
         # This is correct, because for every filter we're dropping, we're also removing the shape from the shape cache,
         # which eventually will do the same thing - this lowers the number of attempted alterations to the DB where we do nothing
         prepared_relation_filters: committed_filters
     }}
  end

  defp publication_error_message(:tables_missing_from_publication, tables, state) do
    tail =
      cond do
        state.manual_table_publishing? ->
          "the ELECTRIC_MANUAL_TABLE_PUBLISHING setting prevents Electric from adding "

        not state.can_alter_publication? ->
          "Electric lacks privileges to add "
      end

    {table_clause, pronoun} =
      case tables do
        [table] -> {"table " <> inspect(table) <> " is", "it"}
        _ -> {"tables " <> inspect(tables) <> " are", "them"}
      end

    "Database #{table_clause} missing from the publication and " <> tail <> pronoun
  end

  defp publication_error_message(:misconfigured_replica_identity, tables, _state) do
    table_clause =
      case tables do
        [table] -> "table #{inspect(table)} does not have its"
        _ -> "tables #{inspect(tables)} do not have their"
      end

    "Database #{table_clause} replica identity set to FULL"
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

  defp update_needed?(%__MODULE__{
         prepared_relation_filters: prepared,
         committed_relation_filters: committed
       }) do
    not filters_are_equal?(prepared, committed)
  end

  # Updates are forced when we're doing periodic checks: we expect no changes to the filters,
  # but we'll write them anyway because that'll verify that no tables have been dropped/renamed
  # since the last update. Useful when we're not altering the publication often to catch changes
  # to the DB.
  @spec update_publication(state()) :: {:ok, state(), relation_filters()} | {:error, term()}
  defp update_publication(
         %__MODULE__{
           committed_relation_filters: committed_filters,
           prepared_relation_filters: current_filters,
           publication_name: publication_name,
           db_pool: db_pool,
           next_update_forced?: forced?
         } = state
       ) do
    # If row filtering is disabled, we only care about changes in actual relations
    # included in the publication
    if not forced? and filters_are_equal?(current_filters, committed_filters) do
      Logger.debug("No changes to publication, skipping update")
      {:ok, state, MapSet.new()}
    else
      try do
        missing_relations =
          Configuration.configure_publication!(
            db_pool,
            committed_filters,
            current_filters,
            publication_name
          )

        {:ok, state, missing_relations}
      rescue
        err -> {:error, err}
      end
    end
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

    %{state | prepared_relation_filters: prepared, relation_ref_counts: counts}
  end

  @spec add_waiter(GenServer.from(), state()) :: state()
  defp add_waiter(from, %__MODULE__{waiters: waiters} = state),
    do: %{state | waiters: [from | waiters]}

  @spec reply_to_waiters(any(), state()) :: state()
  defp reply_to_waiters(reply, %__MODULE__{waiters: waiters} = state) do
    for from <- waiters, do: GenServer.reply(from, reply)
    %{state | waiters: []}
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

  defp filters_are_equal?(old_filters, new_filters), do: MapSet.equal?(old_filters, new_filters)
end
