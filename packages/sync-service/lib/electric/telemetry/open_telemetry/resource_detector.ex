if Code.ensure_loaded?(:otel_resource) do
  defmodule Electric.Telemetry.OpenTelemetry.ResourceDetector do
    @behaviour :otel_resource_detector

    # FIXME(alco): either avoid calling this in Cloud or check whether there is already installation_id set for the resource
    def get_resource(_config) do
      {m, f, a} = Electric.Config.get_env(:persistent_kv)
      kv = apply(m, f, [a])

      try do
        installation_id = Electric.Config.installation_id!(kv)
        :otel_resource.create("instance.installation_id": installation_id)
      rescue
        _ -> :otel_resource.create([])
      end
    end
  end
end
