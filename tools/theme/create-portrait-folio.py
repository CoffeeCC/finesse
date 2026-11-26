"""Original single-leaf portrait folio geometry, complementing the generated plate."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_prop_tools import *
reset()
leather=mat('Portrait midnight bound leather',(.016,.031,.044),.08,.68)
pages=mat('Portrait gilt paper edges',(.32,.24,.12),.32,.75)
cube('PortraitCover',(0,0,.035),(3.58,5.90,.10),leather,.11)
for i in range(5):cube('PortraitPageEdge',(0,0,.10+i*.012),(3.45,5.76,.012),pages,.075)
for y in [-2.35,-1.18,0,1.18,2.35]:
    ring=torus('PortraitSpineBinding',(-1.70,y,.13),.12,.022,bronze);ring.rotation_euler[0]=1.5707963
cube('PortraitSpine',(-1.69,0,.14),(.12,5.75,.15),leather,.055)
plate=mat('Original portrait journal plate',(1,1,1),.06,.80)
nodes=plate.node_tree.nodes;p=nodes.get('Principled BSDF');tex=nodes.new('ShaderNodeTexImage')
tex.image=bpy.data.images.load(str(OUT/'collection-folio-portrait-v2.webp'));tex.image.pack()
plate.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color']);plate.node_tree.links.new(tex.outputs['Alpha'],p.inputs['Alpha'])
plate.surface_render_method='DITHERED'
bpy.ops.mesh.primitive_plane_add(size=1,location=(0,0,.205));under=finish(bpy.context.object,'PortraitUnderleaf',plate);under.scale=(3.7,6.1,1)
bpy.ops.mesh.primitive_plane_add(size=1,location=(0,0,.23));face=finish(bpy.context.object,'PortraitIlluminatedLeaf',plate);face.scale=(3.7,6.1,1)
leaf=parent([face],'PortraitLeafPivot',(-1.67,0,.21))
for frame,angle in [(1,0),(14,-.16),(28,0)]:
    leaf.rotation_euler[1]=angle;leaf.keyframe_insert(data_path='rotation_euler',index=1,frame=frame)
for frame in range(1,29):
    bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
    for x in [-.34,.34]:
        for y in [-.39,.39]:assert (face.matrix_world @ Vector((x,y,0))).z>.205,'Portrait writing surface folded through its underleaf'
bpy.context.scene.frame_set(1)
for x in [-1.65,1.65]:
    for y in [-2.74,2.74]:
        sphere('PortraitCornerRivet',(x,y,.25),(.025,.025,.018),gold,24,12)
export('collection-folio-portrait-v2',(0,0,.15),7.0)
