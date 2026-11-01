#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""IntroDB CORS proxy for the Skip Intro plugin for Lampa (home network). Python 3.7+ standard library only.

Why: api.introdb.app answers browsers with "Access-Control-Allow-Origin: https://introdb.app", so Lampa running
in a TV browser (webOS, Tizen) or on a PC cannot read the response (on Android the plugin sends the request through
the Lampa app and needs no proxy). The proxy performs the same GET itself and returns the answer with CORS headers.

What it allows: only reading timestamps, exactly as the plugin does it:
    GET https://api.introdb.app/segments?imdb_id=tt...&season=N&episode=N   (episode)
    GET https://api.introdb.app/segments?imdb_id=tt...&is_movie=true         (movie)
Any other host, path, parameter or method is refused (403/400/405). This is not an open proxy.
Gentle to IntroDB (terms: https://introdb.app/docs/terms - no bulk downloading, no exceeding reasonable limits):
in-memory response cache, at most --rate upstream requests per minute, a pause after a 429 answer.

Plugin setting (Lampa: Settings -> Пропуск заставок -> Источники -> "IntroDB: прокси"):
    http://<YOUR_SERVER_IP>:8790/{url}
The other plugin forms work too: http://<YOUR_SERVER_IP>:8790/?url={encoded} and the prefix http://<YOUR_SERVER_IP>:8790/
Health check: http://<YOUR_SERVER_IP>:8790/health

Run: python3 introdb_proxy.py [--host 0.0.0.0] [--port 8790] [--rate 30]
"""
import argparse
import json
import os
import re
import sys
import threading
import time
from collections import OrderedDict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit
from urllib.request import Request, urlopen

VERSION = '1.0'
ALLOWED_HOST = 'api.introdb.app'
ALLOWED_PATH = '/segments'
# Куда на самом деле идёт запрос. Менять нужно только для тестов (подставной сервер); проверка адреса от этого не зависит.
UPSTREAM = os.environ.get('INTRODB_PROXY_UPSTREAM', 'https://' + ALLOWED_HOST).rstrip('/')
USER_AGENT = 'LampaSkipIntro-IntroDB-proxy/' + VERSION
TIMEOUT = 10            # с, ожидание IntroDB
MAX_BODY = 256 * 1024   # ответ /segments — около 1 КБ
TTL = {200: 6 * 3600, 404: 1800}  # кэш: таймкоды — 6 ч, «нет такого» — 30 мин (у плагина свой кэш поверх)
CACHE_MAX = 2000
PARAM_RULES = {
    'imdb_id': re.compile(r'^tt\d{5,10}$'),
    'season': re.compile(r'^\d{1,4}$'),
    'episode': re.compile(r'^\d{1,5}$'),
    'is_movie': re.compile(r'^(true|false)$'),
}
PARAM_ORDER = ['imdb_id', 'season', 'episode', 'is_movie']


class ProxyError(Exception):
    def __init__(self, status, message):
        Exception.__init__(self, message)
        self.status = status
        self.message = message


def extract_target(raw_path):
    """Из пути запроса к прокси достаёт адрес IntroDB: /{url}, /{encoded}, /?url={encoded}."""
    if raw_path.startswith('/?') or raw_path.startswith('?'):
        q = dict(parse_qsl(urlsplit(raw_path).query, keep_blank_values=True))
        target = q.get('url', '')
    else:
        target = raw_path[1:] if raw_path.startswith('/') else raw_path
        if re.match(r'^https?%3a', target, re.I):
            target = unquote(target)
    # некоторые клиенты схлопывают // в пути: https:/api.introdb.app/...
    target = re.sub(r'^(https?):/+', lambda m: m.group(1).lower() + '://', target, flags=re.I)
    return target


def validate(target):
    """-> канонический query для /segments или ProxyError."""
    if not target:
        raise ProxyError(400, 'нужен адрес IntroDB: /https://api.introdb.app/segments?...')
    parts = urlsplit(target)
    host = (parts.hostname or '').lower()
    if parts.scheme != 'https' or host != ALLOWED_HOST or parts.port not in (None, 443) or parts.username or parts.password:
        raise ProxyError(403, 'разрешён только https://' + ALLOWED_HOST)
    if parts.path != ALLOWED_PATH:
        raise ProxyError(403, 'разрешён только ' + ALLOWED_PATH)
    pairs = parse_qsl(parts.query, keep_blank_values=True)
    params = {}
    for k, v in pairs:
        rule = PARAM_RULES.get(k)
        if rule is None or k in params or not rule.match(v):
            raise ProxyError(400, 'недопустимый параметр: ' + k)
        params[k] = v
    if 'imdb_id' not in params:
        raise ProxyError(400, 'нужен imdb_id')
    movie = params.get('is_movie') == 'true'
    if not movie and ('season' not in params or 'episode' not in params):
        raise ProxyError(400, 'для серии нужны season и episode (для фильма — is_movie=true)')
    return urlencode([(k, params[k]) for k in PARAM_ORDER if k in params])


class Cache(object):
    def __init__(self, limit):
        self.limit = limit
        self.data = OrderedDict()
        self.lock = threading.Lock()

    def get(self, key):
        with self.lock:
            item = self.data.get(key)
            if item is None:
                return None
            if item[0] < time.time():
                del self.data[key]
                return None
            return item[1]

    def put(self, key, value, ttl):
        with self.lock:
            self.data[key] = (time.time() + ttl, value)
            self.data.move_to_end(key)
            while len(self.data) > self.limit:
                self.data.popitem(last=False)


class Limiter(object):
    """Не больше rate запросов к IntroDB за 60 с; после 429 от IntroDB — пауза Retry-After (не меньше 60 с)."""

    def __init__(self, rate):
        self.rate = rate
        self.hits = deque()
        self.pause_until = 0.0
        self.lock = threading.Lock()

    def acquire(self):
        """-> 0, если можно идти в IntroDB, иначе сколько секунд подождать."""
        with self.lock:
            t = time.time()
            if t < self.pause_until:
                return int(self.pause_until - t) + 1
            while self.hits and self.hits[0] <= t - 60:
                self.hits.popleft()
            if len(self.hits) >= self.rate:
                return int(self.hits[0] + 60 - t) + 1
            self.hits.append(t)
            return 0

    def pause(self, seconds):
        with self.lock:
            self.pause_until = max(self.pause_until, time.time() + seconds)


def fetch_upstream(query):
    """-> (status, content_type, body, retry_after)."""
    req = Request(UPSTREAM + ALLOWED_PATH + '?' + query, headers={'User-Agent': USER_AGENT, 'Accept': 'application/json'})
    try:
        resp = urlopen(req, timeout=TIMEOUT)
        status = resp.getcode()
    except HTTPError as e:
        resp = e
        status = e.code
    try:
        body = resp.read(MAX_BODY + 1)
        ctype = resp.headers.get('Content-Type') or 'application/json'
        retry = resp.headers.get('Retry-After')
    finally:
        resp.close()
    if len(body) > MAX_BODY:
        raise ProxyError(502, 'слишком большой ответ IntroDB')
    return status, ctype, body, retry


class Handler(BaseHTTPRequestHandler):
    server_version = 'IntroDBProxy/' + VERSION
    sys_version = ''
    protocol_version = 'HTTP/1.1'
    timeout = 20  # с, на чтение запроса клиента

    def version_string(self):
        return self.server_version

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')

    def _send(self, status, body, ctype='application/json; charset=utf-8', extra=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self._cors()
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        req_headers = self.headers.get('Access-Control-Request-Headers')
        if req_headers:
            self.send_header('Access-Control-Allow-Headers', req_headers)
        if self.headers.get('Access-Control-Request-Private-Network'):
            self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Access-Control-Max-Age', '600')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        t0 = time.time()
        self._note = ''
        if self.path.split('?')[0] == '/health':
            return self._send(200, {'ok': True, 'service': 'introdb-proxy', 'version': VERSION})
        try:
            query = validate(extract_target(self.path))
        except ProxyError as e:
            self._note = e.message
            return self._send(e.status, {'error': e.message})
        cached = self.server.cache.get(query)
        if cached is not None:
            self._note = 'cache'
            return self._send(cached[0], cached[2], cached[1], {'X-Proxy-Cache': 'HIT'})
        wait = self.server.limiter.acquire()
        if wait:
            self._note = 'limit'
            return self._send(429, {'error': 'лимит запросов к IntroDB, повторите позже'}, extra={'Retry-After': str(wait)})
        try:
            status, ctype, body, retry = fetch_upstream(query)
        except ProxyError as e:
            self._note = e.message
            return self._send(e.status, {'error': e.message})
        except Exception as e:  # сеть, TLS, таймаут, оборванный ответ: плагину — понятный статус 502 с CORS
            reason = str(getattr(e, 'reason', e)) or e.__class__.__name__
            self._note = 'upstream: ' + reason
            return self._send(502, {'error': 'IntroDB недоступна: ' + reason})
        extra = {'X-Proxy-Cache': 'MISS'}
        if status == 429:
            pause = int(retry) if retry and retry.isdigit() else 60
            self.server.limiter.pause(max(60, pause))
            extra['Retry-After'] = str(max(60, pause))
        elif status in TTL:
            self.server.cache.put(query, (status, ctype, body), TTL[status])
        self._note = 'upstream %d ms' % int((time.time() - t0) * 1000)
        return self._send(status, body, ctype, extra)

    def do_HEAD(self):
        self._send(405, {'error': 'только GET'})

    def do_POST(self):
        self._send(405, {'error': 'только GET'})

    do_PUT = do_DELETE = do_PATCH = do_POST

    def log_message(self, fmt, *args):
        note, self._note = getattr(self, '_note', ''), ''
        if not self.server.quiet:
            sys.stderr.write('%s %s %s\n' % (self.address_string(), fmt % args, note))


def make_server(host, port, rate, quiet=False):
    httpd = ThreadingHTTPServer((host, port), Handler)
    httpd.daemon_threads = True
    httpd.cache = Cache(CACHE_MAX)
    httpd.limiter = Limiter(rate)
    httpd.quiet = quiet
    return httpd


def main(argv=None):
    ap = argparse.ArgumentParser(description='IntroDB CORS-прокси для плагина Skip Intro (Lampa)')
    ap.add_argument('--host', default='0.0.0.0', help='адрес (по умолчанию 0.0.0.0 — вся локальная сеть)')
    ap.add_argument('--port', type=int, default=8790)
    ap.add_argument('--rate', type=int, default=30, help='не больше запросов к IntroDB в минуту (по умолчанию 30)')
    ap.add_argument('--quiet', action='store_true', help='без журнала запросов')
    a = ap.parse_args(argv)
    httpd = make_server(a.host, a.port, max(1, a.rate), a.quiet)
    sys.stderr.write('introdb-proxy %s: http://%s:%d/{url} -> %s%s\n' % (VERSION, a.host, httpd.server_address[1], UPSTREAM, ALLOWED_PATH))
    sys.stderr.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == '__main__':
    main()
