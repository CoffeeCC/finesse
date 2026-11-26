"""Build the original walnut and bronze hand pager with a horizontal roller."""

import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from blender_prop_tools import OUT, SCENES, Vector, bpy, bronze, cube, disc, export, gold, ink, line, mat, parent, reset, sphere, wood

reset()
ivory = mat('Ivory direction inlay', (.66, .54, .31), .12, .48)
lapis = mat('Lapis end stones', (.014, .09, .19), .28, .27)
cube('WalnutShoe', (0, 0, .095), (2.75, 1.04, .18), wood, .09)
cube('BronzeSeat', (0, 0, .18), (2.64, .96, .06), bronze, .08)
cube('RecessedEnamel', (0, 0, .219), (2.54, .86, .045), ink, .065)

for side in [-1, 1]:
    x = side * .92
    cube('ThumbPad', (x, 0, .26), (.68, .68, .08), ink, .09)
    line('DirectionalInlay', [(x - side * .12, -.12, .309), (x + side * .09, 0, .309),
                              (x - side * .12, .12, .309)], .025, ivory)
    for y in [-.36, .36]:
        sphere('LapisPin', (side * 1.18, y, .245), (.045, .045, .031), lapis, 16, 8)
    cube('AxleBearing', (side * .5, 0, .32), (.09, .53, .23), bronze, .045)

axle_z = .405
roller = disc('DarkRoller', (0, 0, axle_z), .269, .88, wood)
roller.rotation_euler.y = math.pi / 2
roller_parts = [roller]
for x in [-.41, .41]:
    rim = disc('RollerRim', (x, 0, axle_z), .277, .042, bronze)
    rim.rotation_euler.y = math.pi / 2
    roller_parts.append(rim)
for index in range(20):
    angle = index * math.tau / 20
    y = .274 * math.cos(angle)
    z = axle_z + .274 * math.sin(angle)
    roller_parts.append(line(f'GripRib{index}', [(-.36, y, z), (.36, y, z)], .012, gold))

roller_parts.append(line('LapisIndex', [(-.36, 0, axle_z + .277), (.36, 0, axle_z + .277)], .022, lapis))

pivot = parent(roller_parts, 'HandThumbwheelPivot', (0, 0, axle_z))
pivot.keyframe_insert('rotation_euler', frame=1)
pivot.rotation_euler.x = math.tau / 5
pivot.keyframe_insert('rotation_euler', frame=16)
bpy.context.scene.frame_set(1)
export('hand-thumbwheel-v1', (0, 0, .29), 3.05)

scene = bpy.context.scene
scene.render.resolution_y = 225
scene.camera.location.x = 0
scene.camera.rotation_euler = (Vector((0, 0, .29)) - scene.camera.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera.data.ortho_scale = 3.18
scene.render.filepath = str(OUT / 'hand-thumbwheel-v1-still.webp')
bpy.ops.wm.save_as_mainfile(filepath=str(SCENES / 'hand-thumbwheel-v1.blend'))
bpy.ops.render.render(write_still=True)
