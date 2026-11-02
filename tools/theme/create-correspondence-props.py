"""Original correspondence props; run with Blender in background mode."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from blender_prop_tools import *

reset()
cube('FoldedDispatch',(0,0,.08),(1.8,1.22,.12),paper,.035)
line('EnvelopeSeam',[(-.85,-.55,.15),(0,.17,.155),(.85,-.55,.15)],.008,wood)
line('EnvelopeFold',[(-.85,.55,.155),(0,-.13,.17),(.85,.55,.155)],.01,wood)
disc('WaxSeal',(0,-.13,.19),.27,.075,wax)
torus('SealBorder',(0,-.13,.23),.216,.011,gold)
for a in range(8):
    angle=a*math.tau/8;line('SealSigil',[(0,-.13,.24),(.15*math.cos(angle),-.13+.15*math.sin(angle),.24)],.012,gold)
before=set(bpy.context.scene.objects)
disc('StampFoot',(1.0,.18,.16),.30,.12,bronze);disc('StampCollar',(1,.18,.27),.18,.12,gold)
sphere('TurnedHandle',(1,.18,.63),(.16,.16,.35),wood);torus('HandleBand',(1,.18,.47),.135,.012,gold)
parent(set(bpy.context.scene.objects)-before,'CardLift',(1,.18,.16))
export('dispatch-seal-v1',(0,0,.25),3.0)

reset()
for side in [-1,1]:
    before=set(bpy.context.scene.objects)
    o=torus('LinkedRing',(.31*side,0,.16),.55,.075,bronze)
    for a in range(12):
        angle=a*math.tau/12
        sphere('RingRivet',(.31*side+.55*math.cos(angle),.55*math.sin(angle),.22),(.022,.022,.025),gold,16,8)
    pivot=parent(set(bpy.context.scene.objects)-before,'RingAssembly',(.31*side,0,.16));pivot.rotation_euler[0]=math.radians(side*14)
sphere('UnionGem',(0,0,.29),(.12,.16,.12),glass)
export('linked-rings-v1',(0,0,.15),2.5)

reset()
disc('VesselFoot',(0,0,.10),.49,.18,bronze);torus('FootRim',(0,0,.19),.43,.035,gold)
sphere('CrystalShell',(0,0,1.38),(.78,.78,.82),glass)
for side in [-1,1]:
    line('VesselBrace',[(side*.48,0,.22),(side*.68,0,.65),(side*.76,0,1.25)],.04,bronze)
disc('VesselCollar',(0,0,2.02),.30,.12,bronze);torus('CollarLip',(0,0,2.09),.29,.028,gold)
before=set(bpy.context.scene.objects)
disc('EnamelStopper',(0,0,2.14),.25,.13,ink);sphere('StopperGem',(0,0,2.28),(.13,.13,.16),glass)
parent(set(bpy.context.scene.objects)-before,'CardLift',(0,0,2.10))
export('memory-vessel-v1',(0,0,1.1),3.2)

reset()
seal=disc('SoftWaxSignet',(0,0,.09),.58,.14,wax)
for vertex in seal.data.vertices:
    a=math.atan2(vertex.co.y,vertex.co.x);s=1+.022*math.sin(a*7)+.012*math.sin(a*13+.6)
    vertex.co.x*=s;vertex.co.y*=s
torus('WaxImpressionRim',(0,0,.17),.46,.022,wax)
for i in range(8):
    a=i*math.tau/8
    line('StampedStar',[(.12*math.cos(a),.12*math.sin(a),.174),(.34*math.cos(a),.34*math.sin(a),.174)],.022,gold)
disc('SignetHeart',(0,0,.18),.10,.025,gold)
export('wax-signet-v1',(0,0,.10),1.7)
