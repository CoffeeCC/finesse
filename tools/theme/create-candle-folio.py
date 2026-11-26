"""Arcane showcase: original candle and open collection folio, editable Blender sources."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'src/assets/card-table'
SCENES=Path(__file__).resolve().parent/'scenes'
OUT.mkdir(exist_ok=True); SCENES.mkdir(exist_ok=True)

def mat(name,color,metal=0,rough=.4):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    return m
def obj(o,name,m):
    o.name=name;o.data.materials.append(m)
    for p in o.data.polygons:p.use_smooth=True
    return o
def cube(name,loc,size,m,bevel=.04):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=obj(bpy.context.object,name,m);o.dimensions=size
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    b=o.modifiers.new('Hand softened edges','BEVEL');b.width=bevel;b.segments=3
    o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o
def sphere(name,loc,size,m):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=16,radius=1,location=loc)
    o=obj(bpy.context.object,name,m);o.scale=size;return o
def curve(name,points,r,m):
    d=bpy.data.curves.new(name,'CURVE');d.dimensions='3D';d.bevel_depth=r;d.bevel_resolution=3
    s=d.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
    for p,v in zip(s.bezier_points,points):p.co=v;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.data.materials.append(m);return o
def lathe(name,profile,m):
    verts=[];faces=[];n=72
    for r,z in profile:
        for i in range(n):verts.append((r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z))
    for j in range(len(profile)-1):
        for i in range(n):a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
    d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update()
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);return obj(o,name,m)
def reset():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def export(name):
    # Export geometry only; cameras and presentation lights remain in the editable scene.
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        if o.type in {'MESH','CURVE','EMPTY'}:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{name}.glb'),use_selection=True,export_format='GLB',export_apply=True)
def presentation(name,target,location,scale):
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32
    scene.render.resolution_x=640;scene.render.resolution_y=800;scene.render.resolution_percentage=100
    scene.render.film_transparent=True
    for loc,power,size,color in [((-3,-4,6),550,4,(1,.7,.38)),((3,1,4),700,3,(.35,.58,1))]:
        bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size;l.data.color=color
        l.rotation_euler=(Vector(target)-l.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=location);camera=bpy.context.object
    camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=scale;scene.camera=camera
    bpy.ops.wm.save_as_mainfile(filepath=str(SCENES/f'{name}.blend'))
    scene.render.image_settings.file_format='WEBP';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.quality=92
    scene.render.filepath=str(OUT/f'{name}-still.webp');bpy.ops.render.render(write_still=True)

reset()
bronze=mat('Patinated bronze',(.24,.115,.037),.85,.32)
edge=mat('Burnished bronze',(.59,.34,.11),.84,.24)
wax=mat('Warm ivory beeswax',(.72,.50,.26),0,.38)
p= wax.node_tree.nodes.get('Principled BSDF');p.inputs['Subsurface Weight'].default_value=.13
dark=mat('Charred wick',(.015,.008,.004),0,.9)
lathe('CastHolder',[(0,.025),(.56,.025),(.61,.055),(.60,.10),(.48,.14),(.30,.17),(.24,.25),(.25,.33),(.43,.38),(.48,.43),(.47,.48),(.38,.46),(.30,.42),(0,.42)],bronze)
for r,z in [(.58,.09),(.45,.45),(.28,.20)]:
    lathe('TurnedHighlight',[(r-.015,z-.018),(r+.01,z),(r-.015,z+.018)],edge)
for i in range(12):
    a=i*math.tau/12
    sphere('CastPetal',(.48*math.cos(a),.48*math.sin(a),.105),(.07,.045,.035),edge)
body=lathe('WaxBody',[(0,.43),(.26,.43),(.27,.48),(.265,1.58),(.25,1.62),(.21,1.59),(.18,1.53),(0,1.53)],wax)
# Individual rivulets have varied lengths, thickness and slight winding paths.
for i in range(9):
    a=i*2.39996;bottom=.65+(i%4)*.16
    pts=[]
    for j in range(6):
        z=1.58-(1.58-bottom)*j/5;angle=a+.06*math.sin(j*1.3+i)
        pts.append((.263*math.cos(angle),.263*math.sin(angle),z))
    curve('WaxTrail',pts,.018+(i%3)*.009,wax)
    sphere('WaxDrop',pts[-1],(.033,.033,.048),wax)
for i in range(5):
    a=i*2.4;sphere('PooledWax',(.22*math.cos(a),.20*math.sin(a),.445),(.19,.12,.025),wax)
curve('Wick',[(0,0,1.53),(.012,0,1.65),(.03,.01,1.70)],.015,dark)
export('candle-v1')
presentation('candle-v1',(0,0,.88),(2.5,-4,2.6),2.3)
from bpy_extras.object_utils import world_to_camera_view
scene=bpy.context.scene
wick=world_to_camera_view(scene,scene.camera,Vector((.02,0,1.70)))
base=world_to_camera_view(scene,scene.camera,Vector((0,0,.43)))
(OUT/'candle-layout.ts').write_text(f'// Generated by tools/theme/create-candle-folio.py\nexport const CANDLE_WICK_X = {wick.x:.6f}\nexport const CANDLE_WICK_Y = {1-wick.y:.6f}\nexport const CANDLE_WAX_BASE_Y = {1-base.y:.6f}\n')
for part in ['holder','wax']:
    for o in scene.objects:
        if o.type in {'MESH','CURVE'}:
            moving=o.name.startswith(('Wax','Wick'))
            o.hide_render=moving if part=='holder' else not moving
    scene.render.filepath=str(OUT/f'candle-{part}-v1.webp');bpy.ops.render.render(write_still=True)

reset()
leather=mat('Midnight grained leather',(.018,.038,.055),.08,.6)
paper=mat('Blue laid paper',(.10,.155,.18),0,.85)
pages=mat('Gilt page edges',(.31,.24,.14),.3,.7)
cube('FolioCover',(0,0,.06),(6.26,4.18,.12),leather,.12)
for side in [-1,1]:
    before=set(bpy.context.scene.objects)
    cube('PageBlock',(side*1.55,0,.16),(2.98,4.0,.15),pages,.07)
    cube('LaidPage',(side*1.55,0,.25),(2.92,3.94,.035),paper,.06)
    for j in range(8):
        curve('BoundPageEdge',[(side*.12,-2.12,.12+j*.012),(side*3.04,-2.12,.12+j*.012)],.005,edge)
    for x in [side*.14,side*3.04]:
        curve('TooledBinding',[(x,-2.04,.28),(x,2.04,.28)],.014,edge)
    for y in [-2.04,2.04]:
        curve('TooledBinding',[(side*.14,y,.28),(side*3.04,y,.28)],.014,edge)
    for y in [-1.85,1.85]:
        cube('CornerFitting',(side*2.93,y,.29),(.24,.30,.025),bronze,.025)
    parts=set(bpy.context.scene.objects)-before
    bpy.ops.object.empty_add(type='PLAIN_AXES',location=(.512,0,.25));pivot=bpy.context.object
    pivot.name='FolioLeftPivot' if side<0 else 'FolioRightPivot'
    for part in parts:
        world=part.matrix_world.copy();part.parent=pivot;part.matrix_world=world
curve('BindingSpine',[(0,-2.15,.24),(0,0,.30),(0,2.15,.24)],.075,leather)
for y in [-1.6,-.8,0,.8,1.6]:
    curve('SpineStitch',[(-.09,y,.29),(0,y+.06,.33),(.09,y,.29)],.009,edge)
# The illustrated cover has transparent padding. Keep the modeled page edges
# inside its silhouette rather than exposing straight strips below the binding.
from mathutils import Matrix
inset = Matrix.Diagonal((.94, .90, 1, 1))
for part in list(bpy.context.scene.objects):
    if part.type in {'MESH', 'CURVE'}:
        part.matrix_world = inset @ part.matrix_world
export('collection-folio-v1')
presentation('collection-folio-v1',(0,0,0),(1,-6,8),7.3)
