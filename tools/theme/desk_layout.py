"""Derive native fallback hit regions from the actual Blender desk cameras."""
import bpy,json
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
ROOT=Path(__file__).resolve().parents[2]

def measure(scene,drawer):
    width=bpy.data.objects['CaseBase'].dimensions.x;length=bpy.data.objects['CaseBase'].dimensions.y
    scene.frame_set(122 if drawer else 76);bpy.context.view_layer.update()
    if drawer:
        obj=bpy.data.objects['DrawerBaize'];points=[obj.matrix_world@Vector(p) for p in obj.bound_box]
        x0=min(p.x for p in points);x1=max(p.x for p in points);y0=min(p.y for p in points);y1=min(max(p.y for p in points),-length/2-.12);z=max(p.z for p in points)
        corners=[Vector((x,y,z)) for x in [x0,x1] for y in [y0,y1]]
    else:corners=[Vector((x,y,.06)) for x in [-width/2+.5,width/2-.5] for y in [-length/2+.5,length/2-.5]]
    projected=[world_to_camera_view(scene,scene.camera,p) for p in corners]
    obj=bpy.data.objects['DrawerPull' if drawer else 'KeyBow'];center=sum((obj.matrix_world@Vector(p) for p in obj.bound_box),Vector())/8
    latch=world_to_camera_view(scene,scene.camera,center)
    return{'image':[scene.render.resolution_x,scene.render.resolution_y],
        'surface':[round(min(p.x for p in projected),6),round(1-max(p.y for p in projected),6),round(max(p.x for p in projected)-min(p.x for p in projected),6),round(max(p.y for p in projected)-min(p.y for p in projected),6)],
        'latch':[round(latch.x,6),round(1-latch.y,6)]}

def emit_layouts():
    result={}
    for orientation in ['wide','portrait']:
        bpy.ops.wm.open_mainfile(filepath=str(ROOT/f'tools/theme/scenes/arcane-desk-{orientation}-v1.blend'))
        scene=bpy.context.scene
        result[orientation]={'desk':measure(scene,False),'lighting':measure(scene,True)}
    target=ROOT/'src/assets/card-table/desk-case-layout.ts'
    target.write_text('// Generated from the packed Blender cameras by tools/theme/desk_layout.py.\nexport const DESK_CASE_LAYOUT = '+json.dumps(result,indent=2)+' as const\n',encoding='utf-8')
    print('Wrote',target)

if __name__=='__main__':emit_layouts()
