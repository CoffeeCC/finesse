import json, os, sys, urllib.request, shlex, re
# Builds the demo's music library: real album details (from MusicBrainz, in
# music.json) and cover art, with generated tones for the audio. Writes
# <demo>/music.sh, which renders the tracks with ffmpeg.
#   python3 music.py <demo folder>
D = sys.argv[1]; M = D + '/data/media/music'
albums = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'music.json')))
cmds = ['set -e']
for a in albums:
    tracks = a['tracks'][:9] if 'Ghosts' in a['album'] else a['tracks']
    folder = f"{M}/{a['artist']}/{a['album']} ({a['date']})".replace(':', ' -')
    os.makedirs(folder, exist_ok=True)
    cover = folder + '/cover.jpg'
    if not os.path.exists(cover):
        req = urllib.request.Request(f"https://coverartarchive.org/release/{a['mbid']}/front-500", headers={'User-Agent': 'FinesseDemo/1.0'})
        open(cover, 'wb').write(urllib.request.urlopen(req, timeout=60).read())
    for i, t in enumerate(tracks, 1):
        dur = max(30, round(t['ms'] / 1000))
        title = t['title']
        safe = re.sub(r'[/\\:*?"<>|]', '-', title)
        out = f"{folder}/{i:02d} - {safe}.mp3"
        if os.path.exists(out): continue
        f1 = 110 * (1 + (i % 4) / 4)
        expr = f"0.25*sin(2*PI*{f1:.1f}*t)*(0.55+0.45*sin(2*PI*2*t))+0.12*sin(2*PI*{f1*1.5:.1f}*t)*(0.5+0.5*sin(2*PI*0.5*t))"
        meta = {'title': title, 'artist': a['artist'], 'album_artist': a['artist'], 'album': a['album'], 'date': a['date'], 'track': f"{i}/{len(tracks)}",
                'MusicBrainz Album Id': a['mbid'], 'MusicBrainz Artist Id': a['artistId'], 'MusicBrainz Album Artist Id': a['artistId'],
                'MusicBrainz Release Group Id': a['rg'], 'MusicBrainz Track Id': t['rec']}
        margs = ' '.join(f'-metadata {shlex.quote(k + "=" + str(v))}' for k, v in meta.items())
        cmds.append(f"/usr/lib/jellyfin-ffmpeg/ffmpeg -hide_banner -loglevel error -y -f lavfi -i {shlex.quote('aevalsrc=' + expr + ':s=22050:d=' + str(dur))} -c:a libmp3lame -b:a 48k -ac 1 -id3v2_version 3 {margs} {shlex.quote(out)}")
open(D + '/music.sh', 'w').write('\n'.join(cmds) + '\n')
print(len(cmds) - 1, 'tracks to render')
