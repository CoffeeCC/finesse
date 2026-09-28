import os, json, sys
D = sys.argv[1]; M = D + '/data/media'; S = D + '/src'
src = {'s': S + '/sintel-r.mp4', 'b': S + '/bbb-r.mp4', 'e': S + '/ed-r.mp4'}
def link(kind, dest):
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    if not os.path.exists(dest): os.link(src[kind], dest)
movies = [
  ('Sintel (2010)', 's'), ('Big Buck Bunny (2008)', 'b'), ('Elephants Dream (2006)', 'e'), ('Tears of Steel (2012)', 's'),
  ('Cosmos Laundromat (2015)', 'b'), ('Spring (2019)', 's'), ('Agent 327 Operation Barbershop (2017)', 'b'), ('Sprite Fright (2021)', 's'),
  ('Charge (2022)', 'b'), ('Coffee Run (2020)', 's'), ('Caminandes 3 Llamigos (2016)', 'b'), ('Wing It! (2023)', 's'),
  ('Night of the Living Dead (1968)', 'e'), ('Nosferatu (1922)', 'e'), ('Metropolis (1927)', 'e'), ('The General (1926)', 'e'),
  ('Charade (1963)', 'b'), ('His Girl Friday (1940)', 'b'), ('Plan 9 from Outer Space (1957)', 'b'), ('The Little Shop of Horrors (1960)', 'b'),
  ('Detour (1945)', 'e'), ('Sherlock Jr. (1924)', 'e'), ('A Trip to the Moon (1902)', 's'), ('The Cabinet of Dr. Caligari (1920)', 'e'),
  ('The Kid (1921)', 'b'), ('Carnival of Souls (1962)', 'e'), ('House on Haunted Hill (1959)', 'b'), ('The Phantom of the Opera (1925)', 'e'),
]
for name, k in movies:
    link(k, f'{M}/movies/{name}/{name}.mp4')
srt_en = """1
00:00:02,000 --> 00:00:05,000
What brings you to the land of the gatekeepers?

2
00:00:07,000 --> 00:00:09,500
I'm searching for someone.

3
00:00:13,000 --> 00:00:16,000
A dangerous quest for a lone hunter.

4
00:00:19,000 --> 00:00:21,500
I've been alone for as long as I can remember.
"""
srt_es = srt_en.replace("What brings you to the land of the gatekeepers?", "¿Qué te trae a la tierra de los guardianes?").replace("I'm searching for someone.", "Estoy buscando a alguien.").replace("A dangerous quest for a lone hunter.", "Una búsqueda peligrosa para una cazadora solitaria.").replace("I've been alone for as long as I can remember.", "He estado sola desde que tengo memoria.")
open(f'{M}/movies/Sintel (2010)/Sintel (2010).en.srt', 'w').write(srt_en)
open(f'{M}/movies/Sintel (2010)/Sintel (2010).es.srt', 'w').write(srt_es)
shows = [('Pioneer One (2010)', 6), ('Bonanza (1959)', 4), ('The Beverly Hillbillies (1962)', 4), ('One Step Beyond (1959)', 3), ('Flash Gordon (1954)', 3)]
for show, n in shows:
    base = show.rsplit(' (', 1)[0]
    for e in range(1, n + 1):
        link('b' if e % 2 else 'e', f'{M}/tv/{show}/Season 01/{base} - S01E{e:02d}.mp4')
print('movies', len(movies), 'shows', len(shows))
