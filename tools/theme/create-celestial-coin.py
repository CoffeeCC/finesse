"""Original two-sided bronze/gold coin. Blender 5.2; no external assets."""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'src/assets/card-table'
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def material(name,color,metal,rough):
    m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    return m
gold=material('Worn honey gold',(.53,.30,.075),.88,.28)
dark=material('Recessed midnight enamel',(.015,.033,.052),.45,.35)
edge=material('Polished relief',(.77,.49,.16),.9,.23)
def finish(o,name,mat):
    o.name=name;o.data.materials.append(mat)
    for p in o.data.polygons:p.use_smooth=True
    return o
def disc(name,r,depth,z,mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=r,depth=depth,location=(0,0,z))
    o=finish(bpy.context.object,name,mat);b=o.modifiers.new('Mint bevel','BEVEL');b.width=.014;b.segments=3
    o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o
def line(name,points,r,mat):
    d=bpy.data.curves.new(name,'CURVE');d.dimensions='3D';d.bevel_depth=r;d.bevel_resolution=3
    s=d.splines.new('POLY');s.points.add(len(points)-1)
    for p,v in zip(s.points,points):p.co=(*v,1)
    o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);o.data.materials.append(mat)
disc('CoinStock',.68,.095,0,gold)
for side in [-1,1]:
    z=side*.056
    disc('EnamelField',.59,.016,z,dark)
    for r in [.625,.535]:
        line('RaisedRim',[(r*math.cos(i*math.tau/96),r*math.sin(i*math.tau/96),side*.072) for i in range(97)],.013,edge)
    for i in range(40):
        a=i*math.tau/40
        line('MintBead',[(r*math.cos(a),r*math.sin(a),side*.071) for r in [.565,.589]],.009,edge)
    if side>0:
        disc('SunHeart',.17,.023,.084,edge)
        for i in range(12):
            a=i*math.tau/12
            line('SunRay',[(r*math.cos(a),r*math.sin(a),.087) for r in [.235,.40]],.015,edge)
    else:
        # Closed crescent outline and three small stars on the reverse.
        pts=[(.30*math.cos(a),.30*math.sin(a),-.087) for a in [math.radians(65+i*230/48) for i in range(49)]]
        pts += [(.17+.265*math.cos(a),.265*math.sin(a),-.087) for a in [math.radians(255-i*150/40) for i in range(41)]]
        pts.append(pts[0]);line('MoonRelief',pts,.025,edge)
        for x,y in [(.30,.26),(.36,-.18),(.08,.39)]:
            line('Star',[(x,y-.035,-.087),(x,y+.035,-.087)],.012,edge)
            line('Star',[(x-.035,y,-.087),(x+.035,y,-.087)],.012,edge)
for i in range(72):
    a=i*math.tau/72
    line('ReededEdge',[(.677*math.cos(a),.677*math.sin(a),z) for z in [-.025,.025]],.005,gold)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT/'celestial-coin-v1.glb'),use_selection=True,export_format='GLB',export_apply=True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=480;scene.render.resolution_y=480;scene.render.resolution_percentage=100;scene.render.film_transparent=True
for loc,power,color in [((-2,-3,4),350,(1,.72,.4)),((2,2,3),450,(.4,.6,1)),((1,-3,-4),400,(1,.72,.4))]:
    bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=power;l.data.size=3;l.data.color=color
    l.rotation_euler=(Vector((0,0,0))-l.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(0,-3,5));cam=bpy.context.object;cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=1.7;scene.camera=cam
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'tools/theme/scenes/celestial-coin-v1.blend'))
scene.render.image_settings.file_format='WEBP';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.quality=92
scene.render.filepath=str(OUT/'celestial-coin-sun-v1.webp');bpy.ops.render.render(write_still=True)
cam.location.z=-5;cam.rotation_euler=(-cam.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(OUT/'celestial-coin-moon-v1.webp');bpy.ops.render.render(write_still=True)
