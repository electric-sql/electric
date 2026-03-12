defmodule Support.ConsumerProperty.Scenario do
  @moduledoc """
  Structs representing a generated property test scenario for the Consumer GenServer.
  """

  defmodule ModelState do
    @moduledoc """
    Tracks the state of the modeled database and dependency shape during scenario generation.

    Each row in `rows` is `%{parent_id: integer, value: string}` keyed by integer PK `id`.
    A row is "in shape" when `parent_id` is in `active_linked_values`.
    """
    defstruct next_xid: 100,
              next_lsn: 1000,
              next_row_id: 1,
              rows: %{},
              rows_at_xid: %{},
              lsn_at_xid: %{},
              active_linked_values: MapSet.new(),
              move_in_counter: 0,
              pending_move_ins: %{}
  end

  defstruct events: [],
            expected_rows: %{},
            linked_values_at: %{},
            move_in_results: %{}

  def new(opts) do
    %__MODULE__{
      events: Keyword.fetch!(opts, :events),
      expected_rows: Keyword.fetch!(opts, :expected_rows)
    }
  end

  defimpl Inspect do
    import Inspect.Algebra

    def inspect(scenario, opts) do
      opts = %{opts | charlists: :as_lists}
      {events, opts} = Enum.map_reduce(scenario.events, opts, &convert_event/2)

      events_doc =
        events
        |> Enum.intersperse([",", break(" ")])
        |> then(&concat(["[", nest(concat([break("") | &1]), 2), break(""), "]"]))

      concat([
        "Scenario.new(",
        nest(
          concat([
            break(""),
            color_doc("events: ", :atom, opts),
            events_doc,
            ",",
            break(""),
            color_doc("expected_rows: ", :atom, opts),
            to_doc(scenario.expected_rows, opts)
          ]),
          2
        ),
        break(""),
        ")"
      ])
      |> group()
    end

    defp convert_event({:txn, txn_params}, opts) do
      {concat([
         "{",
         to_doc(:txn, opts),
         ", ",
         color_doc("xid: ", :atom, opts),
         to_doc(txn_params[:xid], opts),
         ", ",
         color_doc("lsn: ", :atom, opts),
         to_doc(txn_params[:lsn], opts),
         ", ",
         color_doc("ops: ", :atom, opts),
         to_doc(txn_params[:ops], opts),
         "}"
       ]), opts}
    end

    defp convert_event({:query_result, kw}, opts) do
      name = Keyword.get(kw, :name)
      snapshot = Keyword.get(kw, :snapshot)
      rows = Keyword.get(kw, :rows)

      {
        concat([
          "{",
          to_doc(:query_result, opts),
          ", ",
          color_doc("name: ", :atom, opts),
          to_doc(name, opts),
          ", ",
          color_doc("snapshot: ", :atom, opts),
          to_doc(snapshot, opts),
          ", ",
          color_doc("rows: ", :atom, opts),
          nest(concat([break(""), to_doc(rows, opts)]), 2),
          "}"
        ]),
        opts
      }
    end

    defp convert_event({:initial_rows, kw}, opts) do
      rows = Keyword.get(kw, :rows, [])

      {
        concat([
          "{",
          to_doc(:initial_rows, opts),
          ", ",
          color_doc("rows: ", :atom, opts),
          to_doc(rows, opts),
          "}"
        ]),
        opts
      }
    end

    defp convert_event(event, opts) do
      to_doc_with_opts(event, opts)
    end
  end
end
