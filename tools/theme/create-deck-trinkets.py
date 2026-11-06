"""Matching celestial deck boxes: editable Blender sources, GLBs and stills."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'src/assets/card-table'
SCENES=Path(__file__).resolve().parent/'scenes'

def material(name,color,metal=0,rough=.3,emission=0):
    m=bpy.data.materials.new(name);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    if emission:
        p.inputs['Emission Color'].default_value=(*color,1);p.inputs['Emission Strength'].default_value=emission
    return m

def finish(o,name,mat,parent=None):
    o.name=name;o.data.materials.append(mat)
    if parent:o.parent=parent
    return o

def box(name,location,scale,mat,bevel=.035,parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1,location=location)
    o=finish(bpy.context.object,name,mat,parent);o.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    mod=o.modifiers.new('Sculpted bevel','BEVEL');mod.width=bevel;mod.segments=3
    o.modifiers.new('Weighted normals','WEIGHTED_NORMAL')
    return o

def line(name,points,mat,r=.012,parent=None):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.bevel_depth=r;data.bevel_resolution=1
    s=data.splines.new('POLY');s.points.add(len(points)-1)
    for p,xyz in zip(s.points,points):p.co=(*xyz,1)
    o=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(o);o.data.materials.append(mat)
    if parent:o.parent=parent
    return o

def star(name,x,y,z,r,mat,parent=None):
    points=[(x+(r if i%2==0 else r*.24)*math.sin(i*math.tau/8),y,z+(r if i%2==0 else r*.24)*math.cos(i*math.tau/8)) for i in range(8)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(points,[],[list(range(8))]);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);finish(o,name,mat,parent)
    mod=o.modifiers.new('Raised crest','SOLIDIFY');mod.thickness=.018
    return o

for kind in ['movies','shows']:
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    gold=material('Aged bronze',(.46,.25,.085),.86,.28)
    edge=material('Polished edge',(.71,.47,.19),.88,.23)
    blue=material('Midnight leather',(.014,.035,.060),.12,.46)
    dark=material('Recessed enamel',(.008,.018,.028),.32,.31)
    paper=material('Warm paper edges',(.55,.38,.19),.15,.53)
    ward=material('WardLight',(.08,.29,.64) if kind=='shows' else (.65,.27,.06),.3,.18,.35)
    box('Base',(0,0,.08),(1.64,1.1,.12),gold)
    box('Front leather',(0,-.49,.5),(1.54,.12,.8),blue)
    box('Left leather',(-.76,0,.5),(.12,1,.8),blue)
    box('Right leather',(.76,0,.5),(.12,1,.8),blue)
    box('Back',(0,.48,.5),(1.54,.1,.8),dark)
    for x in [-.78,.78]:
        box('Bronze corner',(x,-.52,.5),(.075,.07,.85),gold,.025)
        box('Rear corner',(x,.49,.5),(.075,.06,.85),gold,.025)
    for z in [.15,.88]:
        box('Front milled edge',(0,-.565,z),(1.6,.055,.045),edge,.018)
        for x in [-.79,.79]:box('Side milled edge',(x,0,z),(.045,1.05,.045),edge,.016)
    for x in [-.68,.68]:
        for z in [.24,.76]:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=.058,location=(x,-.57,z))
            o=finish(bpy.context.object,'Corner cabochon',ward);o.scale=(1,.4,1)
    # Circular cast medallion, celestial radial tooling and corner scrolls.
    for radius in [.275,.30]:
        pts=[(radius*math.sin(i*math.tau/64),-.568,.51+radius*math.cos(i*math.tau/64)) for i in range(65)]
        line('Cast medallion',pts,edge,.012)
    if kind=='movies':star('Sun crest',0,-.59,.51,.225,edge)
    else:
        pts=[(.18*math.cos(a),-.59,.51+.18*math.sin(a)) for a in [(.3+i/48*5.7) for i in range(49)]]
        pts +=[(.12+.14*math.cos(a),-.59,.51+.14*math.sin(a)) for a in [(6-i/48*5.7) for i in range(49)]]
        line('Crescent crest',pts,edge,.025)
        star('Moon companion star',.12,-.595,.6,.075,ward)
    for side in [-1,1]:
        for z in [.27,.75]:
            pts=[]
            for i in range(48):
                t=i/47*math.tau*1.15;r=.13*(1-i/60)
                pts.append((side*(.49+r*math.cos(t)),-.575,z+r*.7*math.sin(t)))
            line('Engraved scroll',pts,gold,.009)
    # Lid rotates around a real hinge; cards lift independently in the browser.
    bpy.ops.object.empty_add(type='PLAIN_AXES',location=(0,.49,.85));lid=bpy.context.object;lid.name='LidPivot'
    box('Lid leather',(0,0,.50),(1.64,.12,1.04),blue,.04,lid)
    for x in [-.78,.78]:box('Lid side trim',(x,-.075,.50),(.05,.045,1.04),edge,.018,lid)
    for z in [.02,.98]:box('Lid cross trim',(0,-.075,z),(1.58,.045,.05),edge,.018,lid)
    star('Lid celestial crest',0,-.08,.51,.30,gold,lid)
    star('Lid outer celestial crest',0,.08,.51,.30,gold,lid)
    for i in range(12):
        a=i*math.tau/12
        star('Lid stars',.49*math.sin(a),-.08,.51+.35*math.cos(a),.025,edge,lid)
    lid.rotation_euler.x=math.pi/2
    bpy.ops.object.empty_add(type='PLAIN_AXES',location=(0,0,0));cards=bpy.context.object;cards.name='CardLift'
    for i in range(12):
        y=-.28+i*.049
        o=box('Card leaf',(0,y,.49),(1.34,.028,.72),paper,.025,cards)
        o.rotation_euler.x=-.1
        if i==0:
            box('Card face',(0,y-.025,.51),(1.26,.012,.64),blue,.022,cards)
            star('Card celestial seal',0,y-.04,.53,.18,edge,cards)
    # Convert evaluated geometry while retaining hinge and lift parent nodes.
    bpy.ops.object.select_all(action='DESELECT')
    for o in list(bpy.context.scene.objects):
        if o.type in ['MESH','CURVE']:o.select_set(True)
    bpy.context.view_layer.objects.active=next(o for o in bpy.context.selected_objects if o.type=='MESH')
    bpy.ops.object.convert(target='MESH')
    for o in bpy.context.selected_objects:
        bpy.context.view_layer.objects.active=o
        for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'deck-{kind}-v1.glb'),export_format='GLB',export_yup=True)
    for pos,power,color,size in [((-3,-4,6),650,(1,.78,.45),4),((3,1,4),400,(.35,.62,1),3)]:
        bpy.ops.object.light_add(type='AREA',location=pos);o=bpy.context.object;o.data.energy=power;o.data.color=color;o.data.size=size
        o.rotation_euler=(Vector((0,0,.8))-o.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=(3,-5,3.1));camera=bpy.context.object
    camera.rotation_euler=(Vector((0,0,.94))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=2.7
    scene=bpy.context.scene;scene.camera=camera;scene.render.engine='CYCLES';scene.cycles.samples=40;scene.cycles.use_denoising=True
    scene.render.film_transparent=True;scene.world.color=(.15,.15,.15)
    scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.view_settings.view_transform='AgX'
    scene.render.filepath=str(OUT/f'deck-{kind}-still-v1.png');bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(SCENES/f'deck-{kind}-v1.blend'));bpy.ops.render.render(write_still=True)
