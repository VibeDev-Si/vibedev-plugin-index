"""Unit tests for plugin_index_trigger.py: run with `python3 -m unittest discover -s server -p 'test_*.py'`."""
import io
import json
import os
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout
from unittest import mock

import plugin_index_trigger as trigger

NOW = 1_800_000_000.0
INDEX = {'format': 1, 'plugins': [
    {'name': '@vibedev-si/dsh-remote', 'versions': [{'version': '0.1.15'}, {'version': '0.1.12'}]},
    {'name': 'dsh-film', 'versions': [{'version': '0.8.0'}]},
]}


class Http:
    """A fake `request`: answers by URL and records every call."""

    def __init__(self, latest, runs=(), dispatch_error=None, expiration=None, workflow_state='active'):
        self.latest, self.runs, self.dispatch_error, self.expiration = latest, list(runs), dispatch_error, expiration
        self.workflow_state = workflow_state
        self.calls = []

    def __call__(self, url, token=None, method='GET', body=None, timeout=30):
        self.calls.append((method, url, token, body))
        if url.startswith(trigger.INDEX_URL):
            return 200, {}, INDEX
        if '/dist-tags' in url:
            name = next((name for name in self.latest if trigger.dist_tags_url(name) == url), None)
            if name is None:
                raise urllib.error.URLError('registry unreachable')
            return 200, {}, {'latest': self.latest[name]}
        if url.endswith('/runs?per_page=10'):
            headers = {'github-authentication-token-expiration': self.expiration} if self.expiration else {}
            return 200, headers, {'workflow_runs': self.runs}
        if url.endswith('/workflows/auto-publish.yml'):
            return 200, {}, {'state': self.workflow_state}
        if url.endswith('/enable') and method == 'PUT':
            self.workflow_state = 'active'
            return 204, {}, None
        if url.endswith('/dispatches'):
            if self.dispatch_error is not None:
                raise self.dispatch_error
            return 204, {}, None
        raise AssertionError(f'unexpected request {url}')

    def dispatched(self):
        return [call for call in self.calls if call[0] == 'POST']

    def enabled(self):
        return [call for call in self.calls if call[0] == 'PUT']


