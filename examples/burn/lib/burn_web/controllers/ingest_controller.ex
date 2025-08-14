defmodule BurnWeb.IngestController do
  use BurnWeb, :controller

  alias Burn.{
    Ingest,
    Repo,
    Threads
  }

  alias Phoenix.Sync.Writer
  alias Writer.Format

  def ingest(%{assigns: %{current_user: user}} = conn, %{"mutations" => mutations}) do
    {:ok, txid, _changes} =
      Writer.new()
      |> Writer.allow(
        Threads.Event,
        accept: [:insert],
        check: &Ingest.check_event(&1, user)
      )
      |> Writer.allow(
        Threads.Membership,
        accept: [:insert, :delete],
        check: &Ingest.check_membership(&1, user),
        load: &Ingest.load_membership(&1, user),
        insert: [
          post_apply: &Ingest.on_insert_membership(&1, &2, &3, user)
        ]
      )
      |> Writer.allow(
        Threads.Thread,
        accept: [:insert, :update],
        load: &Ingest.load_thread(&1, user),
        insert: [
          # N.b.: passing the current `user` as an argument implicitly
          # assumes that the current user is the thread owner.
          post_apply: &Ingest.on_insert_thread(&1, &2, &3, user)
        ]
      )
      |> Writer.apply(mutations, Repo, format: Format.TanstackDB)

    json(conn, %{txid: Integer.to_string(txid)})
  end
end
