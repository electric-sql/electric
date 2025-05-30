# The process registry is implicitly used by processes in the dev, prod and test environments alike.
#
# Explicitly start the process registry here since the OTP application does not start a
# supervision tree in the test environment.
# Registry.start_link(name: Electric.Application.process_registry(), keys: :unique)

ExUnit.configure(formatters: [JUnitFormatter, ExUnit.CLIFormatter])
ExUnit.start(assert_receive_timeout: 400, exclude: [:slow, :telemetry_target], capture_log: true)
Repatch.setup()
