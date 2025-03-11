defmodule Electric.Telemetry.OpenTelemetry.ResourceDetector do
  @behaviour :otel_resource_detector

  # A resource detector is called inside a one-off process and has 5-6 seconds to return
  # the resource.
  #
  # We need to wait just long enough for the OTP application callback to persist
  # an installation_id to the KV store.
  def get_resource(_config) do
    {m, f, a} = Electric.Config.get_env(:persistent_kv)
    kv = apply(m, f, [a])

    installation_id = poll_installation_id(kv, 100)
    :otel_resource.create("instance.installation_id": installation_id)
  end

  defp poll_installation_id(kv, sleep_ms) do
    try do
      Electric.Config.installation_id!(kv)
    rescue
      _ ->
        Process.sleep(sleep_ms)
        poll_installation_id(kv, sleep_ms)
    end
  end
end
