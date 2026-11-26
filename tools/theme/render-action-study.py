"""Portable Blender material/light study; not a browser UI recording."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];SCENES=ROOT/'tools/theme/scenes';ASSETS=ROOT/'src/assets/card-table'
OUTPUT=ROOT.parent.parent/'outputs/arcane-action-study';OUTPUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def append(name,position,scale=1):
    with bpy.data.libraries.load(str(SCENES/f'{name}.blend'),link=False) as (source,target):target.objects=source.objects
    objects=[o for o in target.objects if o and o.type in {'MESH','CURVE','EMPTY'}]
    for o in objects:
        if not o.users_collection:bpy.context.collection.objects.link(o)
    bpy.ops.object.empty_add(type='PLAIN_AXES');root=bpy.context.object;root.name=name+' assembly'
    for o in objects:
        if not o.parent:
            bpy.context.view_layer.update();world=o.matrix_world.copy();o.parent=root;o.matrix_world=world
    root.location=position;root.scale=(scale,)*3
    return root,objects
book,parts=append('story-codex-v1',(-1.6,-.5,.02))
for o in parts:
    if o.name.startswith('CodexCoverPivot'):o.rotation_euler.y=-.12
    if o.name.startswith('CodexClaspPivot'):o.rotation_euler.y=.6
deck,parts=append('draw-deck-v1',(1.0,-.5,.02))
for o in parts:
    if o.name.startswith('TopCard'):o.location.z+=.07;o.rotation_euler.x=.035
append('candle-v1',(2.35,1.5,.02),.8)
append('scrying-orb-v1',(-2.6,1.5,.02),.6)
append('celestial-coin-v1',(.2,1.1,.06),.6)
bpy.ops.mesh.primitive_plane_add(size=1,location=(0,0,-.025));desk=bpy.context.object;desk.scale=(9,6,1)
m=bpy.data.materials.new('Quiet celestial desk');m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.83
tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(ASSETS/'quiet-desk-v1.webp'));m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color']);desk.data.materials.append(m)
bpy.ops.object.light_add(type='POINT',location=(2.35,1.5,1.45));light=bpy.context.object;light.name='Candle warm point';light.data.energy=55;light.data.color=(1,.59,.25);light.data.shadow_soft_size=.09
bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,radius=1,location=(2.35,1.5,1.49));flame=bpy.context.object;flame.name='Study flame';flame.scale=(.034,.029,.13);flame.visible_shadow=False
emission=bpy.data.materials.new('Warm flame');emission.use_nodes=True;p=emission.node_tree.nodes.get('Principled BSDF');p.inputs['Emission Color'].default_value=(1,.54,.13,1);p.inputs['Emission Strength'].default_value=4;flame.data.materials.append(emission)
for loc,power,color,size in [((-2,-1,6),180,(.33,.49,1),5),((1,-3,5),95,(.6,.71,1),5)]:
    bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=power;l.data.size=size;l.data.color=color;l.rotation_euler=(Vector((0,0,0))-l.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(3,-5.5,8));camera=bpy.context.object;camera.rotation_euler=(Vector((0,.35,.15))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=8.4
s=bpy.context.scene;s.camera=camera;s.render.engine='CYCLES';s.cycles.samples=32;s.cycles.use_denoising=True;s.world.use_nodes=True
s.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(.008,.014,.025,1);s.world.node_tree.nodes.get('Background').inputs['Strength'].default_value=.25
s.render.resolution_x=1120;s.render.resolution_y=840;s.render.resolution_percentage=100;s.render.image_settings.file_format='WEBP';s.render.image_settings.quality=92
bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(SCENES/'action-props-light-study-v1.blend'))
s.render.filepath=str(OUTPUT/'action-props-light-study-v1.webp');bpy.ops.render.render(write_still=True)
