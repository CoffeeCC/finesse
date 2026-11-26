"""Original collection instruments: ink/quill, genre vials, lantern and sextant.
Blender 5.2; editable sources, articulated GLBs and matching transparent stills.
"""
import sys, math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_prop_tools import *
selected=set(sys.argv[sys.argv.index('--')+1:]) if '--' in sys.argv else set()
base_export=export
def export(name,target,scale=3.2):
    if not selected or name in selected:base_export(name,target,scale)

silver=mat('Brushed moon silver',(.46,.55,.62),.87,.31)
emerald=mat('Verdigris enamel',(.018,.13,.10),.36,.3)

reset()
disc('InkFoot',(0,-.35,.09),.39,.15,bronze)
disc('InkWell',(0,-.35,.27),.30,.28,ink)
torus('InkLip',(0,-.35,.43),.23,.036,gold)
disc('InkSurface',(0,-.35,.424),.21,.012,mat('Blue black ink',(.008,.018,.033),.2,.13))
feather=[]
feather.append(line('QuillShaft',[(0,-.35,.35),(.05,-.12,.72),(.15,.24,1.16),(.22,.63,1.65)],.018,silver))
for i in range(16):
    t=i/16;y=.04+t*.58;z=.91+t*.70;x=.09+t*.13
    span=.25*math.sin((t*.84+.12)*math.pi)
    for side in [-1,1]:feather.append(line('FeatherBarb',[(x,y,z),(x+side*span,y+.13,z+.07),(x+side*span*.9,y+.19,z+.13)],.014,silver))
feather.append(line('GoldNib',[(0,-.35,.34),(.015,-.27,.48)],.035,gold))
parent(feather,'QuillPivot',(0,-.35,.36))
export('collection-quill-v1',(0,.0,.86),2.8)

reset()
cube('VialRack',(0,0,.09),(1.8,.64,.16),wood,.06)
for x in [-.78,.78]:cube('RackBronzeFoot',(x,0,.075),(.10,.70,.10),bronze)
for i,x in enumerate([-.55,0,.55]):
    liquid=mat(['Ruby tincture','Jade tincture','Sapphire tincture'][i],[(.35,.018,.035),(.025,.24,.15),(.035,.11,.38)][i],.1,.22)
    sphere('GlassVial',(x,0,.46),(.20,.20,.33),glass)
    sphere('VialContents',(x,0,.41),(.16,.16,.22),liquid)
    torus('VialCollar',(x,0,.69),.105,.025,gold)
    top=disc('VialStopper',(x,0,.77),.105,.12,bronze)
    parent([top],f'VialStopperPivot{i}',(x,0,.71))
    line('VialCradle',[(x-.22,-.13,.10),(x-.23,-.13,.31),(x+.23,-.13,.31),(x+.22,-.13,.1)],.018,gold)
export('genre-vials-v1',(0,0,.40),2.65)

reset()
disc('LanternFoot',(0,0,.10),.37,.16,bronze)
disc('LanternBase',(0,0,.22),.29,.12,emerald)
for a in [math.pi/4+i*math.pi/2 for i in range(4)]:
    x,y=.27*math.cos(a),.27*math.sin(a)
    line('LanternPost',[(x,y,.22),(x,y,.95)],.025,gold)
    line('LanternGothicArch',[(x,y,.62),(x*.8,y*.8,.84),(0,0,1.08)],.018,bronze)
torus('LanternWaist',(0,0,.51),.28,.018,bronze)
disc('LanternRoof',(0,0,.98),.32,.08,bronze)
sphere('LanternFinial',(0,0,1.08),(.09,.09,.12),gold)
flame=mat('Moon lantern heart',(.12,.38,.48),.05,.18)
bsdf=flame.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Emission Color'].default_value=(.12,.60,.80,1);bsdf.inputs['Emission Strength'].default_value=1.8
sphere('LanternHeart',(0,0,.57),(.10,.10,.23),flame)
handle=line('LanternHandle',[(.18*math.cos(a),0,1.13+.22*math.sin(a)) for a in [i*math.pi/24 for i in range(25)]],.022,gold)
parent([handle],'LanternHandlePivot',(0,0,1.12))
export('watch-lantern-v1',(0,0,.63),2.25)

reset()
cube('SextantCase',(0,0,.06),(1.45,1.40,.10),wood,.13)
arc=[(.74*math.cos(a),.74*math.sin(a),.16) for a in [i*math.pi/60 for i in range(61)]]
line('GraduatedArc',arc,.055,bronze)
for i in range(31):
    a=i*math.pi/30;r=.74
    line('ScaleEngraving',[(r*math.cos(a),r*math.sin(a),.218),((r-.08 if i%5==0 else r-.045)*math.cos(a),(r-.08 if i%5==0 else r-.045)*math.sin(a),.218)],.005,gold)
line('FrameRadials',[(-.74,0,.16),(0,0,.16),(.74,0,.16)],.04,gold)
line('FrameBracing',[(-.55,.46,.16),(0,0,.16),(.55,.46,.16)],.028,bronze)
arm=line('IndexArm',[(0,0,.23),(.12,.74,.23)],.035,silver)
mirror=cube('IndexMirror',(.08,.47,.35),(.21,.06,.26),silver,.014)
parent([arm,mirror],'SextantArmPivot',(0,0,.23))
disc('IndexBoss',(0,0,.25),.095,.06,gold)
scope=disc('SightingScope',(-.30,.10,.32),.075,.54,bronze);scope.rotation_euler[1]=math.pi/2
export('sort-sextant-v1',(0,.30,.20),2.25)

reset()
felt=mat('Pale mineral eraser',(.29,.38,.27),0,.85)
cube('EraserFoot',(0,0,.09),(1.04,.68,.16),felt,.14)
cube('EraserCradle',(0,0,.20),(1.08,.72,.09),bronze,.12)
cube('EraserInlay',(0,0,.25),(.87,.52,.025),emerald,.10)
line('EraserRune',[(-.30,-.10,.274),(0,.15,.274),(.30,-.10,.274),(0,-.02,.274),(-.30,-.10,.274)],.012,gold)
handle=line('EraserHandle',[(.30*math.cos(a),0,.27+.32*math.sin(a)) for a in [i*math.pi/32 for i in range(33)]],.032,silver)
parent([handle],'EraserHandlePivot',(0,0,.27))
export('collection-eraser-v1',(0,0,.28),1.75)
