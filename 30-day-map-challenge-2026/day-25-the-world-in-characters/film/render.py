"""Photograph the challenge map at native resolution and assemble its film."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit
import subprocess
import sys

film = Path(__file__).resolve().parent
challenge = film.parent


class Stage(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript'}

    def translate_path(self, path):
        if urlsplit(path).path in ('/', '/index.html'):
            return str(challenge / 'index.html')
        return super().translate_path(path)

    def log_message(self, fmt, *args):
        if fmt.startswith('code '):
            super().log_message(fmt, *args)


def run(script, *arguments):
    command = sys.executable if script.endswith('.py') else 'node'
    subprocess.run([command, str(film / script), *arguments], cwd=film, check=True)


if __name__ == '__main__':
    handler = partial(Stage, directory=str(challenge / 'public'))
    with ThreadingHTTPServer(('127.0.0.1', 8526), handler) as server:
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            run('orbit/record.mjs')
            run('med/travel.mjs')
            run('camera/stage.mjs')
            run('atlas/capture.mjs', '--east')
            run('atlas/stitch.py', 'enhanced')
            run('landing/capture.mjs')
            run('venice/arrival.mjs')
            run('venice/process.py')
            run('return/capture.mjs')
            run('return/capture.mjs', 'registration')
            run('return/render.py')
        finally:
            server.shutdown()
    run('compose.py')
    run('cut.py')
