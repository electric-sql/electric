defmodule Electric.Postgres.ReplicationClient.ConnectionSetup do
  @moduledoc """
  This module encapsulates the initial setup of a replication connection opened by
  `Electric.Postgres.ReplicationClient`.

  A state machine is implemented to run a series of SQL queries prior to switching the
  connection into the logical streaming mode. This helps keep the main `ReplicationClient`
  module focused on the handling of logical messages.
  """
  alias Electric.Utils

  require Logger

  @type state :: Electric.Postgres.ReplicationClient.State.t()
  @type step :: Electric.Postgres.ReplicationClient.step()
  @type callback_return ::
          {:noreply, state}
          | {:query, iodata, state}
          | {:stream, iodata, Postgrex.ReplicationConnection.stream_opts(), state}
  @type query_result :: [Postgrex.Result.t()] | Postgrex.Error.t()

  # The entrypoint to the connection setup that picks the first step to run and returns the
  # `{:query, ...}` tuple for it.
  @spec start(state) :: callback_return
  def start(%{step: :connected} = state) do
    next_step = next_step(state)
    query_for_step(next_step, %{state | step: next_step})
  end

  # Process the result of executing the query, pick the next step and return the `{:query, ...}`
  # tuple for it.
  @spec process_query_result(query_result, state) :: callback_return
  def process_query_result(result, %{step: step} = state) do
    state = dispatch_query_result(step, result, state)
    next_step = next_step(state)
    query_for_step(next_step, %{state | step: next_step})
  end

  # Instruct `Postgrex.ReplicationConnection` to switch the connection into the logical
  # streaming mode.
  @spec start_streaming(state) :: callback_return
  def start_streaming(%{step: :ready_to_stream} = state) do
    query_for_step(:streaming, %{state | step: :streaming})
  end

  ###

  defp create_publication_query(state) do
    # We're creating an "empty" publication because first snapshot creation should add the table
    query = "CREATE PUBLICATION #{Utils.quote_name(state.publication_name)}"
    {:query, query, state}
  end

  # Successfully created the publication.
  defp create_publication_result([%Postgrex.Result{}], state) do
    state
  end

  defp create_publication_result(%Postgrex.Error{} = error, state) do
    error_message = "publication \"#{state.publication_name}\" already exists"

    case error.postgres do
      %{code: :duplicate_object, pg_code: "42710", message: ^error_message} ->
        # Publication already exists, proceed to the next step.
        state

      _ ->
        # Unexpected error, fail loudly.
        raise error
    end
  end

  ###

  defp create_slot_query(state) do
    query =
      "CREATE_REPLICATION_SLOT #{Utils.quote_name(state.slot_name)} LOGICAL pgoutput NOEXPORT_SNAPSHOT"

    {:query, query, state}
  end

  # Sucessfully created the replication slot.
  defp create_slot_result([%Postgrex.Result{} = result], state) do
    log_slot_creation_result(result)
    state
  end

  defp create_slot_result(%Postgrex.Error{} = error, state) do
    error_msg = "replication slot \"#{state.slot_name}\" already exists"

    case error.postgres do
      %{code: :duplicate_object, pg_code: "42710", message: ^error_msg} ->
        # Slot already exists, proceed to the next step.
        Logger.debug("Found existing replication slot")
        state

      _ ->
        # Unexpected error, fail loudly.
        raise error
    end
  end

  defp log_slot_creation_result(result) do
    Logger.debug(fn ->
      %Postgrex.Result{
        command: :create,
        columns: ["slot_name", "consistent_point", "snapshot_name", "output_plugin"],
        rows: [[_, lsn_str, nil, _]],
        num_rows: 1,
        connection_id: _,
        messages: []
      } = result

      "Created new slot at lsn=#{lsn_str}"
    end)
  end

  ###

  # Start a long query that will block until the lock becomes available, based
  # on a hash of the slot name to ensure lock is held even if slot is recreated.
  # NOTE: alternatively use pg_try_advisory_lock and retry with exponential backoff
  defp waiting_for_lock_query(state) do
    query = "SELECT pg_advisory_lock(hashtext('#{state.slot_name}'))"
    {:query, query, state}
  end

  # Sucessfully acquired the lock for the replication slot.
  defp waiting_for_lock_result([%Postgrex.Result{} = _result], state) do
    Logger.debug("Acquired advisory lock on replication slot")
    state
  end

  defp waiting_for_lock_result(%Postgrex.Error{} = error, _state) do
    # Unexpected error, fail loudly.
    raise error
  end

  ###

  defp set_display_setting_query(%{display_settings: [query | rest]} = state) do
    {:query, query, %{state | display_settings: rest}}
  end

  defp set_display_setting_result([%Postgrex.Result{}], state) do
    state
  end

  defp set_display_setting_result(%Postgrex.Error{} = error, _state) do
    # Unexpected error, fail loudly.
    raise error
  end

  ###

  # This is one of the two terminal states of our state machine that puts the process into an
  # idling state until it receives a `:start_streaming` message.
  #
  # The other terminal state is implemented in `start_replication_slot_query/1`.
  defp ready_to_stream(state) do
    {:noreply, state}
  end

  ###

  # After Postgres executes the `START_REPLICATION` command, it will switch to the logical
  # streaming mode. That's why this function must return a `{:stream, ...}` and no queries
  # will be executed after this.
  defp start_replication_slot_query(state) do
    query =
      "START_REPLICATION SLOT #{Utils.quote_name(state.slot_name)} LOGICAL 0/0 (proto_version '1', publication_names '#{state.publication_name}')"

    Logger.info("Starting replication from postgres")

    {:stream, query, [], state}
  end

  ### Below you'll find the boilerplate needed to put the state machine together.

  # This function defines the transition table for our ad-hoc state machine that determines which
  # step leads to which next one.
  #
  # This is how we order the queries to be executed prior to switching into the logical streaming mode.
  @spec next_step(state) :: step

  defp next_step(%{step: :connected, try_creating_publication?: true}), do: :create_publication
  defp next_step(%{step: :connected}), do: :create_slot
  defp next_step(%{step: :create_publication}), do: :create_slot
  defp next_step(%{step: :create_slot}), do: :waiting_for_lock
  defp next_step(%{step: :waiting_for_lock}), do: :set_display_setting

  defp next_step(%{step: :set_display_setting, display_settings: queries}) when queries != [],
    do: :set_display_setting

  defp next_step(%{step: :set_display_setting, start_streaming?: true}), do: :streaming
  defp next_step(%{step: :set_display_setting}), do: :ready_to_stream

  ###

  # Helper function that dispatches each step to a function specific to it. This is done so
  # that query and result processing functions for the same step can be grouped together in
  # this module.
  @spec query_for_step(step, state) :: callback_return

  defp query_for_step(:create_publication, state), do: create_publication_query(state)
  defp query_for_step(:create_slot, state), do: create_slot_query(state)
  defp query_for_step(:waiting_for_lock, state), do: waiting_for_lock_query(state)
  defp query_for_step(:set_display_setting, state), do: set_display_setting_query(state)
  defp query_for_step(:ready_to_stream, state), do: ready_to_stream(state)
  defp query_for_step(:streaming, state), do: start_replication_slot_query(state)

  ###

  # Helper function that dispatches processing of a query result to a function specific to
  # that query's step. This is again done to facilitate grouping functions for the same step.
  @spec dispatch_query_result(step, query_result, state) :: state | no_return

  defp dispatch_query_result(:create_publication, result, state),
    do: create_publication_result(result, state)

  defp dispatch_query_result(:create_slot, result, state),
    do: create_slot_result(result, state)

  defp dispatch_query_result(:waiting_for_lock, result, state),
    do: waiting_for_lock_result(result, state)

  defp dispatch_query_result(:set_display_setting, result, state),
    do: set_display_setting_result(result, state)
end
