from locust import events

import psycopg2

@events.init_command_line_parser.add_listener
def _(parser):
    parser.add_argument("--db-user", type=str, env_var="DB_USER", default="postgres", help="Database user")
    parser.add_argument("--db-password", type=str, env_var="DB_PASSWORD", default="password", help="Database password")
    parser.add_argument("--db-host", type=str, env_var="DB_HOST", default="localhost", help="Database host")
    parser.add_argument("--db-port", type=int, env_var="DB_PORT", default=54321, help="Database port")
    parser.add_argument("--db-name", type=str, env_var="DB_NAME", default="electric", help="Database name")

# Access custom arguments
@events.test_start.add_listener
def _(environment, **kwargs):
    global db_user, db_password, db_host, db_port, db_name
    db_user = environment.parsed_options.db_user
    db_password = environment.parsed_options.db_password
    db_host = environment.parsed_options.db_host
    db_port = environment.parsed_options.db_port
    db_name = environment.parsed_options.db_name

def get_pg_connection():
    return psycopg2.connect(
        user=db_user,
        password=db_password,
        host=db_host,
        port=db_port,
        database=db_name
    )