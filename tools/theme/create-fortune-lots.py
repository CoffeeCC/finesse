"""Original ivory lots in a chased bronze divining bowl. No external assets."""
import sys, math, bmesh
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_prop_tools import *
reset()
ivory=mat('Aged ivory',(.69,.59,.38),.06,.42)
silver=mat('Oxidized silver chase',(.32,.39,.43),.85,.31)
deep=mat('Patinated inner bronze',(.045,.07,.065),.65,.48)
# A continuous hollow vessel with an actual rim and inner wall, not a solid sphere.
profile=[(0,.08),(.40,.08),(.58,.16),(.76,.35),(.85,.55),(.86,.63),(.82,.68),(.77,.64),(.76,.56),(.66,.37),(.49,.24),(.22,.20),(0,.20)]
verts=[];faces=[];steps=96
for r,z in profile:
    for j in range(steps):
        a=j/steps*math.tau;verts.append((r*math.cos(a),r*math.sin(a),z))
for row in range(len(profile)-1):
    for j in range(steps):
        k=row*steps+j;n=row*steps+(j+1)%steps;faces.append((k,n,n+steps,k+steps))
mesh=bpy.data.meshes.new('Turned hollow bowl');mesh.from_pydata(verts,[],faces);mesh.update()
bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
assert all(edge.is_manifold for edge in bm.edges), 'The divining bowl must have a closed floor and continuous walls'
bm.to_mesh(mesh);bm.free()
body=bpy.data.objects.new('ChasedBowl',mesh);bpy.context.collection.objects.link(body);finish(body,'ChasedBowl',bronze)
disc('TurnedFoot',(0,0,.065),.39,.10,wood)
torus('SilverLip',(0,0,.645),.82,.025,silver)
torus('LowerChase',(0,0,.31),.72,.017,gold)
for j in range(24):
    a=j/24*math.tau
    # Repeating handworked relief under the rim, distinct from the library seals.
    points=[]
    for k in range(9):
        t=k/8;b=a+(t-.5)*.16;r=.802-.06*math.sin(t*math.pi)
        points.append((r*math.cos(b),r*math.sin(b),.49+.09*math.sin(t*math.pi)))
    line(f'Chase{j}',points,.008,gold)
for j in range(3):
    a=j/3*math.tau+.2
    sphere(f'ClawFoot{j}',(.43*math.cos(a),.43*math.sin(a),.07),(.15,.10,.08),bronze)
    sphere(f'Moonstone{j}',(.80*math.cos(a),.80*math.sin(a),.61),(.06,.06,.045),glass)
for j in range(7):
    a=j*2.399;r=.16+.055*j;x=r*math.cos(a);y=r*math.sin(a);z=.32+(j%3)*.075
    tile=cube(f'IvoryLot{j}',(x,y,z),(.18,.38,.065),ivory,.035)
    marks=[tile]
    marks.append(line(f'RunicCut{j}',[(x-.045,y-.1,z+.04),(x+.04,y,z+.04),(x-.045,y+.1,z+.04)],.009,ink))
    marks.append(line(f'RunicStem{j}',[(x,y-.12,z+.041),(x,y+.12,z+.041)],.007,gold))
    pivot=parent(marks,f'LotPivot{j}',(x,y,z));pivot.rotation_euler.z=a
    pivot.keyframe_insert('location',frame=1);pivot.location.z+=.18;pivot.keyframe_insert('location',frame=18);pivot.location.z-=.18;pivot.keyframe_insert('location',frame=36)
bpy.context.scene.frame_set(1)
export('fortune-lots-v1',(0,0,.35),2.65)
