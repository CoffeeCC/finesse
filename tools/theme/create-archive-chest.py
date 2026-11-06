"""Original hollow walnut archive, chased fittings and a lined articulated lid."""
import sys,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_prop_tools import *
reset()
lining=mat('Bottle green suede',(.025,.10,.085),0,.93)
leather=mat('Midnight archive leather',(.018,.037,.050),.08,.64)
# The contents cavity is real; the lid, straps and chase move as one assembly.
cube('ArchiveBase',(0,0,.10),(1.9,1.35,.18),wood,.05)
for x in [-.89,.89]:cube('WalnutSide',(x,0,.39),(.13,1.35,.50),wood,.04)
for y in [-.61,.61]:cube('WalnutWall',(0,y,.39),(1.75,.13,.50),wood,.035)
cube('SuedeFloor',(0,0,.205),(1.63,1.08,.03),lining,.02)
for x in [-.805,.805]:cube('SuedeSide',(x,0,.405),(.018,1.08,.37),lining,.009)
for y in [-.535,.535]:cube('SuedeWall',(0,y,.405),(1.6,.018,.37),lining,.009)
for z in [.15,.65]:
    for y in [-.64,.64]:cube('ChasedRail',(0,y,z),(1.85,.035,.045),bronze,.012)
    for x in [-.91,.91]:cube('ChasedRail',(x,0,z),(.035,1.25,.045),bronze,.012)
for x in [-.87,.87]:
    for y in [-.60,.60]:
        cube('CornerGuard',(x,y,.39),(.11,.12,.50),bronze,.035)
        for z in [.23,.53]:sphere('GuardRivet',(x,y-.055,z),(.024,.014,.024),gold,16,8)
for side in [-1,1]:
    # A raised vine on each front panel, with three individual silver leaves.
    for j in range(3):
        x=side*(.30+j*.16)
        line('FrontVine',[(x,-.685,.25),(x+side*.06,-.689,.36),(x+side*.025,-.685,.48)],.009,gold)
        sphere('VineLeaf',(x+side*.06,-.69,.38),(.045,.012,.018),bronze,16,8)
cube('Escutcheon',(0,-.69,.43),(.26,.055,.31),bronze,.045)
disc_key=cube('KeyholeStem',(0,-.724,.405),(.025,.010,.07),ink,.006)
sphere('KeyholeEye',(0,-.726,.448),(.029,.008,.028),ink,20,12)
for x in [-.58,.58]:
    # Collared rolled hinges at the back.
    hinge=disc('RolledHinge',(x,.65,.65),.072,.28,bronze);hinge.rotation_euler.y=math.pi/2
lid=[]
lid.append(cube('ArchiveLid',(0,0,.73),(1.98,1.43,.17),wood,.055))
lid.append(cube('LidLeather',(0,0,.825),(1.75,1.18,.025),leather,.05))
lid.append(cube('LidSuede',(0,0,.634),(1.72,1.14,.025),lining,.025))
for x in [-.72,.72]:
    lid.append(cube('LidStrap',(x,0,.852),(.085,1.35,.035),bronze,.015))
    for y in [-.52,-.3,0,.3,.52]:lid.append(sphere('StrapRivet',(x,y,.877),(.017,.017,.012),gold,16,8))
for y in [-.58,.58]:lid.append(cube('LidGoldEdge',(0,y,.854),(1.75,.025,.016),gold,.008))
for x in [-.54,.54]:
    for y in [-.40,.40]:
        points=[]
        for j in range(33):
            t=j/32*math.pi*1.8;r=.10*(1-j/45)
            points.append((x+r*math.cos(t),y+r*math.sin(t),.85))
        lid.append(line('CornerScroll',points,.009,gold))
lid.append(torus('LidMedallion',(0,0,.85),.27,.018,bronze))
for i in range(8):
    a=i/8*math.tau;r=.24
    lid.append(line('CompassRay',[(0,0,.855),(r*.4*math.cos(a+.15),r*.4*math.sin(a+.15),.855),(r*math.cos(a),r*math.sin(a),.855),(r*.4*math.cos(a-.15),r*.4*math.sin(a-.15),.855),(0,0,.855)],.009,gold))
lid.append(sphere('MedallionStone',(0,0,.875),(.075,.075,.035),glass))
pivot=parent(lid,'ChestLid',(0,.64,.64))
pivot.rotation_euler.x=0;pivot.keyframe_insert('rotation_euler',frame=1)
pivot.rotation_euler.x=-1.15;pivot.keyframe_insert('rotation_euler',frame=32)
bpy.context.scene.frame_set(1)
export('archive-chest-v2',(0,0,.43),3.1)

bpy.context.scene.frame_set(32)
bpy.context.scene.render.filepath=str(OUT/'archive-chest-v2-open.webp')
bpy.ops.render.render(write_still=True)
