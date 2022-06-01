# This file is executed after the code compilation on all environments
# (dev, test, and prod) - for both Mix and releases.
#
# We use it for runtime configuration of releases in production --
# because that allows us to read environment variables at runtime
# rather than compile time.

import Config

if config_env() == :prod do
  throw(:NotImplemented)
end
