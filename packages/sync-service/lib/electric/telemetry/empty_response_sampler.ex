defmodule Electric.Telemetry.EmptyResponseSampler do
  @moduledoc """
  Decides the `SampleRate` weight for a shape-GET root span, tail-dropping the spans of
  empty/up-to-date responses to cut trace volume.

  When the drop is enabled, such spans are stamped with `SampleRate = 0`, which
  `Electric.Telemetry.OpenTelemetry.EmptyResponseDropProcessor` recognises as a sentinel
  to drop the span before it is queued for export.

  The decision, in order:

    1. Error responses (`status >= 500`) are kept and stamped with `SampleRate = 1` —
       keep-on-error wins and is checked first.
    2. Empty, non-SSE 2xx responses are dropped (`SampleRate = 0`) when the drop is
       enabled.
    3. Everything else is left unchanged (`:unchanged`), preserving whatever base
       `SampleRate` the upstream rate hint produced.
  """

  @drop_sample_rate 0
  @error_sample_rate 1

  @doc """
  The effective `SampleRate` for a shape-GET root span, or `:unchanged` to leave the base
  rate untouched.

    * `status` - the final HTTP status of the response.
    * `is_empty_response?` - whether the response was empty/up-to-date.
    * `is_sse_response?` - whether the response used server-sent events (excluded from the
      drop).
    * `drop_enabled?` - whether the empty-response drop is enabled.

  Returns `0` (the drop sentinel) for a dropped empty response, `1` for a kept error
  response, or `:unchanged` otherwise.
  """
  @spec sample_rate(integer() | nil, boolean(), boolean(), boolean()) ::
          non_neg_integer() | :unchanged
  def sample_rate(status, is_empty_response?, is_sse_response?, drop_enabled?) do
    cond do
      is_integer(status) and status >= 500 -> @error_sample_rate
      drop_enabled? and is_empty_response? and not is_sse_response? -> @drop_sample_rate
      true -> :unchanged
    end
  end
end
