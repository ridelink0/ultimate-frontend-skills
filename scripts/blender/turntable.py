"""Render an object to a frame sequence a canvas can scrub.

    blender -b -P scripts/blender/turntable.py -- --out D:/tmp/seq --count 90
    blender -b scene.blend -P scripts/blender/turntable.py -- --out D:/tmp/seq --count 120 --res 1200

This is route four of the five in `references/blender.md`, and the reference is
blunt about it: **a rendered sequence is a last resort, not a shortcut.** It
cannot respond to the pointer, it is the heaviest thing on the page by an order
of magnitude, and every frame cut to save weight shows as a stutter. Use it when
the material genuinely cannot be done in real time - subsurface scattering, real
caustics, a render that takes minutes a frame - and not because 3D sounded hard.

Weight, so the decision is made with numbers rather than a feeling:
90 frames at 1200px wide in WebP is usually 3-6 MB. The same watch as real-time
geometry is well under one. Measure yours; do not trust that range.

The camera orbits; the object never moves. A turntable that rotates the object
swings its shadow and its reflections around with it, and the result reads as a
prop on a lazy susan rather than a camera move.
"""

import bpy
import math
import os
import sys

def argv_after_double_dash():
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]


def arg(name, default=None):
    args = argv_after_double_dash()
    flag = "--" + name
    if flag in args:
        i = args.index(flag)
        if i + 1 < len(args) and not args[i + 1].startswith("--"):
            return args[i + 1]
        return True
    return default


def scene_bounds():
    """Where the object is and how big, so the camera frames it rather than
    being placed at a number somebody guessed once."""
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        return (0.0, 0.0, 0.0), 1.0
    xs, ys, zs = [], [], []
    for obj in meshes:
        for corner in obj.bound_box:
            world = obj.matrix_world @ __import__("mathutils").Vector(corner)
            xs.append(world.x)
            ys.append(world.y)
            zs.append(world.z)
    centre = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
    radius = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)) / 2 or 1.0
    return centre, radius


def build_rig(centre, radius, elevation_deg=22.0):
    """An empty at the object's centre, a camera parented to it. Rotating the
    empty orbits the camera and leaves every light and shadow where it was."""
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=centre)
    pivot = bpy.context.active_object
    pivot.name = "turntable-pivot"

    distance = radius * 4.2
    bpy.ops.object.camera_add(location=(0, -distance, distance * math.tan(math.radians(elevation_deg))))
    camera = bpy.context.active_object
    camera.name = "turntable-camera"
    camera.data.lens = 85  # a long lens flatters a product; 35 mm distorts it
    camera.parent = pivot

    track = camera.constraints.new(type="TRACK_TO")
    track.target = pivot
    track.track_axis = "TRACK_NEGATIVE_Z"
    track.up_axis = "UP_Y"

    bpy.context.scene.camera = camera
    return pivot


def build_light(centre, radius):
    """A key and a fill. Metal reads as metal because of what it reflects, so an
    area light large enough to be a real reflection matters more than its power."""
    bpy.ops.object.light_add(type="AREA", location=(centre[0] - radius * 3,
                                                   centre[1] - radius * 3,
                                                   centre[2] + radius * 4))
    key = bpy.context.active_object
    key.data.energy = 400
    key.data.size = radius * 6
    key.name = "key"

    bpy.ops.object.light_add(type="AREA", location=(centre[0] + radius * 4,
                                                   centre[1] - radius * 1.5,
                                                   centre[2] + radius * 1.5))
    fill = bpy.context.active_object
    fill.data.energy = 120
    fill.data.size = radius * 8
    fill.name = "fill"


def main():
    out = arg("out")
    if not out:
        print("turntable.py needs --out <dir>")
        sys.exit(2)
    out = os.path.abspath(out)
    os.makedirs(out, exist_ok=True)

    count = int(arg("count", 90))
    res = int(arg("res", 1200))
    engine = str(arg("engine", "EEVEE")).upper()

    scene = bpy.context.scene
    meshes = [o for o in scene.objects if o.type == "MESH"]
    if not meshes or all(o.name.startswith("Cube") for o in meshes):
        print("no scene given; building the watch from part-library.py")
        import importlib.util
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "part-library.py")
        spec = importlib.util.spec_from_file_location("part_library", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.build()

    centre, radius = scene_bounds()
    pivot = build_rig(centre, radius)
    build_light(centre, radius)

    # EEVEE Next is the 4.2+ name and the old identifier is gone, so try the
    # current one and fall back rather than asserting a version.
    if engine.startswith("CYCLES"):
        scene.render.engine = "CYCLES"
        scene.cycles.samples = int(arg("samples", 128))
        scene.cycles.use_denoising = True
    else:
        for identifier in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
            try:
                scene.render.engine = identifier
                break
            except TypeError:
                continue
    print("engine: %s" % scene.render.engine)

    scene.render.resolution_x = res
    scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    # Transparent film, so the sequence composites onto whatever ground the page
    # has rather than carrying a grey square around with it.
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.quality = 88

    total_bytes = 0
    for i in range(count):
        pivot.rotation_euler = (0, 0, (i / float(count)) * math.tau)
        scene.render.filepath = os.path.join(out, "frame-%04d" % i)
        bpy.ops.render.render(write_still=True)
        written = scene.render.filepath + ".webp"
        if os.path.exists(written):
            total_bytes += os.path.getsize(written)
        if i % 10 == 0:
            print("  frame %d/%d" % (i + 1, count))

    mb = total_bytes / 1024.0 / 1024.0
    print("wrote %d frames to %s (%.2f MB total, %.0f KB per frame)"
          % (count, out, mb, total_bytes / 1024.0 / max(1, count)))
    if mb > 6:
        print("WARNING: %.2f MB is a lot to put in front of a visitor for one object." % mb)
        print("         Reconsider real-time geometry, or drop the resolution before the count -")
        print("         a smaller sharp sequence beats a larger one that stutters.")


if __name__ == "__main__":
    main()
