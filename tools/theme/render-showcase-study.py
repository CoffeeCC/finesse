"""A short Blender material/light study. Not a recording of the interactive browser."""
import bpy, math, random
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
ASSETS=ROOT/'src/assets/card-table'
SCENES=Path(__file__).resolve().parent/'scenes'
OUTPUT=ROOT.parent.parent/'outputs/arcane-showcase-study'
OUTPUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(SCENES/'collection-folio-v1.blend'))
for o in list(bpy.context.scene.objects):
    if o.type in {'CAMERA','LIGHT'}:bpy.data.objects.remove(o,do_unlink=True)

def append(name,offset):
    with bpy.data.libraries.load(str(SCENES/f'{name}.blend'),link=False) as (source,target):
        target.objects=[n for n in source.objects if not n.startswith(('Camera','Area','Point'))]
    group=bpy.data.objects.new(f'{name} root',None);bpy.context.collection.objects.link(group)
    for o in target.objects:
        if o and o.type in {'MESH','CURVE','EMPTY'}:
            bpy.context.collection.objects.link(o)
            if not o.parent:o.parent=group
    group.location=offset;return group

def image_material(name,filename,alpha=False):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.65
    image=bpy.data.images.load(str(ASSETS/filename),check_existing=True)
    t=m.node_tree.nodes.new('ShaderNodeTexImage');t.image=image
    m.node_tree.links.new(t.outputs['Color'],p.inputs['Base Color'])
    if alpha:m.node_tree.links.new(t.outputs['Alpha'],p.inputs['Alpha'])
    return m

# The illustration is the visible page material; modeled edges provide actual thickness.
folio=image_material('Illustrated collector pages','collection-folio-art-v1.webp',True)
bpy.ops.mesh.primitive_plane_add(size=2,location=(0,0,.345));o=bpy.context.object;o.name='Illustrated open folio';o.scale=(3.2,2.25,1);o.data.materials.append(folio)
desk=image_material('Carved wood and midnight hide','quiet-desk-v1.webp')
bpy.ops.mesh.primitive_plane_add(size=2,location=(0,0,-.035));o=bpy.context.object;o.scale=(6,4,1);o.data.materials.append(desk)
candle=append('candle-v1',(-3.25,1.3,0))
orb=append('scrying-orb-v1',(3.45,1.7,0));orb.scale=(.62,.62,.62)
cards=image_material('Celestial card back','celestial-back-v1.webp')
for i,(x,y,a) in enumerate([(-1.9,-.5,-.08),(-.8,-.5,.03),(.3,-.5,.09)]):
    bpy.ops.mesh.primitive_cube_add(size=1,location=(x,y,.43+i*.015));o=bpy.context.object;o.name='Card stock';o.dimensions=(.97,1.45,.024);o.rotation_euler.z=a
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    b=o.modifiers.new('Soft card corners','BEVEL');b.width=.04;b.segments=4
    bpy.ops.mesh.primitive_plane_add(size=2,location=(x,y,.449+i*.015));o=bpy.context.object;o.name='Card face';o.scale=(.48,.72,1);o.rotation_euler.z=a;o.data.materials.append(cards)

flame_mat=bpy.data.materials.new('Flame emission');flame_mat.use_nodes=True
p=flame_mat.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(1,.32,.025,1);p.inputs['Emission Color'].default_value=(1,.53,.12,1);p.inputs['Emission Strength'].default_value=4
bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=16,radius=1,location=(-3.25,1.3,1.82));flame=bpy.context.object;flame.name='Living flame';flame.data.materials.append(flame_mat)
for f in range(1,97):
    envelope=1 if f<40 or f>82 else max(0,(58-f)/18) if f<58 else max(0,(f-73)/10)
    flame.scale=(.055*envelope,.055*envelope,.17*envelope*(1+.06*math.sin(f*1.1)))
    flame.location.x=-3.25+.013*math.sin(f*.75);flame.keyframe_insert('scale',frame=f);flame.keyframe_insert('location',frame=f)
bpy.ops.object.light_add(type='POINT',location=(-3.25,1.3,1.9));fire=bpy.context.object;fire.name='Candle light';fire.data.color=(1,.63,.29);fire.data.shadow_soft_size=.18
for f,e in [(1,75),(35,78),(45,35),(58,0),(73,0),(85,75),(96,75)]:fire.data.energy=e;fire.data.keyframe_insert('energy',frame=f)
for loc,power,color,size in [((2,4,6),160,(.30,.48,1),5),((-4,-2,5),35,(.45,.6,1),5)]:
    bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=power;l.data.color=color;l.data.shape='DISK';l.data.size=size
    l.rotation_euler=(Vector((0,0,0))-l.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(5,-7,8.5));camera=bpy.context.object
camera.rotation_euler=(Vector((-.1,.2,.25))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=10
scene=bpy.context.scene;scene.camera=camera;scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.resolution_x=960;scene.render.resolution_y=640;scene.render.resolution_percentage=100
scene.world.color=(.015,.025,.05);scene.render.film_transparent=False
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
scene.frame_start=1;scene.frame_end=96;scene.render.fps=24
scene.render.filepath=str(OUTPUT/'frame-')
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(SCENES/'showcase-light-study-v1.blend'))
bpy.ops.render.render(animation=True)
