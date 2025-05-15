import Config

is_telemetry_target? = Mix.target() == Electric.MixProject.telemetry_target()

if is_telemetry_target? do
  # Sentry's source-context-related options need to be set in compile-time config files
  # cf. https://hexdocs.pm/sentry/Mix.Tasks.Sentry.PackageSourceCode.html
  config :sentry,
    enable_source_code_context: true,
    root_source_code_paths: [File.cwd!()]
end

if Mix.env() == :test do
  report_file_name =
    if is_telemetry_target?,
      do: "telemetry-test-junit-report.xml",
      else: "regular-test-junit-report.xml"

  config :junit_formatter,
    report_file: report_file_name,
    automatic_create_dir?: true,
    report_dir: "./junit"
end

config :electric,
  start_in_library_mode: Mix.env() == :test
