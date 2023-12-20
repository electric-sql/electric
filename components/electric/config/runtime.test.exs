import Config

# it can be useful to turn on sasl_reports which ensure that stacktraces
# from crashed processes are outputted before the vm shuts down
# config :logger,
#   handle_otp_reports: true,
#   handle_sasl_reports: true

config :electric, disable_listeners: true
