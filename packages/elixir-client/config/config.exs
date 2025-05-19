import Config

if Mix.env() == :test do
  config :junit_formatter,
    report_file: "test-junit-report.xml",
    automatic_create_dir?: true,
    report_dir: "./junit"
end

config :electric,
  start_in_library_mode: true
