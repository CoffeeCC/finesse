"""Original live scrying orb model, editable scene, and rendered fallback. Blender 5.2."""
import bpy, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'src/assets/card-table'
SCENES = Path(__file__).resolve().parent / 'scenes'
OUT.mkdir(parents=True, exist_ok=True)
SCENES.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, color, metal=0, rough=.3, emission=0):
    m=bpy.data.materials.new(name); m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal
    p.inputs['Roughness'].default_value=rough
    if emission:
        p.inputs['Emission Color'].default_value=(*color,1)
        p.inputs['Emission Strength'].default_value=emission
    return m

bronze=material('Worn burnished bronze',(.32,.16,.055),.83,.29)
gold=material('Polished relief edges',(.68,.40,.12),.87,.23)
dark=material('Midnight enamel',(.014,.035,.065),.45,.25)
gem=material('Blue cabochons',(.018,.20,.38),.4,.12)
glow=material('Constellation light',(.13,.48,1),.05,.28,2.5)
glass=material('CrystalShell',(.18,.40,.65),.05,.085)
p=glass.node_tree.nodes.get('Principled BSDF')
p.inputs['Transmission Weight'].default_value=.85
p.inputs['IOR'].default_value=1.45
p.inputs['Coat Weight'].default_value=.6

def finish(o,name,mat):
    o.name=name; o.data.materials.append(mat)
    if o.type=='MESH':
        for f in o.data.polygons: f.use_smooth=True
    return o

def ring(name,radius,tube,z,mat):
    bpy.ops.mesh.primitive_torus_add(major_segments=72,minor_segments=10,major_radius=radius,minor_radius=tube,location=(0,0,z))
    return finish(bpy.context.object,name,mat)

def sphere(name,radius,location,mat,scale=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40 if radius > .3 else 12,ring_count=24 if radius > .3 else 8,radius=radius,location=location)
    o=finish(bpy.context.object,name,mat)
    if scale: o.scale=scale
    return o

def curve(name,points,radius,mat):
    data=bpy.data.curves.new(name,'CURVE'); data.dimensions='3D'; data.bevel_depth=radius; data.bevel_resolution=1
    spline=data.splines.new('POLY'); spline.points.add(len(points)-1)
    for p,co in zip(spline.points,points): p.co=(*co,1)
    o=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(o); o.data.materials.append(mat)
    return o

# Turned base, layered rim and individually modeled relief, not flat icon art.
for radius,depth,z,mat in [(.67,.10,.12,bronze),(.59,.13,.22,dark),(.57,.05,.31,gold),(.43,.14,.38,bronze),(.49,.07,.47,gold)]:
    bpy.ops.mesh.primitive_cylinder_add(vertices=72,radius=radius,depth=depth,location=(0,0,z))
    o=finish(bpy.context.object,'Turned pedestal',mat)
    bevel=o.modifiers.new('Worn edge bevel','BEVEL'); bevel.width=.025; bevel.segments=3
ring('Lower milled ring',.64,.023,.17,gold)
ring('Enamel edge',.59,.018,.27,gold)
ring('Cradle ring',.52,.038,.56,gold)
ring('Cradle shadow inset',.52,.025,.61,dark)
for i in range(24):
    a=i*math.tau/24
    sphere('Inset rivet',.018,(.60*math.cos(a),.60*math.sin(a),.295),gold)
for i in range(3):
    a=i*math.tau/3 + .4
    # Swept, tapered-looking claw silhouettes cradle the lower crystal.
    pts=[]
    for k in range(36):
        t=k/35; r=.51 + .23*math.sin(t*math.pi*.8)
        ang=a + .10*math.sin(t*math.pi)
        pts.append((r*math.cos(ang),r*math.sin(ang),.36+.8*t))
    curve('Swept bronze claw',pts,.045,bronze)
    curve('Claw gilded spine',[(x*1.025,y*1.025,z+.018) for x,y,z in pts],.013,gold)
    sphere('Claw tip',.07,pts[-1],gold,scale=(.7,.7,1.6))
    sphere('Splayed foot',.17,(.53*math.cos(a),.53*math.sin(a),.08),bronze,scale=(1.1,.7,.4))
    for j in [-1,1]:
        scroll=[]
        for k in range(44):
            t=k/43; ang=a+j*(.08+.5*t); r=.45+.14*math.sin(t*math.pi)
            scroll.append((r*math.cos(ang),r*math.sin(ang),.40+.13*math.sin(t*math.pi*1.5)))
        curve('Filigree scroll',scroll,.012,gold)
    sphere('Cradle cabochon',.055,(.54*math.cos(a),.54*math.sin(a),.58),gem)

sphere('CrystalShell',.85,(0,0,1.38),glass)
# Static constellation source geometry is retained in Blender and fallback.
# The browser replaces this core with an animated nebula shader.
for j in range(3):
    pts=[]
    for k in range(100):
        t=k/99; a=t*math.tau*1.4+j*2.1; r=.12+.43*math.sin(t*math.pi)
        pts.append((r*math.cos(a),r*math.sin(a),.87+t*.95))
    curve('NebulaSource',pts,.012,glow)
for i in range(38):
    a=i*2.39996; z=-.65+1.3*(i+.5)/38; r=math.sqrt(max(0,.68**2-z*z))*.78
    sphere('StarSource',.008+(i%3)*.003,(r*math.cos(a),r*math.sin(a),1.38+z),glow)

# Convert evaluated meshes for a self-contained compact GLB.
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.convert(target='MESH')
for o in bpy.context.selected_objects:
    bpy.context.view_layer.objects.active=o
    for modifier in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
for o in bpy.context.selected_objects:
    if o.name.startswith(('NebulaSource','StarSource')): o.select_set(False)
bpy.ops.export_scene.gltf(filepath=str(OUT/'scrying-orb-v1.glb'),export_format='GLB',use_selection=True,export_yup=True)

for pos,power,color,size in [((-3,-4,6),650,(1,.78,.45),4),((3,1,4),500,(.35,.62,1),3),((0,2,1),100,(.3,.5,1),2)]:
    bpy.ops.object.light_add(type='AREA',location=pos)
    o=bpy.context.object; o.data.energy=power; o.data.color=color; o.data.shape='DISK'; o.data.size=size
    o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='POINT',location=(0,0,1.38)); bpy.context.object.data.energy=8; bpy.context.object.data.color=(.2,.5,1)
bpy.ops.object.camera_add(location=(3,-6,3.2))
camera=bpy.context.object; camera.rotation_euler=(Vector((0,0,1.1))-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.type='ORTHO'; camera.data.ortho_scale=2.8
scene=bpy.context.scene; scene.camera=camera; scene.render.engine='CYCLES'; scene.cycles.samples=48; scene.cycles.use_denoising=True
scene.render.film_transparent=True; scene.world.color=(.15,.15,.15)
scene.render.resolution_x=512; scene.render.resolution_y=512; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.image_settings.color_mode='RGBA'; scene.view_settings.view_transform='AgX'
scene.render.filepath=str(OUT/'scrying-orb-still-v1.png')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SCENES/'scrying-orb-v1.blend'))
bpy.ops.render.render(write_still=True)
