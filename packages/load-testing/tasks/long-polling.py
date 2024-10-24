import os
import json
from datetime import datetime


from locust import task, constant, events #, web
from locust.runners import MasterRunner

from flask import Blueprint, request

import random

from util.common import get_pg_connection
from util.electric import ElectricUser
import logging

## Long polling latency for number of clients and write frequency.
## Measures the latency of a row travelling from Postgres to all
## waiting clients.
## - See the distribution of latencies in /latency endpoint.
## - SHAPE_FAN_OUT: control the number of shapes that are written
##   for each write.
## - WRITE_RATE: control write frequency in seconds.

# Increase the tolerance to heartbeat misses
# Not sure this is working
import locust.runners
locust.runners.HEARTBEAT_LIVENESS = 300
locust.runners.HEARTBEAT_INTERVAL = 5
locust.runners.MASTER_HEARTBEAT_TIMEOUT = 240

base_url = "/v1/shape/"

shared_max_offset = {}
operation_buckets = {}
master_time_buckets = {}

auth_token = None
database_id = None
connection = None

@events.init_command_line_parser.add_listener
def _(parser):
    parser.add_argument("--write-rate", type=str, env_var="WRITE_RATE", default=-1, help="Write rate in seconds. -1 disables writes")
    parser.add_argument("--shape-fan-out", type=str, env_var="SHAPE_FAN_OUT", default=1, help="Shape fan out")

@events.test_start.add_listener
def _(environment, **kwargs):
    global write_rate, shape_fan_out
    write_rate = int(environment.parsed_options.write_rate)
    if write_rate > 0:
        Writer.wait_time = constant(write_rate)
    else:
        Writer.wait_time = constant(3600)
        Writer.fixed_count = -1
    shape_fan_out = environment.parsed_options.shape_fan_out

# Note: only inits db if running in distributed mode
@events.test_start.add_listener
def on_test_start(environment, **kwargs):
    if not isinstance(environment.runner, MasterRunner):
        pass
    else:
        try:
            connection = get_pg_connection()
            cursor = connection.cursor()
            cursor.execute(open("./tasks/long-polling.sql", "r").read())
            connection.commit()
            connection.close()
        except Exception as e:
            logging.error(f"Failed to init schema: {e}")

class Writer(ElectricUser):
    connection = None
    fixed_count = 1

    def on_start(self):
        self.connection = get_pg_connection()

    def on_stop(self):
        self.connection.close()

    @task
    def write(self):
        cursor = self.connection.cursor()
        cursor.execute(f"select update_timestamp()")
        self.connection.commit()
        cursor.close()

class Client(ElectricUser):
    wait_time = constant(1)

    def on_start(self):
        global database_id, shared_max_offset

        shape = {
            'base_url': base_url,
            'root_table': 'items',
            'database_id': database_id,
            'params': {'offset': '-1'}
        }

        if 'shape_id' in shared_max_offset:
            shape['params']['shape_id'] = shared_max_offset['shape_id']
            shape['params']['offset'] = shared_max_offset['offset']
            if 'cursor' in shared_max_offset:
                shape['params']['cursor'] = shared_max_offset['cursor']
            self.set_shape_options(shape)
            return

        # write fan-out
        if shape_fan_out > 1:
            idx = random.randint(0, shape_fan_out-1)
            shape['where'] = f'id != \'XX{idx}XX\''

        self.set_shape_options(shape)
        self.sync()

        shared_max_offset['shape_id'] = shape['params']['shape_id']
        shared_max_offset['offset'] = shape['params']['offset']

    @task
    def live_mode(self):
        not_before = datetime.now().astimezone()
        result = self.live()
        if 'body' in result:
            handle_response(not_before, result['body'])
        global shared_max_offset
        shape = self.get_shape_options()

        if 'cursor' in shape['params']:
            cursor = int(shape['params']['cursor'])
            if 'cursor' not in shared_max_offset:
                shared_max_offset = {
                    'offset': shape['params']['offset'],
                    'cursor': cursor,
                }
            elif cursor > shared_max_offset['cursor']:
                shared_max_offset = {
                    'offset': shape['params']['offset'],
                    'cursor': cursor
                }
        shared_max_offset['shape_id'] = shape['params']['shape_id']

def handle_response(not_before, rows):
    for row in rows:
        if 'value' in row:
            if 'created_at' not in row['value']:
                continue
            
            created_at = datetime.fromisoformat(row['value']['created_at'])

            if created_at < not_before:
                continue

            now = datetime.now().astimezone()
            time_diff_ms = (now - created_at).microseconds // 1000 # ms

            bucket = (time_diff_ms // 50) * 50 # buckets of 50ms

            op_id = row['value']['counter']

            global operation_buckets
            if op_id not in operation_buckets:
                operation_buckets[op_id] = {'buckets': {}, 'count': 0, 'created_at': created_at}
            op_buckets = operation_buckets[op_id]
            if bucket not in op_buckets['buckets']:
                op_buckets['buckets'][bucket] = 0
            op_buckets['buckets'][bucket] += 1
            op_buckets['count'] += 1

# Handle events bewtween workers and master
@events.report_to_master.add_listener
def on_report_to_master(client_id, data):
    data['operation_buckets'] = operation_buckets.copy()
    operation_buckets.clear()

@events.worker_report.add_listener
def on_worker_report(client_id, data):
    if 'operation_buckets' in data:
        for op_id, buckets_count in data['operation_buckets'].items():
            if op_id not in master_time_buckets:
                master_time_buckets[op_id] = {'buckets': {}, 'count': 0}
            master_time_buckets[op_id]['count'] += buckets_count['count']
            for bucket, count in buckets_count['buckets'].items():
                if bucket not in master_time_buckets[op_id]['buckets']:
                    master_time_buckets[op_id]['buckets'][bucket] = 0
                master_time_buckets[op_id]['buckets'][bucket] += count 
    # logging.info(f'{get_latency_histogram()}')


get_latency_histogram = lambda: sorted(master_time_buckets.items())


# Extend UI
path = os.path.dirname(os.path.abspath(__file__))
extend = Blueprint(
    "extend",
    "extend_web_ui",
    static_folder=f"{path}/static/",
    static_url_path="/extend/static/",
    template_folder=f"{path}/templates/",
)

@events.init.add_listener
def locust_init(environment, **kwargs):

    if environment.web_ui:
        @environment.web_ui.app.after_request
        def extend_stats_response(response):
            if request.path != "/latency":
                return response
            response.headers["Content-Type"] = "application/json"
            response.set_data(
                json.dumps(
                    {"histogram": get_latency_histogram()}
                )
            )
            return response
        environment.web_ui.app.register_blueprint(extend)

@events.reset_stats.add_listener
def on_reset_stats():
    global master_time_buckets, operation_buckets, shared_max_offset
    master_time_buckets.clear()
    shared_max_offset.clear()
    operation_buckets.clear()
