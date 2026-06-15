defmodule Electric.Replication.Changes.LogScrubber do
  @moduledoc """
  Produces log-safe representations of replication events.

  Replication events (`t:Electric.Replication.Changes.TransactionFragment.t/0`
  and `t:Electric.Replication.Changes.Relation.t/0`) carry full row data — a
  single event can be megabytes of customer data. When such an event is logged,
  or embedded in an exit/crash reason that gets logged, that payload is copied
  into the log output and any error tracker (e.g. Sentry) fed from it.

  This module replaces those payloads with a one-line identity summary so the
  logs keep enough context to diagnose a failure (which transaction, which
  relation) without the row data. It offers three operations:

    * `summarize/1` — summarize a single event as a one-line string.
    * `scrub/1` — walk an arbitrary term and replace any event embedded in it
      (in a tuple, list, or map) with its summary, leaving everything else
      untouched.
    * `inspect_scrubbed/1` — `scrub/1` then `Kernel.inspect/2` with bounded
      limits, yielding the string that actually goes into a log line.

  ## Scope of the scrub

  `scrub/1` recurses into tuples, lists (including improper lists) and plain
  maps, which covers the exit-reason shapes seen in practice — for example a
  `:noproc` reason of the form `{:noproc, {GenServer, :call, [pid, {:handle_event,
  event}, timeout]}}`. It deliberately does **not** recurse into the fields of
  non-event structs: rebuilding arbitrary structs is unsafe (enforced keys,
  opaque types), and `inspect_scrubbed/1`'s finite limits bound the damage if an
  event ever hides inside one.
  """

  alias Electric.Replication.Changes.Relation
  alias Electric.Replication.Changes.TransactionFragment

  @typedoc "An event whose payload is scrubbed to an identity summary."
  @type event() :: TransactionFragment.t() | Relation.t()

  # Inspect limits for a scrubbed term. Generous rather than infinite: real exit
  # reasons are small, so a few-thousand element/binary cap leaves them
  # untruncated while still bounding a pathological collection — or an event
  # payload that slips past scrub/1 in some unanticipated reason shape — so
  # neither can dump unbounded row data into the logs.
  @inspect_limit 4000
  @inspect_printable_limit 8192

  @doc """
  Summarize a single replication event as a one-line, payload-free string.

  ## Examples

      iex> alias Electric.Replication.Changes.TransactionFragment
      iex> alias Electric.Postgres.Lsn
      iex> summarize(%TransactionFragment{xid: 42, lsn: %Lsn{segment: 0, offset: 0}, change_count: 3})
      "transaction fragment xid=42 lsn=0/0 changes=3"

      iex> alias Electric.Replication.Changes.Relation
      iex> summarize(%Relation{id: 16384, schema: "public", table: "items"})
      ~S|relation "public"."items" (oid 16384)|
  """
  @spec summarize(event()) :: String.t()
  def summarize(%TransactionFragment{} = fragment) do
    "transaction fragment xid=#{fragment.xid} lsn=#{fragment.lsn} changes=#{fragment.change_count}"
  end

  def summarize(%Relation{} = rel) do
    ~s|relation "#{rel.schema}"."#{rel.table}" (oid #{rel.id})|
  end

  @doc """
  Replace any replication event embedded in `term` with its `summarize/1` string.

  Recurses through tuples, lists and plain maps; every other value — scalars,
  non-event structs — is returned unchanged.

  ## Examples

  An event nested in a tuple/list (the `:noproc` exit-reason shape) is collapsed,
  while the surrounding structure is preserved:

      iex> alias Electric.Replication.Changes.TransactionFragment
      iex> alias Electric.Postgres.Lsn
      iex> event = %TransactionFragment{xid: 42, lsn: %Lsn{segment: 0, offset: 0}, change_count: 3}
      iex> scrub({:noproc, [event]})
      {:noproc, ["#<transaction fragment xid=42 lsn=0/0 changes=3>"]}

  An event nested in a map value is collapsed too:

      iex> alias Electric.Replication.Changes.TransactionFragment
      iex> alias Electric.Postgres.Lsn
      iex> event = %TransactionFragment{xid: 7, lsn: %Lsn{segment: 0, offset: 0}, change_count: 1}
      iex> scrub(%{reason: :crash, event: event})
      %{reason: :crash, event: "#<transaction fragment xid=7 lsn=0/0 changes=1>"}

  Terms without events pass through unchanged:

      iex> scrub({:error, :not_ready})
      {:error, :not_ready}

  Non-event structs are left whole and are not recursed into:

      iex> scrub(%RuntimeError{message: "boom"})
      %RuntimeError{message: "boom"}
  """
  @spec scrub(term()) :: term()
  def scrub(%TransactionFragment{} = event), do: "#<#{summarize(event)}>"
  def scrub(%Relation{} = event), do: "#<#{summarize(event)}>"
  def scrub(%_{} = other_struct), do: other_struct

  def scrub(tuple) when is_tuple(tuple),
    do: tuple |> Tuple.to_list() |> Enum.map(&scrub/1) |> List.to_tuple()

  def scrub(map) when is_map(map),
    do: Map.new(map, fn {k, v} -> {scrub(k), scrub(v)} end)

  # head/tail recursion keeps this safe for improper lists, which can show up
  # in arbitrary exit reasons
  def scrub([head | tail]), do: [scrub(head) | scrub(tail)]
  def scrub(other), do: other

  @doc """
  `scrub/1` a term, then `inspect/2` it with bounded limits for logging.

  ## Examples

      iex> alias Electric.Replication.Changes.TransactionFragment
      iex> alias Electric.Postgres.Lsn
      iex> event = %TransactionFragment{xid: 42, lsn: %Lsn{segment: 0, offset: 0}, change_count: 3}
      iex> inspect_scrubbed({:noproc, [event]})
      ~S|{:noproc, ["#<transaction fragment xid=42 lsn=0/0 changes=3>"]}|
  """
  @spec inspect_scrubbed(term()) :: String.t()
  def inspect_scrubbed(term) do
    term
    |> scrub()
    |> inspect(limit: @inspect_limit, printable_limit: @inspect_printable_limit)
  end
end
