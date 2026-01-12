# The process registry is implicitly used by processes in the dev, prod and test environments alike.
#
# Explicitly start the process registry here since the OTP application does not start a
# supervision tree in the test environment.
# Registry.start_link(name: Electric.Application.process_registry(), keys: :unique)

ExUnit.configure(formatters: [JUnitFormatter, ExUnit.CLIFormatter])
ExUnit.start(assert_receive_timeout: 400, exclude: [:slow, :integration], capture_log: true)

# Start electric_client application directly, bypassing OTP's dependency resolution.
# This avoids a circular dependency: electric_client has :electric as an optional dep,
# which gets added to its applications list when compiled in sync-service context,
# causing a deadlock when OTP tries to start both applications.
{:ok, _} = Electric.Client.Application.start(:normal, [])

# Repatch in async tests has lazy recompilation issues, so as a temporary fix
# we force recompilation in the setup. The issue is tracked here:
# https://github.com/hissssst/repatch/issues/2
Repatch.setup(
  recompile: [
    Postgrex,
    Electric.StatusMonitor,
    Electric.Telemetry.Sampler,
    Electric.ShapeCache.ShapeCleaner,
    :otel_tracer
  ]
)
