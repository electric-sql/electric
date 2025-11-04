defmodule Electric.AsyncDeleter do
  @moduledoc """
  A service that batches file/directory deletions by first moving them into a
  per-stack trash directory and then, after a configurable interval, removing
  the trash directory contents in one `rm -rf` operation.

  This reduces filesystem churn when many deletes happen in quick succession
  (e.g. cache eviction) and avoids blocking callers: `delete/1` returns after a
  quick `File.rename/2` into the trash directory.

  Configuration:

    * `:cleanup_interval_ms` - interval in milliseconds after the
       first queued delete before the batch is removed. Defaults to 10000 ms.
  """

  require Logger

  defdelegate child_spec(opts), to: __MODULE__.Supervisor
  defdelegate start_link(opts), to: __MODULE__.Supervisor

  defdelegate trash_dir!(stack_id), to: __MODULE__.RequestHandler
  defdelegate delete(path, opts), to: __MODULE__.RequestHandler
end
