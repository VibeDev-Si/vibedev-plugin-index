#!/usr/bin/env python3
"""Start the plugin index's Auto-publish workflow as soon as npm has a release the published index lacks.

GitHub delays or skips scheduled workflow runs, so the hourly schedule of auto-publish.yml alone can leave a new release
unlisted for hours. Each run of this script (a systemd timer on the download server, every 10 minutes) reads the
published index from GitHub Pages and the `latest` dist-tag of every listed package on npm. When npm's latest is a
stable version newer than every version the index lists, it dispatches auto-publish.yml once for that version, unless
an Auto-publish run is already queued or running. A version still unlisted RETRY_HOURS after its dispatch is dispatched
again, so a release the job refused for a temporary reason, such as a waiting period, is taken once it qualifies.
GitHub disables a public repository's workflows after 60 days without a commit; the script enables auto-publish.yml
again before dispatching, but leaves a workflow a person disabled alone.
scripts/auto-publish.mjs decides which releases are listed; for a package that does not auto-follow, a dispatch is an
empty run.

Environment:
  CREDENTIALS_DIRECTORY  set by systemd LoadCredential=token:<file>; the file holds a fine-grained token with Actions
                         read and write on REPOSITORY. TOKEN_FILE names the file instead when run by hand.
  STATE_DIRECTORY        set by systemd StateDirectory=; dispatches are remembered in state.json there. STATE_FILE
                         names the file instead.
  REPOSITORY (VibeDev-Si/vibedev-plugin-index), WORKFLOW (auto-publish.yml), INDEX_URL (the GitHub Pages index),
  RETRY_HOURS (6), DRY_RUN=1 (report what would be dispatched; dispatch and record nothing).
Exit status: 0 when nothing was needed or every needed dispatch succeeded; 1 when a request failed. A failed dispatch is
not recorded, so the next run tries again.
"""
import datetime
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

REPOSITORY = os.environ.get('REPOSITORY', 'VibeDev-Si/vibedev-plugin-index')
WORKFLOW = os.environ.get('WORKFLOW', 'auto-publish.yml')
INDEX_URL = os.environ.get('INDEX_URL', 'https://vibedev-si.github.io/vibedev-plugin-index/index.json')
REGISTRY = 'https://registry.npmjs.org'
API = 'https://api.github.com'
USER_AGENT = 'vibedev-plugin-index-trigger'
EXPIRY_WARNING_DAYS = 30
ACTIVE_STATUSES = {'queued', 'in_progress', 'waiting', 'requested', 'pending'}

SEMVER = re.compile(r'(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?')


def version_key(version):
    """Sort key giving semver precedence, or None when the text is not a semantic version."""
    match = SEMVER.fullmatch(version) if isinstance(version, str) else None
    if match is None:
        return None
    core = tuple(int(part) for part in match.group(1, 2, 3))
    if match.group(4) is None:
        return core + ((1,),)
    identifiers = tuple((0, int(item), '') if item.isdigit() else (1, 0, item) for item in match.group(4).split('.'))
    return core + ((0,) + identifiers,)


def is_stable(version):
    """Whether the text is a semantic version without a prerelease part."""
    match = SEMVER.fullmatch(version) if isinstance(version, str) else None
    return match is not None and match.group(4) is None


def newer_releases(index, latest_by_name):
    """`name@version` of every listed package whose npm latest is stable and newer than every listed version."""
    found = []
    for plugin in index.get('plugins', []):
        name = plugin.get('name')
        latest = latest_by_name.get(name)
        if not isinstance(name, str) or not is_stable(latest):
            continue
        listed = [key for key in (version_key(entry.get('version')) for entry in plugin.get('versions', [])) if key is not None]
        if not listed or version_key(latest) > max(listed):
            found.append(f'{name}@{latest}')
    return found


def plan(pending, state, now, retry_seconds):
    """Which pending releases to dispatch now, and the state that keeps only pending releases."""
    kept = {key: stamp for key, stamp in state.items() if key in pending}
    due = [key for key in pending if now - kept.get(key, float('-inf')) >= retry_seconds]
    return due, kept


def dist_tags_url(name):
    """The npm registry URL of a package's dist-tags."""
    return f'{REGISTRY}/-/package/{urllib.parse.quote(name, safe="@")}/dist-tags'


def request(url, *, token=None, method='GET', body=None, timeout=30):
    """Send one HTTPS request; returns (status, headers, parsed JSON body or None). Raises on HTTP and network errors."""
    headers = {'User-Agent': USER_AGENT, 'Accept': 'application/json'}
    if token is not None:
        headers.update({'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers['Content-Type'] = 'application/json'
    with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=headers), timeout=timeout) as response:
        raw = response.read()
        return response.status, response.headers, json.loads(raw) if raw else None


def read_token():
    """The token from the systemd credential, or from TOKEN_FILE."""
    directory = os.environ.get('CREDENTIALS_DIRECTORY')
    path = os.path.join(directory, 'token') if directory else os.environ.get('TOKEN_FILE')
    if not path:
        raise SystemExit('no token: run under systemd with LoadCredential=token:<file>, or set TOKEN_FILE')
    with open(path, encoding='ascii') as handle:
        token = handle.read().strip()
    if not token:
        raise SystemExit(f'{path} is empty')
    return token


