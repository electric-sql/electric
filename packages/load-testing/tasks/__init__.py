__version__ = '0.0.1'

from util.electric import ElectricUser
from util.common import get_pg_connection


# Increase the tolerance to heartbeat misses
import locust.runners 
locust.runners.HEARTBEAT_LIVENESS = 300
locust.runners.HEARTBEAT_INTERVAL = 5
locust.runners.MASTER_HEARTBEAT_TIMEOUT = 240
# locust.runners.WORKER_LOG_REPORT_INTERVAL = 30
