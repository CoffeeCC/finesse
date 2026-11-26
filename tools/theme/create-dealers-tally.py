"""Original dealer's tally for configuring a discovery hand, plus its rune stones."""
import sys,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_prop_tools import *
reset()
ivory=mat('Old ivory counter beads',(.64,.55,.35),.06,.37)
blue=mat('Lapis counter beads',(.018,.12,.22),.2,.23)
amber=mat('Honey stone beads',(.42,.16,.035),.12,.25)
cube('TallyFrame',(0,0,.10),(1.85,1.45,.18),wood,.055)
cube('TallyBed',(0,0,.20),(1.62,1.22,.035),ink,.035)
for x in [-.86,.86]:
    cube('FrameChase',(x,0,.215),(.036,1.32,.026),bronze,.012)
    for y in [-.61,.61]:sphere('CornerPin',(x,y,.24),(.035,.035,.018),gold,16,10)
for y in [-.63,.63]:cube('FrameChase',(0,y,.215),(1.7,.035,.026),bronze,.012)
for row in range(3):
    y=(row-1)*.33
    line(f'CounterRail{row}',[(-.76,y,.30),(.76,y,.30)],.016,bronze)
    for bead in range(5):
        x=-.55+bead*.215
        stone=sphere(f'CounterBead{row}_{bead}',(x,y,.30),(.072,.105,.083),[ivory,blue,amber][row],32,20)
        ring=torus(f'BeadBand{row}_{bead}',(x,y,.30),.082,.008,gold);ring.rotation_euler.y=math.pi/2
        pivot=parent([stone,ring],f'TallyBeadPivot{row}_{bead}',(x,y,.30))
        pivot.keyframe_insert('location',frame=1);pivot.location.x+=.15 if bead>2 else -.06;pivot.keyframe_insert('location',frame=18);pivot.location.x-=.15 if bead>2 else -.06;pivot.keyframe_insert('location',frame=36)
for side in [-1,1]:
    for j in range(4):
        x=side*(.24+j*.1)
        line('LowerRunicChase',[(x,-.56,.24),(x+.03,-.52,.24),(x-.02,-.48,.24)],.007,gold)
bpy.context.scene.frame_set(1)
export('dealers-tally-v1',(0,0,.20),2.65)

reset()
slate=mat('Blue black slate',(.016,.034,.045),.12,.66)
stone=cube('LibraryRunestone',(0,0,.08),(2.65,1.0,.16),slate,.09)
for y in [-.425,.425]:line('InlaidRail',[(-1.15,y,.17),(1.15,y,.17)],.009,bronze)
for x in [-1.19,1.19]:
    line('EndChase',[(x,-.38,.17),(x+.035,-.20,.17),(x,0,.17),(x-.035,.20,.17),(x,.38,.17)],.011,gold)
torus('GemBezel',(-.90,0,.18),.11,.016,bronze)
sphere('SourceGem',(-.90,0,.205),(.085,.085,.035),glass)
for x in [-.68,.68]:
    for y in [-.425,.425]:sphere('InlayPin',(x,y,.185),(.014,.014,.008),gold,12,8)
export('hand-library-stone-v1',(0,0,.12),3.15)
bpy.context.scene.render.resolution_y=260
bpy.context.scene.camera.data.ortho_scale=3.05
bpy.ops.wm.save_as_mainfile(filepath=str(SCENES/'hand-library-stone-v1.blend'))
bpy.ops.render.render(write_still=True)
