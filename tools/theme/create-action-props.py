"""Original leather story codex and physical draw stack. Blender 5.2."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'src/assets/card-table';SCENES=ROOT/'tools/theme/scenes'
def reset():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def mat(name,color,metal=0,rough=.5):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    return m
def cube(name,loc,size,material,bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;o.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    b=o.modifiers.new('Crafted bevel','BEVEL');b.width=bevel;b.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o
def line(name,pts,r,material):
    d=bpy.data.curves.new(name,'CURVE');d.dimensions='3D';d.bevel_depth=r;d.bevel_resolution=2
    s=d.splines.new('POLY');s.points.add(len(pts)-1)
    for p,v in zip(s.points,pts):p.co=(*v,1)
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.data.materials.append(material);return o
def empty(name,loc):
    bpy.ops.object.empty_add(type='PLAIN_AXES',location=loc);o=bpy.context.object;o.name=name;return o
def parent(o,p):
    bpy.context.view_layer.update()
    world=o.matrix_world.copy();o.parent=p;o.matrix_world=world
def face(name,loc,size,material):
    bpy.ops.mesh.primitive_plane_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.scale=(*size,1);o.data.materials.append(material);return o
def leather_grain(material):
    # Bake original procedural leather grain into a portable tangent normal map.
    # The GLB and packed .blend carry it; the browser needs no Blender node graph.
    bpy.ops.mesh.primitive_plane_add(size=2,location=(0,0,-10));o=bpy.context.object
    bake=mat('Grain bake source',(.03,.05,.07));o.data.materials.append(bake)
    nodes=bake.node_tree.nodes;p=nodes.get('Principled BSDF')
    noise=nodes.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=95;noise.inputs['Detail'].default_value=2
    bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.24;bump.inputs['Distance'].default_value=.035
    bake.node_tree.links.new(noise.outputs['Fac'],bump.inputs['Height']);bake.node_tree.links.new(bump.outputs['Normal'],p.inputs['Normal'])
    image=bpy.data.images.new('Original leather grain normal',256,256);image.colorspace_settings.name='Non-Color'
    target=nodes.new('ShaderNodeTexImage');target.image=image;nodes.active=target
    bpy.context.scene.render.engine='CYCLES';bpy.context.scene.cycles.samples=1
    bpy.ops.object.bake(type='NORMAL',normal_space='TANGENT',margin=2);image.pack()
    bpy.data.objects.remove(o,do_unlink=True)
    texture=material.node_tree.nodes.new('ShaderNodeTexImage');texture.image=image
    normal=material.node_tree.nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.4
    material.node_tree.links.new(texture.outputs['Color'],normal.inputs['Color'])
    material.node_tree.links.new(normal.outputs['Normal'],material.node_tree.nodes.get('Principled BSDF').inputs['Normal'])
def export(name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        if o.type in {'MESH','CURVE','EMPTY'}:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{name}.glb'),export_format='GLB',use_selection=True,export_apply=True)
def artwork():
    m=mat('Approved celestial inlay',(1,1,1),.25,.48)
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(OUT/'celestial-back-v1.webp'),check_existing=True)
    m.node_tree.links.new(tex.outputs['Color'],m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
    for o in bpy.context.scene.objects:
        if o.name.startswith(('CodexInlay','DrawBack')):o.data.materials.clear();o.data.materials.append(m)
def presentation(name):
    artwork();s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=32;s.cycles.use_denoising=True
    s.render.resolution_x=640;s.render.resolution_y=560;s.render.resolution_percentage=100;s.render.film_transparent=True
    for loc,power,color in [((-3,-4,5),520,(1,.70,.38)),((3,2,5),600,(.38,.57,1))]:
        bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=power;l.data.size=4;l.data.color=color
        l.rotation_euler=(-l.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=(1,-4,6));c=bpy.context.object;c.rotation_euler=(Vector((0,0,.1))-c.location).to_track_quat('-Z','Y').to_euler();c.data.type='ORTHO';c.data.ortho_scale=2.85;s.camera=c
    bpy.ops.file.pack_all();bpy.ops.wm.save_as_mainfile(filepath=str(SCENES/f'{name}.blend'))
    s.render.image_settings.file_format='WEBP';s.render.image_settings.color_mode='RGBA';s.render.image_settings.quality=92
    s.render.filepath=str(OUT/f'{name}-still.webp');bpy.ops.render.render(write_still=True)

reset()
leather=mat('Midnight leather',(.022,.047,.069),.1,.58);gold=mat('Burnished bronze',(.54,.29,.085),.84,.3)
leather_grain(leather)
pages=mat('Warm gilt page edges',(.55,.44,.25),.35,.63);dark=mat('Binding shadow',(.012,.019,.025),0,.8);ribbon=mat('Oxblood silk',(.18,.025,.025),.12,.5)
cube('LowerCover',(0,0,.06),(1.78,2.18,.12),leather,.055)
cube('PageBlock',(.035,0,.20),(1.63,2.02,.20),pages,.03)
for i in range(9):
    z=.12+i*.019
    line('IndividualPageEdge',[(-.74,-1.016,z),(.82,-1.016,z),(.835,-.98,z),(.835,.98,z)],.0035,dark)
cube('BoundSpine',(-.82,0,.22),(.14,2.12,.32),leather,.065)
for y in [-.77,-.42,.42,.77]:cube('SpineBand',(-.86,y,.23),(.10,.048,.29),gold,.015)
cover=empty('CodexCoverPivot',(-.85,0,.33))
parts=set(bpy.context.scene.objects)
cube('UpperCover',(0,0,.35),(1.80,2.20,.11),leather,.055)
for x in [-.82,.82]:line('CoverTooling',[(x,-1.00,.412),(x,1.00,.412)],.009,gold)
for y in [-1.00,1.00]:line('CoverTooling',[(-.82,y,.412),(.82,y,.412)],.009,gold)
for x in [-.80,.80]:
    for y in [-.98,.98]:
        cube('CornerMetal',(x,y,.418),(.18,.19,.025),gold,.025)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=.016,location=(x,y,.439));o=bpy.context.object;o.name='CornerRivet';o.scale.z=.35;o.data.materials.append(gold)
thread=mat('Saddle stitching',(.25,.17,.085),0,.75)
for x in [-.77,.77]:
    for i in range(20):
        y=-.86+i*.09;line('SaddleStitch',[(x,y,.411),(x,y+.027,.411)],.004,thread)
face('CodexInlay',(0,0,.416),(1.38,1.82),leather)
for o in set(bpy.context.scene.objects)-parts:parent(o,cover)
clasp=empty('CodexClaspPivot',(.86,-.06,.43));parent(clasp,cover)
o=cube('ClaspArm',(.74,-.06,.448),(.30,.15,.045),gold,.025);parent(o,clasp)
o=cube('ClaspEnamel',(.68,-.06,.476),(.09,.085,.012),leather,.025);parent(o,clasp)
cube('BookmarkRibbon',(.39,-1.06,.105),(.11,.54,.012),ribbon,.008)
cube('BookmarkTip',(.39,-1.32,.106),(.13,.085,.02),gold,.009)
export('story-codex-v1');presentation('story-codex-v1')

reset()
paper=mat('Ivory card stock',(.67,.61,.47),.08,.72);navy=mat('Midnight card back',(.018,.038,.06),.2,.5)
gold=mat('Card edge bronze',(.47,.28,.09),.65,.4)
packets=[empty('PacketA',(0,0,0)),empty('PacketB',(0,0,.13)),empty('TopCard',(0,0,.26))]
for i in range(14):
    z=.03+i*.023;x=math.sin(i*2.4)*.017;y=math.cos(i*1.7)*.014
    node=packets[0 if i<6 else 1 if i<13 else 2]
    o=cube('CardStock',(x,y,z),(1.42,2.04,.022),paper,.025);parent(o,node)
    if i in [5,12,13]:
        o=face('DrawBack',(x,y,z+.012),(1.40,2.02),navy);parent(o,node)
        for sx in [-1,1]:
            for sy in [-1,1]:
                o=line('ReliefCorner',[(x+sx*.61,y+sy*.84,z+.015),(x+sx*.61,y+sy*.94,z+.015),(x+sx*.51,y+sy*.94,z+.015)],.007,gold);parent(o,node)
export('draw-deck-v1');presentation('draw-deck-v1')