class Environment(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        token = os.path.join(self.directory.name, 'token')
        with open(token, 'w', encoding='ascii') as handle:
            handle.write('github_pat_test\n')
        self.state = os.path.join(self.directory.name, 'state.json')
        patcher = mock.patch.dict(os.environ, {'TOKEN_FILE': token, 'STATE_FILE': self.state, 'RETRY_HOURS': '6'})
        patcher.start()
        for name in ('CREDENTIALS_DIRECTORY', 'STATE_DIRECTORY', 'DRY_RUN'):
            os.environ.pop(name, None)
        self.addCleanup(patcher.stop)
        self.addCleanup(self.directory.cleanup)

    def run_once(self, http, now=NOW):
        output = io.StringIO()
        with redirect_stdout(output):
            status = trigger.run(now=now, http=http)
        return status, output.getvalue()

    def recorded(self):
        with open(self.state, encoding='utf-8') as handle:
            return json.load(handle)


class Versions(unittest.TestCase):
    def test_semver_precedence(self):
        ordered = ['0.9.0', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-beta', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.10.0']
        keys = [trigger.version_key(version) for version in ordered]
        self.assertEqual(keys, sorted(keys))
        self.assertIsNone(trigger.version_key('latest'))
        self.assertIsNone(trigger.version_key('01.0.0'))
        self.assertTrue(trigger.is_stable('0.79.0'))
        self.assertFalse(trigger.is_stable('0.79.0-rc.1'))

    def test_newer_releases_only_for_a_stable_latest_above_every_listed_version(self):
        self.assertEqual(trigger.newer_releases(INDEX, {'@vibedev-si/dsh-remote': '0.1.15', 'dsh-film': '0.8.0'}), [])
        self.assertEqual(trigger.newer_releases(INDEX, {'@vibedev-si/dsh-remote': '0.1.16', 'dsh-film': '0.9.0-rc.1'}), ['@vibedev-si/dsh-remote@0.1.16'])
        self.assertEqual(trigger.newer_releases(INDEX, {'@vibedev-si/dsh-remote': '0.1.14', 'dsh-film': None}), [])

    def test_plan_dispatches_once_per_retry_period_and_forgets_listed_releases(self):
        pending = ['a@2.0.0']
        state = {'a@2.0.0': NOW - 3600, 'a@1.0.0': NOW - 99999}
        self.assertEqual(trigger.plan(pending, state, NOW, 6 * 3600), ([], {'a@2.0.0': NOW - 3600}))
        self.assertEqual(trigger.plan(pending, state, NOW + 6 * 3600, 6 * 3600)[0], ['a@2.0.0'])
        self.assertEqual(trigger.plan(pending, {}, NOW, 6 * 3600)[0], ['a@2.0.0'])

    def test_dist_tags_url_escapes_the_scope_separator(self):
        self.assertEqual(trigger.dist_tags_url('@vibedev-si/dsh-remote'), 'https://registry.npmjs.org/-/package/@vibedev-si%2Fdsh-remote/dist-tags')
        self.assertEqual(trigger.dist_tags_url('dsh-film'), 'https://registry.npmjs.org/-/package/dsh-film/dist-tags')


class Run(Environment):
    def test_nothing_pending_checks_the_token_and_dispatches_nothing(self):
        http = Http({'@vibedev-si/dsh-remote': '0.1.15', 'dsh-film': '0.8.0'})
        status, output = self.run_once(http)
        self.assertEqual(status, 0)
        self.assertEqual(http.dispatched(), [])
        self.assertTrue(any(call[2] == 'github_pat_test' for call in http.calls))
        self.assertIn('lists the latest npm release', output)

    def test_a_new_release_is_dispatched_once_then_waits_for_the_retry_period(self):
        http = Http({'@vibedev-si/dsh-remote': '0.1.16', 'dsh-film': '0.8.0'})
        status, output = self.run_once(http)
        self.assertEqual((status, len(http.dispatched())), (0, 1))
        self.assertEqual(http.dispatched()[0][3], {'ref': 'main'})
        self.assertEqual(self.recorded(), {'@vibedev-si/dsh-remote@0.1.16': NOW})
        later = Http({'@vibedev-si/dsh-remote': '0.1.16', 'dsh-film': '0.8.0'})
        status, output = self.run_once(later, now=NOW + 600)
        self.assertEqual((status, later.dispatched()), (0, []))
        self.assertIn('waiting', output)
        retry = Http({'@vibedev-si/dsh-remote': '0.1.16', 'dsh-film': '0.8.0'})
        self.run_once(retry, now=NOW + 6 * 3600)
        self.assertEqual(len(retry.dispatched()), 1)

    def test_an_active_run_defers_the_dispatch_without_recording_it(self):
        http = Http({'@vibedev-si/dsh-remote': '0.1.16', 'dsh-film': '0.8.0'}, runs=[{'id': 7, 'status': 'in_progress'}])
        status, output = self.run_once(http)
        self.assertEqual((status, http.dispatched(), self.recorded()), (0, [], {}))
        self.assertIn('already queued or running', output)

    def test_a_refused_dispatch_fails_and_is_retried_next_time(self):
        error = urllib.error.HTTPError('https://api.github.com', 403, 'Forbidden', {}, None)
        http = Http({'@vibedev-si/dsh-remote': '0.1.16', 'dsh-film': '0.8.0'}, dispatch_error=error)
        status, output = self.run_once(http)
        self.assertEqual((status, self.recorded()), (1, {}))
        self.assertIn('403', output)

    def test_dry_run_needs_no_token_and_writes_nothing(self):
        os.environ['DRY_RUN'] = '1'
        os.environ.pop('TOKEN_FILE')
        http = Http({'@vibedev-si/dsh-remote': '0.1.16', 'dsh-film': '0.8.0'})
        status, output = self.run_once(http)
        self.assertEqual((status, http.dispatched()), (0, []))
        self.assertFalse(os.path.exists(self.state))
        self.assertIn('would dispatch', output)

    def test_a_token_close_to_expiry_is_reported(self):
        http = Http({'@vibedev-si/dsh-remote': '0.1.15', 'dsh-film': '0.8.0'}, expiration='2027-01-01 00:00:00 UTC')
        _, output = self.run_once(http, now=1_798_761_600.0 - 10 * 86400)
        self.assertIn('expires on 2027-01-01', output)

    def test_an_unreadable_npm_package_fails_the_run_but_the_others_are_still_checked(self):
        http = Http({'@vibedev-si/dsh-remote': '0.1.16'})
        status, _ = self.run_once(http)
        self.assertEqual((status, len(http.dispatched())), (1, 1))

    def test_a_workflow_github_disabled_for_inactivity_is_enabled_before_the_dispatch(self):
        http = Http({'@vibedev-si/dsh-remote': '0.1.16', 'dsh-film': '0.8.0'}, workflow_state='disabled_inactivity')
        status, output = self.run_once(http)
        self.assertEqual((status, len(http.enabled()), len(http.dispatched())), (0, 1, 1))
        self.assertIn('enabled it again', output)

    def test_a_workflow_a_person_disabled_is_left_alone(self):
        http = Http({'@vibedev-si/dsh-remote': '0.1.16', 'dsh-film': '0.8.0'}, workflow_state='disabled_manually')
        status, output = self.run_once(http)
        self.assertEqual((status, http.enabled(), http.dispatched(), self.recorded()), (0, [], [], {}))
        self.assertIn('until a person enables it', output)


if __name__ == '__main__':
    unittest.main()
