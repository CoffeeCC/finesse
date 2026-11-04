"""Original request-ledger mechanisms: escapement, courier horn and shears."""
import sys, math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_prop_tools import *
silver=mat('Worn moon silver',(.42,.50,.57),.88,.3)
steel=mat('Blue black forged steel',(.025,.045,.055),.78,.28)

reset()
disc('EscapementFoot',(0,0,.09),.52,.16,bronze)
disc('EscapementEnamel',(0,0,.18),.45,.045,ink)
for radius,count,z in [(.31,18,.25),(.16,12,.30)]:
    disc('ClockGear',(0,0,z),radius,.055,gold)
    for i in range(count):
        a=i*math.tau/count
        tooth=cube('GearTooth',(math.cos(a)*radius,math.sin(a)*radius,z),(.07,.065,.055),gold,.006);tooth.rotation_euler.z=a
disc('BalanceHub',(0,0,.34),.075,.055,silver)
lever=line('EscapementLever',[(0,0,.40),(.38,-.24,.40)],.035,silver)
knob=sphere('LeverCrystal',(.38,-.24,.44),(.09,.09,.08),glass)
parent([lever,knob],'EscapementLeverPivot',(0,0,.40))
torus('ClockBezel',(0,0,.22),.46,.028,bronze)
export('dispatch-escapement-v1',(0,0,.20),1.7)

reset()
# Two independently moving forged blades with physical oval finger loops.
for side in [-1,1]:
    parts=[]
    blade=cube('ShearBlade',(side*.16,.38,.14),(.095,1.05,.055),steel,.018);blade.rotation_euler.z=-side*.27;parts.append(blade)
    edge=line('ShearEdge',[(side*.015,.02,.175),(side*.30,.86,.175)],.008,silver);parts.append(edge)
    loop=torus('ShearFingerLoop',(side*.25,-.42,.16),.21,.04,bronze);loop.scale.y=1.25;parts.append(loop)
    parts.append(line('ShearTang',[(0,0,.16),(side*.15,-.28,.16)],.04,bronze))
    parent(parts,'ShearLeftPivot' if side<0 else 'ShearRightPivot',(0,0,.16))
disc('ShearHinge',(0,0,.20),.085,.065,gold)
sphere('HingeRivet',(0,0,.245),(.025,.025,.015),silver)
export('dispatch-shears-v1',(0,.05,.12),2.25)

reset()
# A swept, hollow courier horn rather than a flat symbol.
verts=[];faces=[];sections=36;sides=32
for i in range(sections+1):
    t=i/sections;a=-.8+t*2.8
    center=Vector((math.cos(a)*.44,math.sin(a)*.44,.23+.08*t))
    radial=Vector((math.cos(a),math.sin(a),0));up=Vector((0,0,1));radius=.045+.22*t**2.6
    for shell in [0,1]:
        r=radius-(.018 if shell else 0)
        for j in range(sides):
            b=j*math.tau/sides;v=center+(radial*math.cos(b)+up*math.sin(b))*r;verts.append(tuple(v))
for i in range(sections):
    for shell in [0,1]:
        for j in range(sides):
            a=i*sides*2+shell*sides+j;b=i*sides*2+shell*sides+(j+1)%sides;c=b+sides*2;d=a+sides*2
            faces.append((a,b,c,d) if shell==0 else (d,c,b,a))
for end in [0,sections]:
    for j in range(sides):
        a=end*sides*2+j;b=end*sides*2+(j+1)%sides;faces.append((a,b,b+sides,a+sides))
mesh=bpy.data.meshes.new('HollowCourierHorn');mesh.from_pydata(verts,[],faces);mesh.update();o=bpy.data.objects.new('CourierHorn',mesh);bpy.context.collection.objects.link(o);finish(o,'CourierHorn',bronze)
for t in [.08,.43,.74,1]:
    a=-.8+t*2.8;radius=.045+.22*t**2.6
    ring=torus('HornBinding',(math.cos(a)*.44,math.sin(a)*.44,.23+.08*t),radius,.014,gold)
    ring.rotation_euler=(Vector((-math.sin(a),math.cos(a),0))).to_track_quat('Z','Y').to_euler()
cord=line('CourierCord',[(-.15,-.31,.12),(-.54,-.43,.08),(-.65,.20,.08),(-.26,.48,.14)],.019,wood)
parent([o]+[x for x in bpy.context.scene.objects if x.name.startswith('HornBinding')],'CourierHornPivot',(0,0,.22))
export('dispatch-courier-horn-v1',(0,0,.22),1.9)