def state_path():
    """Where dispatches are remembered."""
    directory = os.environ.get('STATE_DIRECTORY')
    return os.path.join(directory, 'state.json') if directory else os.environ.get('STATE_FILE', 'state.json')


def load_state(path):
    """Dispatch times by `name@version`; an unreadable file counts as empty."""
    try:
        with open(path, encoding='utf-8') as handle:
            value = json.load(handle)
    except (OSError, ValueError):
        return {}
    return {key: stamp for key, stamp in value.items() if isinstance(key, str) and isinstance(stamp, (int, float))} if isinstance(value, dict) else {}


def save_state(path, state):
    """Replace the state file atomically."""
    directory = os.path.dirname(os.path.abspath(path))
    handle, temporary = tempfile.mkstemp(dir=directory, prefix='.state-')
    with os.fdopen(handle, 'w', encoding='utf-8') as out:
        json.dump(state, out, indent=2, sort_keys=True)
    os.replace(temporary, path)


def warn_on_expiry(headers, now):
    """Log a warning when the token expires within EXPIRY_WARNING_DAYS."""
    value = headers.get('github-authentication-token-expiration') if headers is not None else None
    if not value:
        return
    try:
        expires = datetime.datetime.strptime(value.replace(' UTC', ''), '%Y-%m-%d %H:%M:%S').replace(tzinfo=datetime.timezone.utc)
    except ValueError:
        return
    days = (expires.timestamp() - now) / 86400
    if days < EXPIRY_WARNING_DAYS:
        print(f'warning: the GitHub token expires on {value} ({days:.0f} days); put a new one in /etc/vibedev/plugin-index-token')


def run(now=None, http=request):
    """One check. Returns the exit status.

    Every run except a dry run makes one authenticated request, so an expired or revoked token fails the service
    within one timer period instead of when the next release appears.
    """
    now = time.time() if now is None else now
    dry_run = os.environ.get('DRY_RUN') == '1'
    retry_seconds = float(os.environ.get('RETRY_HOURS', '6')) * 3600
    failed = False
    try:
        _, _, index = http(f'{INDEX_URL}?trigger={int(now)}')
    except (urllib.error.URLError, OSError, ValueError) as error:
        print(f'cannot read the published index {INDEX_URL}: {error}')
        return 1
    if not isinstance(index, dict):
        print(f'{INDEX_URL} is not an index')
        return 1
    latest_by_name = {}
    for plugin in index.get('plugins', []):
        name = plugin.get('name')
        if not isinstance(name, str):
            continue
        try:
            _, _, tags = http(dist_tags_url(name))
            latest_by_name[name] = tags.get('latest') if isinstance(tags, dict) else None
        except (urllib.error.URLError, OSError, ValueError) as error:
            print(f'{name}: cannot read npm dist-tags: {error}')
            failed = True
    pending = newer_releases(index, latest_by_name)
    path = state_path()
    due, state = plan(pending, load_state(path), now, retry_seconds)
    if dry_run:
        print(f'dry run: would dispatch {WORKFLOW} for {", ".join(due)}' if due else f'dry run: nothing to dispatch; pending: {", ".join(pending) or "none"}')
        return 1 if failed else 0
    token = read_token()
    try:
        _, headers, runs = http(f'{API}/repos/{REPOSITORY}/actions/workflows/{WORKFLOW}/runs?per_page=10', token=token)
        warn_on_expiry(headers, now)
        active = [item for item in (runs or {}).get('workflow_runs', []) if item.get('status') in ACTIVE_STATUSES]
        if not pending:
            print('the published index lists the latest npm release of every package')
        elif not due:
            print(f'waiting: {", ".join(pending)} dispatched within the last {retry_seconds / 3600:g} hours')
        elif active:
            print(f'Auto-publish is already queued or running (run {active[0].get("id")}); {", ".join(due)} will be checked again')
        else:
            workflow_url = f'{API}/repos/{REPOSITORY}/actions/workflows/{WORKFLOW}'
            _, _, workflow = http(workflow_url, token=token)
            state_of_workflow = (workflow or {}).get('state')
            if state_of_workflow == 'disabled_inactivity':
                # GitHub disables a public repository's workflows after 60 days without a commit; a person did not.
                http(f'{workflow_url}/enable', token=token, method='PUT')
                print(f'{WORKFLOW} was disabled for inactivity; enabled it again')
                state_of_workflow = 'active'
            if state_of_workflow != 'active':
                print(f'{WORKFLOW} is {state_of_workflow}; not dispatching for {", ".join(due)} until a person enables it')
            else:
                http(f'{workflow_url}/dispatches', token=token, method='POST', body={'ref': 'main'})
                for key in due:
                    state[key] = now
                print(f'dispatched {WORKFLOW} for {", ".join(due)}')
    except urllib.error.HTTPError as error:
        print(f'GitHub refused the request ({error.code} {error.reason}); check the token in /etc/vibedev/plugin-index-token')
        failed = True
    except (urllib.error.URLError, OSError, ValueError) as error:
        print(f'cannot reach GitHub: {error}')
        failed = True
    save_state(path, state)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(run())
