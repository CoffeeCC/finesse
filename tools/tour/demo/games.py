# Downloads the demo's games: free, open-source homebrew listed on Homebrew Hub
# (hh.gbdev.io). Credits and licences are in docs/media/CREDITS.md.
#   python3 games.py <demo folder>
import json, os, sys, urllib.request

D = sys.argv[1]
ROMS = os.path.join(D, 'data', 'media', 'games', 'roms')
API = 'https://hh3.gbdev.io'
# (system folder, Homebrew Hub slug, file name in the library)
GAMES = [
    ('gb', 'tobutobugirl', 'Tobu Tobu Girl.gb'),
    ('gb', '2048gb', '2048gb.gb'),
    ('gbc', 'ucity', 'uCity.gbc'),
    ('gbc', 'aevilia', 'Aevilia.gbc'),
    ('gba', 'apotris', 'Apotris.gba'),
    ('gba', 'skyland', 'Skyland.gba'),
    ('nes', 'thwaite', 'Thwaite.nes'),
    ('nes', 'croom', 'Concentration Room.nes'),
]
UA = {'User-Agent': 'FinesseDemo/1.0 (https://github.com/CoffeeCC/finesse)'}


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


for system, slug, name in GAMES:
    dest = os.path.join(ROMS, system, name)
    if os.path.exists(dest):
        continue
    entry = json.loads(get(f'{API}/api/entry/{slug}.json'))
    f = next((x for x in entry['files'] if x.get('default')), entry['files'][0])
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest, 'wb').write(get(f"{API}/static/{entry['basepath']}/entries/{slug}/{f['filename']}"))
    print('game', system, name)
print(len(GAMES), 'games in', ROMS)
