# Seeds a lived-in household on the demo server: profiles, history, resume points, My List.
import json, sys, urllib.request, datetime
D = sys.argv[1]
KEY = json.load(open(D + '/root/config/finesse/finesse.json'))['jellyfin']['apiKey']
B = 'http://localhost:8080/jellyfin'
def call(method, path, body=None):
    req = urllib.request.Request(B + path, method=method, data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': f'MediaBrowser Token="{KEY}"', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        t = r.read()
        return json.loads(t) if t else None
users = {u['Name']: u for u in call('GET', '/Users')}
for name, pw in [('Sam', 'demo-pass-1'), ('Riley', 'demo-pass-2'), ('Jordan', '')]:
    if name not in users:
        users[name] = call('POST', '/Users/New', {'Name': name, 'Password': pw})
for name, u in users.items():
    full = call('GET', f"/Users/{u['Id']}")
    pol = full['Policy']; pol['IsHidden'] = False
    call('POST', f"/Users/{u['Id']}/Policy", pol)
items = call('GET', '/Items?Recursive=true&IncludeItemTypes=Movie,Episode,Series&Fields=RunTimeTicks')['Items']
def find(name, typ='Movie', ep=None):
    for it in items:
        if it['Type'] != typ: continue
        if typ == 'Episode':
            if it.get('SeriesName') == name and it.get('IndexNumber') == ep: return it
        elif it['Name'] == name: return it
    raise SystemExit(f'not found: {name} {ep}')
now = datetime.datetime.now(datetime.timezone.utc)
def played(user, it, days_ago=1):
    uid = users[user]['Id']
    call('POST', f"/UserPlayedItems/{it['Id']}?userId={uid}&datePlayed={(now - datetime.timedelta(days=days_ago)).strftime('%Y-%m-%dT%H:%M:%S.000Z')}")
def resume(user, it, frac, hours_ago=2):
    uid = users[user]['Id']
    call('POST', f"/UserItems/{it['Id']}/UserData?userId={uid}", {'PlaybackPositionTicks': int(it['RunTimeTicks'] * frac), 'Played': False, 'LastPlayedDate': (now - datetime.timedelta(hours=hours_ago)).strftime('%Y-%m-%dT%H:%M:%S.000Z')})
P = lambda e: find('Pioneer One', 'Episode', e)
Bz = lambda e: find('Bonanza', 'Episode', e)
def clear(user, it):
    uid = users[user]['Id']
    call('POST', f"/UserItems/{it['Id']}/UserData?userId={uid}", {'PlaybackPositionTicks': 0, 'Played': False})
# Undo what a tour run plays (the player scene, the next-episode beat).
for it in [find('Sintel')] + [P(e) for e in (2, 3, 4, 5, 6)]: clear('alex', it)
for n in ['Big Buck Bunny', 'Charade', 'Nosferatu', 'Spring', 'Coffee Run']: played('alex', find(n), 3)
played('alex', P(1), 1)
resume('alex', find('Elephants Dream'), 0.42, 1)
resume('alex', find('Metropolis'), 0.3, 20)
resume('alex', P(2), 0.18, 3)
for n in ['Elephants Dream', 'Metropolis', 'Sprite Fright', 'Spring', 'Night of the Living Dead', 'The General']: played('Sam', find(n), 2)
for e in (1, 2, 3): played('Sam', Bz(e), 4)
for n in ['Cosmos Laundromat', 'Charge', 'Coffee Run', 'Big Buck Bunny', 'Night of the Living Dead', 'Elephants Dream', 'Detour']: played('Riley', find(n), 5)
for e in (1, 2, 3, 4): played('Riley', P(e), 2)
for n in ['Big Buck Bunny', 'Caminandes: Llamigos', 'Sprite Fright', 'Wing It!', 'Spring']: played('Jordan', find(n), 1)
# My List for alex
uid = users['alex']['Id']
dp_path = f"/DisplayPreferences/finesse-watchlist?userId={uid}&client=finesse"
dp = call('GET', dp_path) or {}
dp['CustomPrefs'] = {**(dp.get('CustomPrefs') or {}), 'watchlist': json.dumps([find(n)['Id'] for n in ['Tears of Steel', 'His Girl Friday', 'Detour', 'The Kid', 'Sherlock Jr.']])}
call('POST', dp_path, dp)
print('seeded', list(users))
# Reset what a tour run changes: the account's accent, requests in Radarr/Sonarr.
ui = f"/DisplayPreferences/finesse-ui?userId={uid}&client=finesse"
try:
    dpu = call('GET', ui) or {}
    prefs = dpu.get('CustomPrefs') or {}
    prefs.pop('accent', None)
    dpu['CustomPrefs'] = prefs
    call('POST', ui, dpu)
except Exception as e:
    print('accent reset skipped', e)
F = 'http://localhost:8080'
def arr(method, path):
    req = urllib.request.Request(F + path, method=method, headers={'Authorization': f'MediaBrowser Token="{KEY}"'})
    with urllib.request.urlopen(req, timeout=30) as r:
        t = r.read(); return json.loads(t) if t else None
for m in arr('GET', '/arr/radarr/movie') or []:
    arr('DELETE', f"/arr/radarr/movie/{m['id']}?deleteFiles=false&addImportExclusion=false")
for sr in arr('GET', '/arr/sonarr/series') or []:
    arr('DELETE', f"/arr/sonarr/series/{sr['id']}?deleteFiles=false")
print('reset done')
try:
    for inv in (arr('GET', '/invite-api/v1/invites') or {}).get('invites', []):
        arr('DELETE', f"/invite-api/v1/invites/{inv['id']}")
    print('invites cleared')
except Exception as e:
    print('invite reset skipped', e)
