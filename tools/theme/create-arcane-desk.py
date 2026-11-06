"""Original articulated desk: distinct velvet interior, real hinge, lock and key.
Blender 5.2. Exports wide/portrait GLBs, editable scenes and matching open stills.
"""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_prop_tools import *

def empty(name,loc=(0,0,0)):
    bpy.ops.object.empty_add(type='PLAIN_AXES',location=loc);o=bpy.context.object;o.name=name;return o

def image_material(name,path):
    m=mat(name,(1,1,1),.12,.72);p=m.node_tree.nodes.get('Principled BSDF')
    tex=m.node_tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(path));tex.image.pack();m.node_tree.links.new(tex.outputs['Color'],p.inputs['Base Color']);return m

for portrait in [False,True]:
    reset()
    width,length=(6.6,14.0) if portrait else (10.6,7.2)
    timber=mat('Blackened walnut case',(.037,.017,.011),.08,.42)
    lining=mat('Oxblood velvet interior',(.105,.014,.027),0,.91)
    lining.node_tree.nodes.get('Principled BSDF').inputs['Sheen Weight'].default_value=.32
    inner=mat('Warm interior leather',(.15,.052,.022),.06,.68)
    outside=image_material('Original celestial outer mat',OUT/'quiet-desk-v1.webp')
    embroidery=image_material('Original embroidered velvet albedo',OUT/('velvet-lining-portrait-v1.webp' if portrait else 'velvet-lining-wide-v1.webp'))
    embroidery.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value=.04
    embroidery.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.88
    cube('CaseBase',(0,0,-.18),(width,length,.30),timber,.10)
    cube('VelvetFloor',(0,0,.005),(width-.64,length-.64,.09),lining,.07)
    bpy.ops.mesh.primitive_plane_add(size=1,location=(0,0,.056));face=finish(bpy.context.object,'VelvetEmbroideryFace',embroidery);face.scale=(width-.72,length-.72,1)
    for side in [-1,1]:
        cube('CaseSide',(side*(width/2-.11),0,.25),(.22,length,.78),timber,.045)
        cube('CaseEnd',(0,side*(length/2-.11),.25),(width,.22,.78),timber,.045)
        cube('InnerLipSide',(side*(width/2-.32),0,.10),(.065,length-.60,.11),gold,.018)
        cube('InnerLipEnd',(0,side*(length/2-.32),.10),(width-.60,.065,.11),gold,.018)
        # A physical recessed border: no outer-chain artwork inside the cabinet.
        line('VelvetStitch',[(side*(width/2-.49),-length/2+.5,.065),(side*(width/2-.49),length/2-.5,.065)],.009,bronze)
    for x in [-width/2+.40,width/2-.40]:
        for y in [-length/2+.40,length/2-.40]:
            stud=disc('LiningTack',(x,y,.08),.048,.024,gold)
    # A separate lower lighting drawer: real tray, underframe and telescoping rails.
    drawer_width=width*.70;drawer_length=7.0 if portrait else 4.4
    green=mat('Forest green drawer baize',(.018,.065,.047),0,.94)
    cube('UnderframeBase',(0,0,-1.08),(width,length,.16),timber,.06)
    for side in [-1,1]:
        cube('UnderframeSide',(side*(width/2-.12),0,-.63),(.24,length,.86),timber,.045)
        support=(width-drawer_width)/2-.12
        cube('DrawerFrontSupport',(side*(drawer_width/2+support/2+.06),-length/2,-.63),(support,.22,.86),timber,.035)
    cube('UnderframeBack',(0,length/2-.12,-.63),(width,.24,.86),timber,.045)
    drawer_center_y=-length/2+drawer_length/2
    for side in [-1,1]:cube('FixedDrawerRail',(side*(drawer_width/2+.04),drawer_center_y,-.72),(.07,drawer_length-.20,.08),bronze,.012)
    before=set(bpy.context.scene.objects)
    cube('LightingDrawerFloor',(0,drawer_center_y,-.82),(drawer_width,drawer_length,.12),timber,.055)
    cube('DrawerBaize',(0,drawer_center_y,-.75),(drawer_width-.28,drawer_length-.28,.025),green,.025)
    for side in [-1,1]:
        cube('LightingDrawerSide',(side*(drawer_width/2-.05),drawer_center_y,-.57),(.10,drawer_length,.45),timber,.025)
        cube('SlidingDrawerRail',(side*(drawer_width/2+.02),drawer_center_y,-.69),(.06,drawer_length-.15,.05),gold,.008)
        line('DrawerBaizeBorder',[(side*(drawer_width/2-.22),drawer_center_y-drawer_length/2+.22,-.73),(side*(drawer_width/2-.22),drawer_center_y+drawer_length/2-.22,-.73)],.008,gold)
    cube('LightingDrawerBack',(0,drawer_center_y+drawer_length/2-.05,-.57),(drawer_width,.10,.45),timber,.025)
    cube('LightingDrawerFront',(0,-length/2-.08,-.63),(drawer_width+.14,.18,.70),timber,.045)
    for z in [-.9,-.36]:line('DrawerFrontInlay',[(-drawer_width/2+.16,-length/2-.18,z),(drawer_width/2-.16,-length/2-.18,z)],.012,gold)
    pull=torus('DrawerPull',(0,-length/2-.24,-.63),.14,.03,gold);pull.rotation_euler.x=math.pi/2
    for x in [-.18,.18]:
        mount=disc('DrawerPullMount',(x,-length/2-.19,-.57),.045,.03,bronze);mount.rotation_euler.x=math.pi/2
    drawer=parent(set(bpy.context.scene.objects)-before,'LightingDrawer',(0,drawer_center_y,-.82))
    for f,offset in [(1,0),(76,0),(77,0),(122,-drawer_length*.82)]:
        drawer.location.y=drawer_center_y+offset;drawer.keyframe_insert(data_path='location',index=1,frame=f)
    # Worked bronze corner foliage on the inside; original geometry.
    for sx in [-1,1]:
        for sy in [-1,1]:
            cx=sx*(width/2-.56);cy=sy*(length/2-.56)
            for radius in [.17,.27,.37]:
                points=[(cx-sx*radius*math.cos(i*math.pi/2/18),cy-sy*radius*math.sin(i*math.pi/2/18),.075) for i in range(19)]
                line('InteriorCornerScroll',points,.009,gold)
    # Separate back hinge and its lid assembly. Local X is the hinge axis.
    before=set(bpy.context.scene.objects)
    cube('DeskLidCore',(0,0,.70),(width+.08,length+.08,.18),timber,.075)
    cube('LidInteriorInset',(0,0,.595),(width-.55,length-.55,.035),inner,.055)
    for sx in [-1,1]:
        line('UndersideTooling',[(sx*(width/2-.4),-length/2+.4,.567),(sx*(width/2-.4),length/2-.4,.567)],.012,gold)
    for sy in [-1,1]:
        line('UndersideTooling',[(-width/2+.4,sy*(length/2-.4),.567),(width/2-.4,sy*(length/2-.4),.567)],.012,gold)
    bpy.ops.mesh.primitive_plane_add(size=1,location=(0,0,.798));top=finish(bpy.context.object,'OuterMatFace',outside);top.scale=(width-.1,length-.1,1)
    if portrait:
        crop=(width/length)/1.5
        for uv in top.data.uv_layers.active.data:uv.uv.x=.5+(uv.uv.x-.5)*crop
    lid=parent(set(bpy.context.scene.objects)-before,'DeskLidHinge',(0,length/2,.69))
    for x in [-width*.35,width*.35]:
        hinge=disc('DeskHingeBarrel',(x,length/2,.65),.09,.52,bronze);hinge.rotation_euler.y=math.pi/2
        for dx in [-.2,0,.2]:
            collar=torus('HingeCollar',(x+dx,length/2,.65),.094,.012,gold);collar.rotation_euler.y=math.pi/2
    # Front escutcheon, revolving barrel and bolt actually withdrawing from the catch.
    plate=disc('LockEscutcheon',(0,-length/2-.015,.34),.30,.065,bronze);plate.rotation_euler.x=math.pi/2
    ring=torus('LockRim',(0,-length/2-.055,.34),.25,.022,gold);ring.rotation_euler.x=math.pi/2
    before=set(bpy.context.scene.objects)
    barrel=disc('LockBarrel',(0,-length/2-.06,.34),.12,.03,ink);barrel.rotation_euler.x=math.pi/2
    cube('KeySlot',(0,-length/2-.082,.34),(.045,.015,.15),gold,.008)
    lock=parent(set(bpy.context.scene.objects)-before,'DeskLockTurn',(0,-length/2-.06,.34))
    cube('LockBolt',(.23,-length/2+.06,.61),(.65,.12,.09),gold,.016)
    # Import the existing original key geometry, now part of the physical mechanism.
    before=set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(OUT/'desk-key-v1.glb'))
    imported=set(bpy.context.scene.objects)-before
    keyturn=parent(imported,'DeskKeyTurn',(0,0,.10));keyturn.rotation_euler.z=math.pi/2;keyturn.scale=(.62,.62,.62)
    travel=parent([keyturn],'DeskKeyTravel',(0,0,0));travel.location=(0,-length/2-.56,.24)
    # Reference animation: key inserts, turns, releases bolt, then hinge lifts.
    for f,xpos in [(1,width*.34),(16,0),(26,0),(42,0),(76,0),(77,width*.34),(122,width*.34)]:
        travel.location.x=xpos;travel.keyframe_insert(data_path='location',index=0,frame=f)
    for f,ypos in [(1,-length/2+1.0),(16,-length/2-.40),(26,-length/2-.40),(76,-length/2-.40),(77,-length/2+1.0),(122,-length/2+1.0)]:
        travel.location.y=ypos;travel.keyframe_insert(data_path='location',index=1,frame=f)
    for f,zpos in [(1,.75),(16,.50),(26,.24),(76,.24),(77,.75),(122,.75)]:
        travel.location.z=zpos;travel.keyframe_insert(data_path='location',index=2,frame=f)
    for f,angle in [(1,0),(26,0),(42,math.pi/2),(76,math.pi/2),(77,0),(122,0)]:
        keyturn.rotation_euler.x=angle;keyturn.keyframe_insert(data_path='rotation_euler',index=0,frame=f)
        lock.rotation_euler.y=angle;lock.keyframe_insert(data_path='rotation_euler',index=1,frame=f)
    for f,angle in [(1,0),(16,math.pi/2),(76,math.pi/2),(77,0),(122,0)]:
        keyturn.rotation_euler.z=angle;keyturn.keyframe_insert(data_path='rotation_euler',index=2,frame=f)
    bolt=bpy.data.objects['LockBolt']
    for f,offset in [(1,0),(35,0),(44,.52),(76,.52),(77,0),(122,0)]:
        bolt.location.x=.23+offset;bolt.keyframe_insert(data_path='location',index=0,frame=f)
    for f,angle in [(1,0),(42,0),(76,-math.radians(105)),(77,0),(122,0)]:
        lid.rotation_euler.x=angle;lid.keyframe_insert(data_path='rotation_euler',index=0,frame=f)
    scene=bpy.context.scene;scene.frame_start=1;scene.frame_end=122;scene.render.fps=30;scene['desk_sequence_frames']=[1,76];scene['drawer_sequence_frames']=[77,122];scene.frame_set(1)
    scene.frame_set(76);bpy.context.view_layer.update()
    assert abs(travel.location.x)<.001,'The key must reach the central lock'
    assert abs(keyturn.rotation_euler.x-math.pi/2)<.001,'The key must visibly turn'
    assert abs(lid.rotation_euler.x+math.radians(105))<.001,'The desktop must hinge fully open'
    scene.frame_set(122);bpy.context.view_layer.update()
    assert abs(lid.rotation_euler.x)<.001,'Lighting drawer must not open the desktop'
    assert abs(drawer.location.y-(drawer_center_y-drawer_length*.82))<.001,'Drawer must extend along its runners'
    scene.frame_set(1)
    name='arcane-desk-portrait-v1' if portrait else 'arcane-desk-wide-v1'
    bpy.ops.object.select_all(action='DESELECT')
    for o in scene.objects:
        if o.type in {'MESH','CURVE','EMPTY'}:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{name}.glb'),use_selection=True,export_format='GLB',export_apply=True,export_animations=False)
    scene.render.engine='CYCLES';scene.cycles.samples=48;scene.render.film_transparent=True
    scene.render.resolution_x=640 if portrait else 1200;scene.render.resolution_y=1120 if portrait else 800;scene.render.resolution_percentage=100
    for loc,power,size,color in [((-6,-5,12),1300,7,(1,.75,.45)),((5,4,11),1000,7,(.43,.62,1))]:
        bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.size=size;light.data.color=color;light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=(0,-6.5,18) if portrait else (0,-12,12));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.sensor_fit='HORIZONTAL';cam.data.ortho_scale=8.8 if portrait else 12;scene.camera=cam
    for f,p in [(1,0),(12,.15),(31,.4),(57,.75),(76,1)]:
        def smooth(a,b,v):
            t=max(0,min(1,(v-a)/(b-a)));return t*t*(3-2*t)
        approach=smooth(.15,.94,p);focus=smooth(0,.15,p)*(1-smooth(.4,.75,p))
        cam.location.x=.25*(1-approach);cam.rotation_euler=(Vector((0,-.35*approach-(2 if portrait else 1.2)*focus,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=(8.8 if portrait else 12)/(.96+.055*approach+.14*focus)
        cam.keyframe_insert(data_path='location',frame=f);cam.keyframe_insert(data_path='rotation_euler',frame=f);cam.data.keyframe_insert(data_path='ortho_scale',frame=f)
    for f,p in [(77,0),(122,1)]:
        target=Vector((0 if portrait else -.15,-length/2-drawer_length*.32,-.65))
        final=Vector((0 if portrait else -.15,-length/2-drawer_length*.32-(5 if portrait else 7),14 if portrait else 10))
        start=Vector((0,-6.5,18) if portrait else (0,-12,12));cam.location=start.lerp(final,p)
        cam.rotation_euler=(Vector((0,0,0)).lerp(target,p)-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=(8.8 if portrait else 12)*(1-p)+(6.8 if portrait else 8.3)*p
        cam.keyframe_insert(data_path='location',frame=f);cam.keyframe_insert(data_path='rotation_euler',frame=f);cam.data.keyframe_insert(data_path='ortho_scale',frame=f)
    scene.frame_set(1);bpy.ops.wm.save_as_mainfile(filepath=str(SCENES/f'{name}.blend'))
    scene.frame_set(76);scene.render.image_settings.file_format='WEBP';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.quality=95;scene.render.filepath=str(OUT/f'{name}-open.webp');bpy.ops.render.render(write_still=True)
    scene.frame_set(122);scene.render.filepath=str(OUT/f'{name}-drawer.webp');bpy.ops.render.render(write_still=True)

# Exclusive lighting reset and drawer-close props; no shared desk key or wax seal.
reset()
silver=mat('Tuning fork patinated silver',(.40,.44,.42),.86,.30)
line('TuningFork',[(-.20,.65,.08),(-.20,-.02,.08),(.20,-.02,.08),(.20,.65,.08)],.036,silver)
line('ForkHandle',[(0,-.04,.08),(0,-.62,.08)],.05,bronze)
disc('ForkPommel',(0,-.64,.08),.085,.045,gold)
export('lighting-tuning-fork-v1',(0,0,.08),1.9)
reset()
o=torus('DrawerPull',(0,0,.12),.34,.055,gold)
for x in [-.32,.32]:disc('PullMount',(x,.16,.05),.11,.055,bronze)
export('drawer-pull-v1',(0,0,.1),1.3)
from desk_layout import emit_layouts
emit_layouts()
