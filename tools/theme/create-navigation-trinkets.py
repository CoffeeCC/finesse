"""One original physical instrument per navigation role. Blender 5.2."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from blender_prop_tools import *

def orb_gem(name, loc, scale): return sphere(name, loc, scale, glass, 24, 16)
def studs(radius, height, count=12):
    for i in range(count):
        a=i*math.tau/count; sphere('WorkedRivet',(radius*math.cos(a),radius*math.sin(a),height),(.025,.025,.018),gold,12,8)

# Archive chest: all libraries, deliberately unlike either media deck box.
reset()
cube('ArchiveChest',(0,0,.3),(1.65,1.15,.6),wood,.07)
lid=cube('ArchiveLid',(0,0,.68),(1.72,1.22,.18),ink,.06)
for x in [-.56,.56]:
    cube('BronzeStrap',(x,0,.79),(.12,1.2,.035),bronze,.018)
cube('ChestLock',(0,-.59,.44),(.25,.07,.30),gold,.025)
orb_gem('LockGem',(0,-.64,.45),(.07,.03,.09))
parent([lid],'ChestLid',(0,.59,.59))
export('archive-chest-v1',(0,0,.35),2.7)

# A turned, asymmetric key opens the desk itself.
reset()
torus('KeyBow',(-.5,0,.10),.31,.065,bronze)
orb_gem('KeyBowGem',(-.5,0,.13),(.13,.13,.065))
cube('KeyShaft',(.25,0,.10),(1.05,.10,.10),gold,.025)
for x,y in [(.55,-.19),(.78,-.12)]:cube('KeyTooth',(x,y,.10),(.10,abs(y)*2,.12),bronze,.012)
export('desk-key-v1',(0,0,.1),2.4)

# Anime: a hand-carved fox mask, with distinct ears and oxblood markings.
reset()
ivory=mat('Carved old ivory',(.65,.57,.41),.05,.48)
sphere('FoxMask',(0,0,.18),(.57,.72,.19),ivory)
for side in [-1,1]:
    points=[(side*.21,.42,.19),(side*.64,.40,.19),(side*.52,.99,.16)]
    mesh=bpy.data.meshes.new('PointedEar');mesh.from_pydata(points,[],[(0,1,2)]);mesh.update()
    ear=bpy.data.objects.new('CarvedFoxEar',mesh);bpy.context.collection.objects.link(ear);ear.data.materials.append(ivory)
    solid=ear.modifiers.new('CarvedThickness','SOLIDIFY');solid.thickness=.09
    bevel=ear.modifiers.new('SoftEarEdges','BEVEL');bevel.width=.025;bevel.segments=3
    line('EarInlay',[(side*.37,.49,.25),(side*.50,.80,.23),(side*.55,.49,.25)],.018,wax)
    eye=sphere('EyeInlay',(side*.24,.08,.35),(.14,.055,.025),ink,24,12);eye.rotation_euler.z=side*.24
    line('MaskMark',[(side*.42,-.03,.33),(side*.33,-.17,.36),(side*.39,-.29,.32)],.025,wax)
sphere('FoxMuzzle',(0,-.42,.36),(.16,.20,.10),ivory,24,16)
orb_gem('ForeheadStone',(0,.33,.37),(.08,.11,.035))
export('fox-mask-v1',(0,0,.22),2.4)

# Music: seven-string bronze-and-walnut lyre.
reset()
cube('LyreSoundbox',(0,-.58,.12),(1.1,.36,.24),wood,.08)
for side in [-1,1]:
    line('LyreHorn',[(side*.43,-.57,.14),(side*.60,-.10,.17),(side*.54,.50,.18),(side*.72,.69,.18)],.075,bronze)
line('LyreCrossbar',[(-.70,.67,.18),(.70,.67,.18)],.07,gold)
for i in range(7):
    x=(i-3)*.115;line('LyreString',[(x,-.55,.26),(x,.66,.26)],.007,gold)
    sphere('TuningPeg',(x,.73,.20),(.025,.07,.025),wood,16,8)
torus('SoundHole',(0,-.57,.25),.10,.015,gold)
export('silver-lyre-v1',(0,0,.15),2.4)

# Games: a faceted obsidian d20 with real gold edge geometry, not the coin.
reset()
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.71,location=(0,0,.66))
die=bpy.context.object;die.name='ObsidianD20';die.data.materials.append(ink)
edges=die.copy();edges.data=die.data.copy();bpy.context.collection.objects.link(edges);edges.name='D20GoldEdges';edges.data.materials.clear();edges.data.materials.append(gold)
w=edges.modifiers.new('InlaidEdges','WIREFRAME');w.thickness=.018
b=w=edges.modifiers.new('RoundedInlay','BEVEL');b.width=.008;b.segments=2
orb_gem('DieCrown',(0,0,1.29),(.055,.055,.035))
for i,face in enumerate(die.data.polygons):
    center=die.matrix_world @ face.center; normal=face.normal
    bpy.ops.object.text_add(location=center+normal*.012)
    label=bpy.context.object;label.name='EngravedDieNumber';label.data.body=str(i+1);label.data.align_x='CENTER';label.data.align_y='CENTER';label.data.size=.19;label.data.extrude=.001
    label.rotation_euler=normal.to_track_quat('Z','Y').to_euler();label.data.materials.append(gold)
    bpy.ops.object.convert(target='MESH')
export('obsidian-die-v1',(0,0,.61),2.25)

# Watch together: a small gathering brazier, separate from the lighting candle.
reset()
disc('BrazierFoot',(0,0,.08),.42,.12,wood)
for a in [0,math.tau/3,math.tau*2/3]:
    line('BrazierLeg',[(.36*math.cos(a),.36*math.sin(a),.10),(.25*math.cos(a),.25*math.sin(a),.40)],.035,bronze)
disc('BrazierBowl',(0,0,.42),.53,.17,bronze);torus('BowlRim',(0,0,.51),.50,.04,gold)
for i in range(5):
    a=i*math.tau/5
    gem=orb_gem('HearthEmber',(.22*math.cos(a),.22*math.sin(a),.61),(.10,.10,.23));gem.rotation_euler.y=.25*math.cos(a)
export('gathering-brazier-v1',(0,0,.38),2.0)

# Smart collections: a suspended prismatic oracle within its own triangular frame.
reset()
disc('OracleBase',(0,0,.08),.49,.14,wood)
line('OracleFrame',[(-.56,0,.13),(0,0,1.38),(.56,0,.13),(-.56,0,.13)],.035,gold)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.32,location=(0,0,.69));prism=finish(bpy.context.object,'OraclePrism',glass);prism.scale=(.7,.7,1.6)
line('PrismSuspension',[(0,0,1.32),(0,0,1.18)],.012,bronze)
export('oracle-prism-v1',(0,0,.62),2.1)

# Activity: real two-bulb glass hourglass, brass pillars and visible sand.
reset()
sand=mat('Fine warm sand',(.52,.35,.13),0,.85)
for z in [.08,1.34]:disc('HourglassCap',(0,0,z),.46,.12,bronze);torus('CapInlay',(0,0,z+.07),.36,.018,gold)
for x,y in [(-.34,-.20),(.34,-.20),(0,.36)]:line('HourglassPillar',[(x,y,.14),(x,y,1.29)],.027,gold)
for z in [.43,.99]:sphere('GlassBulb',(0,0,z),(.29,.29,.33),glass,32,20)
sphere('CollectedSand',(0,0,.26),(.22,.22,.10),sand,24,16)
line('FallingSand',[(0,0,.97),(0,0,.30)],.009,sand)
export('chronicle-hourglass-v1',(0,0,.70),2.1)

# Settings: an armillary instrument with independently named rings.
reset()
disc('ArmillaryFoot',(0,0,.08),.46,.14,wood)
line('ArmillaryStem',[(0,0,.1),(0,0,.50)],.06,bronze)
for i,angle in enumerate([0,.92,1.65]):
    ring=torus('ArmillaryRing'+str(i),(0,0,.96),.48,.025,gold);ring.rotation_euler=(math.pi/2,angle,.2*i)
orb_gem('ArmillaryHeart',(0,0,.96),(.15,.15,.15));studs(.37,.17,8)
export('artificer-armillary-v1',(0,0,.74),2.3)

# Remote control: a carved command wand with its own crystal and bindings.
reset()
line('CommandWand',[(-.75,-.28,.09),(.62,.23,.12)],.055,wood)
for i in range(5):
    x=-.62+i*.09;ring=torus('WandBinding',(x,-.23+i*.033,.09),.062,.012,gold);ring.rotation_euler.y=math.pi/2
gem=orb_gem('WandCrystal',(.76,.28,.16),(.23,.11,.11));gem.rotation_euler.z=.35
line('CrystalCradle',[(.52,.20,.10),(.73,.37,.13),(.94,.34,.12)],.022,bronze)
export('command-wand-v1',(0,0,.1),2.5)

# Home/return: a carved waystone, never the saved-story codex.
reset()
stone=mat('Waystone slate',(.035,.07,.085),.22,.63)
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=.7,location=(0,0,.15));o=finish(bpy.context.object,'Waystone',stone);o.scale=(.72,1,.25)
line('HomeRune',[(-.23,-.18,.32),(-.23,.14,.32),(0,.37,.32),(.23,.14,.32),(.23,-.18,.32),(-.23,-.18,.32)],.022,gold)
line('RuneDoor',[(0,-.18,.33),(0,.05,.33)],.016,gold)
export('home-waystone-v1',(0,0,.15),2.1)
