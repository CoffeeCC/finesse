"""Shared original Blender prop authoring utilities.
Blender 5.2; editable sources + GLBs + matching transparent stills, no borrowed assets.
"""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]; OUT=ROOT/'src/assets/card-table'; SCENES=ROOT/'tools/theme/scenes'
def reset():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def mat(name,color,metal=0,rough=.5):
    m=bpy.data.materials.new(name); m.use_nodes=True; p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    return m
bronze=mat('Aged bronze',(.32,.17,.055),.82,.34); gold=mat('Burnished edges',(.66,.40,.12),.88,.27)
paper=mat('Warm rag parchment',(.57,.45,.29),0,.88); wax=mat('Oxblood sealing wax',(.22,.022,.032),.08,.36)
wood=mat('Dark turned walnut',(.06,.022,.014),.05,.37); ink=mat('Midnight enamel',(.012,.032,.05),.3,.43)
glass=mat('Crystal glass',(.13,.29,.40),.05,.12)
p=glass.node_tree.nodes.get('Principled BSDF');p.inputs['Transmission Weight'].default_value=.35;p.inputs['Coat Weight'].default_value=.6;p.inputs['Alpha'].default_value=.48
glass.surface_render_method='DITHERED'
def finish(o,name,m):
    o.name=name;o.data.materials.append(m)
    for f in o.data.polygons:f.use_smooth=True
    return o
def cube(name,loc,scale,m,bevel=.03):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=finish(bpy.context.object,name,m);o.scale=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    b=o.modifiers.new('Soft worked edge','BEVEL');b.width=bevel;b.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o
def sphere(name,loc,scale,m,segments=40,rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments,ring_count=rings,location=loc);o=finish(bpy.context.object,name,m);o.scale=scale;return o
def disc(name,loc,r,depth,m):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=r,depth=depth,location=loc);o=finish(bpy.context.object,name,m)
    b=o.modifiers.new('Turned bevel','BEVEL');b.width=.018;b.segments=3;o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o
def torus(name,loc,r,tube,m):
    bpy.ops.mesh.primitive_torus_add(major_radius=r,minor_radius=tube,major_segments=64,minor_segments=12,location=loc)
    return finish(bpy.context.object,name,m)
def line(name,points,r,m):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.bevel_depth=r;c.bevel_resolution=3
    s=c.splines.new('POLY');s.points.add(len(points)-1)
    for p,v in zip(s.points,points):p.co=(*v,1)
    o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.data.materials.append(m);return o
def parent(parts,name,origin):
    bpy.context.view_layer.update();bpy.ops.object.empty_add(type='PLAIN_AXES',location=origin);pivot=bpy.context.object;pivot.name=name
    for o in parts:
        world=o.matrix_world.copy();o.parent=pivot;o.matrix_world=world
    return pivot
def export(name,target,scale=3.2):
    bpy.ops.object.select_all(action='DESELECT')
    for o in bpy.context.scene.objects:
        if o.type in {'MESH','CURVE','EMPTY'}:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{name}.glb'),use_selection=True,export_format='GLB',export_apply=True)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=40
    scene.render.resolution_x=640;scene.render.resolution_y=640;scene.render.resolution_percentage=100;scene.render.film_transparent=True
    for loc,power,size,color in [((-3,-4,5),450,4,(1,.73,.43)),((3,2,4),500,3,(.40,.64,1))]:
        bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=power;l.data.size=size;l.data.color=color
        l.rotation_euler=(Vector(target)-l.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=(1,-4.5,6));cam=bpy.context.object;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=scale;scene.camera=cam
    bpy.ops.wm.save_as_mainfile(filepath=str(SCENES/f'{name}.blend'))
    scene.render.image_settings.file_format='WEBP';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.quality=94
    scene.render.filepath=str(OUT/f'{name}-still.webp');bpy.ops.render.render(write_still=True)

