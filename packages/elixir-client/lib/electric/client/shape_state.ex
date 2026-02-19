defmodule Electric.Client.ShapeState do
  @moduledoc """
  State for polling a shape.

  This struct holds the state needed between polling requests, including:
  - The shape handle and offset for resuming
  - Schema and value mapper for parsing responses
  - Tag tracking data for generating synthetic deletes from move-out events

  ## Usage

      # Create initial state
      state = ShapeState.new()

      # Poll for changes
      {:ok, messages, new_state} = Client.poll(client, shape, state)

      # State can also be created from a ResumeMessage (interop with stream API)
      state = ShapeState.from_resume(resume_message)
  """

  alias Electric.Client
  alias Electric.Client.Offset
  alias Electric.Client.Message.ResumeMessage
  alias Electric.Client.Util

  defstruct [
    :shape_handle,
    :schema,
    :value_mapper_fun,
    :next_cursor,
    :stale_cache_buster,
    offset: Offset.before_all(),
    up_to_date?: false,
    tag_to_keys: %{},
    key_data: %{},
    stale_cache_retry_count: 0
  ]

  @type t :: %__MODULE__{
          shape_handle: Client.shape_handle() | nil,
          offset: Offset.t(),
          schema: Client.schema() | nil,
          value_mapper_fun: Client.ValueMapper.mapper_fun() | nil,
          next_cursor: binary() | nil,
          up_to_date?: boolean(),
          tag_to_keys: %{optional(term()) => MapSet.t()},
          key_data: %{optional(term()) => %{tags: MapSet.t(), msg: term()}},
          stale_cache_buster: String.t() | nil,
          stale_cache_retry_count: non_neg_integer()
        }

  @doc """
  Create a new initial polling state.

  ## Options

    * `:shape_handle` - Optional shape handle to resume from
    * `:offset` - Optional offset to resume from (default: before_all)
    * `:schema` - Optional schema for value mapping

  """
  @spec new(keyword()) :: t()
  def new(opts \\ []) do
    struct(__MODULE__, opts)
  end

  @doc """
  Create polling state from a ResumeMessage.

  This allows interop between the streaming and polling APIs - you can
  use `live: false` to get a ResumeMessage from a stream, then continue
  polling from that point.
  """
  @spec from_resume(ResumeMessage.t()) :: t()
  def from_resume(%ResumeMessage{} = resume) do
    %__MODULE__{
      shape_handle: resume.shape_handle,
      offset: resume.offset,
      schema: resume.schema,
      up_to_date?: true,
      tag_to_keys: Map.get(resume, :tag_to_keys, %{}),
      key_data: Map.get(resume, :key_data, %{})
    }
  end

  @doc """
  Reset polling state for a new shape handle, preserving schema and value mapper.

  Used when a 409 (must-refetch) response is received — the shape handle changes
  but the schema remains the same.
  """
  @spec reset(t(), Client.shape_handle()) :: t()
  def reset(%__MODULE__{} = state, shape_handle) do
    %{
      state
      | offset: Offset.before_all(),
        shape_handle: shape_handle,
        up_to_date?: false,
        next_cursor: nil,
        tag_to_keys: %{},
        key_data: %{}
    }
  end

  @doc """
  Convert polling state to a ResumeMessage for use with the streaming API.
  """
  @spec to_resume(t()) :: ResumeMessage.t()
  def to_resume(%__MODULE__{} = state) do
    %ResumeMessage{
      shape_handle: state.shape_handle,
      offset: state.offset,
      schema: state.schema,
      tag_to_keys: state.tag_to_keys,
      key_data: state.key_data
    }
  end

  @doc """
  Enter stale retry mode by setting a cache buster and incrementing the retry count.

  Called when a stale CDN response is detected - the server returns an expired
  handle that matches our cached expired handle.
  """
  @spec enter_stale_retry(t()) :: t()
  def enter_stale_retry(%__MODULE__{} = state) do
    %{
      state
      | stale_cache_buster: generate_cache_buster(),
        stale_cache_retry_count: state.stale_cache_retry_count + 1
    }
  end

  @doc """
  Clear stale retry state after a successful response.

  Called when we receive a fresh (non-stale) response from the server.
  """
  @spec clear_stale_retry(t()) :: t()
  def clear_stale_retry(%__MODULE__{} = state) do
    %{
      state
      | stale_cache_buster: nil,
        stale_cache_retry_count: 0
    }
  end

  @doc """
  Generate a random cache buster string.

  Uses 8 random bytes encoded as hex (16 characters).
  """
  @spec generate_cache_buster() :: String.t()
  def generate_cache_buster do
    Util.generate_id(8)
  end
end
