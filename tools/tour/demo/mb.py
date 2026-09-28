import json, sys, urllib.request, urllib.parse, time
UA = {'User-Agent': 'FinesseDemo/1.0 (https://github.com/CoffeeCC/finesse)'}
def get(url):
    time.sleep(1.1)
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30))
out = []
for artist, album in [('Jonathan Coulton', 'Thing a Week Three'), ('Nine Inch Nails', 'The Slip'), ('Nine Inch Nails', 'Ghosts I–IV')]:
    q = urllib.parse.quote(f'release:"{album}" AND artist:"{artist}" AND status:official')
    r = get(f'https://musicbrainz.org/ws/2/release?query={q}&fmt=json&limit=10')
    rels = [x for x in r['releases'] if x.get('title','').lower().replace('–','-') == album.lower().replace('–','-')] or r['releases']
    # prefer one with cover art
    chosen = None
    for rel in rels[:6]:
        full = get(f"https://musicbrainz.org/ws/2/release/{rel['id']}?inc=recordings+artist-credits+release-groups&fmt=json")
        if full.get('cover-art-archive', {}).get('front'):
            chosen = full; break
    chosen = chosen or get(f"https://musicbrainz.org/ws/2/release/{rels[0]['id']}?inc=recordings+artist-credits+release-groups&fmt=json")
    tracks = []
    for m in chosen['media']:
        for t in m['tracks']:
            tracks.append({'disc': m.get('position',1), 'n': t['position'], 'title': t['title'], 'ms': t.get('length') or 180000, 'rec': t['recording']['id']})
    out.append({'artist': artist, 'album': chosen['title'], 'date': chosen.get('date','')[:4], 'mbid': chosen['id'], 'rg': chosen['release-group']['id'], 'artistId': chosen['artist-credit'][0]['artist']['id'], 'cover': chosen.get('cover-art-archive',{}).get('front'), 'tracks': tracks})
    print(artist, '|', chosen['title'], chosen.get('date'), len(tracks), 'tracks, cover:', out[-1]['cover'], file=sys.stderr)
json.dump(out, open('music.json','w'), indent=1)
