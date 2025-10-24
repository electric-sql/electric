defmodule Electric.ShapeRouter.Native do
  @moduledoc """
  Native Implemented Functions (NIFs) for ShapeRouter.

  This module provides the Rust-based implementation of the high-performance
  routing layer. All functions are implemented in Rust via Rustler.
  """

  use Rustler,
    otp_app: :electric,
    crate: "shape_router"

  # NIF stubs - these will be replaced by Rust implementations

  @doc """
  Create a new router instance.
  Returns: `{:ok, router_ref}` or raises NifNotLoadedError.
  """
  def new_router(), do: :erlang.nif_error(:nif_not_loaded)

  @doc """
  Route a WAL operation to matching shapes.

  ## Parameters
  - `router`: Router reference
  - `pk_hash`: 64-bit hash of primary key
  - `old_row`: Serialized old row (nil for INSERT)
  - `new_row`: Serialized new row (nil for DELETE)
  - `changed_columns`: List of changed column IDs

  Returns: List of matching shape IDs
  """
  def route(_router, _pk_hash, _old_row, _new_row, _changed_columns),
    do: :erlang.nif_error(:nif_not_loaded)

  @doc """
  Add a shape to the router.

  ## Parameters
  - `router`: Router reference
  - `shape_id`: Shape identifier
  - `predicate_bytes`: Compiled predicate (serialized)
  - `pk_hashes`: List of PK hashes initially in this shape

  Returns: `true` on success
  """
  def add_shape(_router, _shape_id, _predicate_bytes, _pk_hashes),
    do: :erlang.nif_error(:nif_not_loaded)

  @doc """
  Remove a shape from the router.

  ## Parameters
  - `router`: Router reference
  - `shape_id`: Shape identifier

  Returns: `true` on success
  """
  def remove_shape(_router, _shape_id),
    do: :erlang.nif_error(:nif_not_loaded)

  @doc """
  Rebuild the router's base structures.

  This is a long-running operation (DirtyCpu scheduled).
  Rebuilds presence filter and compacts delta overlay.

  Returns: `true` on success
  """
  def rebuild(_router),
    do: :erlang.nif_error(:nif_not_loaded)

  @doc """
  Get performance metrics as JSON string.

  Returns: JSON string with metrics
  """
  def get_metrics(_router),
    do: :erlang.nif_error(:nif_not_loaded)
end
