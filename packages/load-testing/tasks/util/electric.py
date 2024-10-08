import os
import gzip
import json
import logging

from urllib.parse import urlparse, urlencode, parse_qs

from locust import FastHttpUser, events

@events.test_start.add_listener
def _(environment, **kwargs):
    global database_id, auth_token
    database_id = os.getenv('DATABASE_ID')
    auth_token = os.getenv('AUTH_TOKEN')

def validate_shape_options(shape):
    if 'base_url' not in shape:
        raise ValueError('base_url is required')
    if 'root_table' not in shape:
        raise ValueError('root_table is required')
    if 'params' not in shape:
        raise ValueError('params is required')
    if 'offset' not in shape['params']:
        raise ValueError('offset is required')
    if 'offset' == '-1' and 'shape_id' in shape['params']:
        raise ValueError('can\'t provide shape_id when offset is -1')
    if 'shape_id' in shape['params'] and 'offset' == '-1':
        raise ValueError('offset can\'t be -1 when shape_id is provided')


# Minimal Electric Client for load testing
class ElectricUser(FastHttpUser):
    global auth_token
    abstract = True

    def __init__(self, environment):
        super().__init__(environment)

    def set_shape_options(self, shape):
        validate_shape_options(shape)
        self.client.shape = shape

    def get_shape_options(self):
        return self.client.shape

    def __get_offset(self, live=False):
        global auth_token
        shape = self.get_shape_options()
        params = shape['params'].copy()
        if live:
            params['live'] = 'true'

        if database_id:
            params['database_id'] = database_id

        if live and shape['params']['offset'] == '-1':
            raise ValueError('can\'t start live mode with offset -1')
        
        headers = {}
        if auth_token:
            headers['Authorization'] = f'Bearer {auth_token}'

        url = f'{shape['base_url']}{shape['root_table']}?{urlencode(params)}'
        with self.client.get(url, headers=headers, stream=True, catch_response=True) as res:
            result = {
                'status': res.status_code,
                'up-to-date': False,
            }
            if res.status_code != 200 and res.status_code != 204:
                if(res.status_code == 429 or res.status_code >= 500):
                    logging.error(f'\nerror status: {res.status_code}\n{res.headers}\n content: {res.stream.read().decode('utf-8')}')
                    res.failure(f'error status: {res.status_code} {res.headers} content: {res.stream.read().decode('utf-8')}')
                elif(res.status_code == 409):
                    location_url = urlparse(res.headers['location'])
                    location_qp = parse_qs(location_url.query)
                    shape['params']['shape_id'] = location_qp['shape_id'][0]
                    shape['params']['offset'] = location_qp['offset'][0]
                else:
                    logging.error(f'unexpected error:\nstatus: {res.status_code}\n{res.headers}')
                    res.failure(f'unexpected error: {res.status_code} {res.headers}')
                return result

            shape['params']['shape_id'] = res.headers['electric-shape-id']
            shape['params']['offset'] = res.headers['electric-chunk-last-offset']

            if 'electric-next-cursor' in res.headers:
                shape['params']['cursor'] = res.headers['electric-next-cursor']

            if shape['params']['offset'] == res.headers['electric-chunk-last-offset']:
                result['up-to-date'] = True

            if(res.status_code == 200):
                result['body'] = get_response_body(res)
            return result
        raise ValueError('unreachable code')

    def sync(self):
        while True:
            res = self.__get_offset()
            if res['status'] != 200 and res['status'] != 204:
                # TODO
                raise ValueError('unexpected error')
            if res['up-to-date']:
                break

    def live(self):
        return self.__get_offset(live=True)

def get_response_body(response):
    if 'Content-Encoding' in response.headers and response.headers['Content-Encoding'] == 'gzip':
        content = gzip.decompress(response.stream.read())
    else:
        content = response.stream.read()
    return json.loads(content)
