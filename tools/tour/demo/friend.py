# The friend's films for the Groups scene: freely available titles the demo
# household doesn't have, cut from the same clips (Jellyfin finds each one's
# real details and poster by its name).
#   python3 friend.py <demo folder>
import os, sys
D = sys.argv[1]; M = D + '/friend/data/media/movies'; S = D + '/src'
src = {'s': S + '/sintel-r.mp4', 'b': S + '/bbb-r.mp4', 'e': S + '/ed-r.mp4'}
films = [
  ('The Hitch-Hiker (1953)', 'e'), ('D.O.A. (1949)', 'e'), ('Scarlet Street (1945)', 'e'), ('The Stranger (1946)', 'e'),
  ('The Last Man on Earth (1964)', 'b'), ('Kansas City Confidential (1952)', 'b'), ('The Great Train Robbery (1903)', 's'),
  ('Glass Half (2015)', 'b'), ('Hero (2018)', 's'), ('Caminandes 2 Gran Dillama (2013)', 'b'),
]
for name, k in films:
    dest = f'{M}/{name}/{name}.mp4'
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if not os.path.exists(dest): os.link(src[k], dest)
print('friend films', len(films))
