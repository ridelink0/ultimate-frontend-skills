"""Procedural parts for a made thing, authored in Blender and named for the web.

    blender -b -P scripts/blender/part-library.py -- --out D:/tmp/watch.glb

The object here is a dive watch, because it is the hardest common case: a ring
with knurling, a domed crystal, a dial with applied indices, hands, a movement
plate and a bracelet. Everything else this plugin builds is a subset of it.

Read `references/blender.md` before using this. The short version of that file:
**most pages should not use Blender at all.** `assets/exploded.js` builds a watch
from an <ol> in the markup with no asset to download and no pipeline to run, and
for the majority of briefs that is the better answer. This exists for the case
primitives genuinely cannot carry - knurling on a bezel edge, a guilloche dial,
a movement bridge - where the geometry itself is the point.

THE ONE RULE THAT MATTERS: every object is NAMED, in lowercase-hyphen form, and
those names survive into the GLB. A web runtime addresses parts by name. A mesh
called `Cube.003` is not addressable, and renaming after export is not possible
without re-exporting, so it is done here.
"""

import bpy
import bmesh
import math
import sys
import os

# ---------------------------------------------------------------- arguments --

def argv_after_double_dash():
    """Blender swallows its own arguments; everything after `--` is ours."""
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


# ------------------------------------------------------------------- scene --

def clear_scene():
    """A -b run still opens the startup file, cube and all."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.curves):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


# --------------------------------------------------------------- materials --

# Principled BSDF socket names changed in Blender 4.0 and the old names are
# what every tutorial still uses. These are the 4.x names; if a socket is
# missing the helper says so rather than failing silently, because a material
# that quietly did not apply looks like a lighting problem later.
def principled(name, base, metallic, roughness, anisotropic=0.0,
               transmission=0.0, ior=1.45, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        raise RuntimeError("no Principled BSDF in a new node material - Blender version changed")

    def put(socket, value):
        if socket in bsdf.inputs:
            bsdf.inputs[socket].default_value = value
        else:
            print("  note: no socket %r on Principled BSDF (Blender %s)"
                  % (socket, bpy.app.version_string))

    put("Base Color", (*base, 1.0))
    put("Metallic", metallic)
    put("Roughness", roughness)
    if anisotropic:
        put("Anisotropic", anisotropic)
    if transmission:
        # 4.x nests transmission; the flat name is 3.x and silently does nothing.
        put("Transmission Weight", transmission)
        put("IOR", ior)
    if emission is not None:
        put("Emission Color", (*emission, 1.0))
        put("Emission Strength", emission_strength)
    return mat


def build_materials():
    return {
        # Brushed steel is anisotropic: the highlight stretches along the grain.
        # This is the difference between "metal" and "a grey plastic ball", and
        # it is one socket.
        "brushed": principled("steel-brushed", (0.56, 0.57, 0.58), 1.0, 0.34, anisotropic=0.85),
        "polished": principled("steel-polished", (0.56, 0.57, 0.58), 1.0, 0.08),
        "lacquer": principled("dial-lacquer", (0.02, 0.02, 0.025), 0.0, 0.18),
        "crystal": principled("crystal-sapphire", (1.0, 1.0, 1.0), 0.0, 0.02,
                              transmission=1.0, ior=1.77),
        "lume": principled("lume", (0.72, 0.85, 0.78), 0.0, 0.55,
                           emission=(0.55, 0.95, 0.80), emission_strength=2.2),
        "gold": principled("hands-gold", (0.83, 0.66, 0.32), 1.0, 0.16),
    }


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def named(obj, name):
    obj.name = name
    obj.data.name = name + "-mesh"
    return obj


def shade_smooth(obj, angle_deg=30.0):
    """Auto-smooth moved to a modifier in 4.1; the old mesh flag is gone."""
    for poly in obj.data.polygons:
        poly.use_smooth = True
    try:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    except AttributeError:
        # Older builds: the flag above is the whole story.
        pass


# ------------------------------------------------------------------- parts --

MM = 0.001  # model in metres, at real size. A 41 mm watch is 0.041 m across.


def case(mats):
    """The middle case: a cylinder with a chamfered top edge."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=20.5 * MM, depth=9 * MM,
                                        location=(0, 0, 0))
    obj = named(bpy.context.active_object, "case")
    bpy.ops.object.modifier_add(type="BEVEL")
    mod = obj.modifiers[-1]
    mod.width = 0.6 * MM
    mod.segments = 3
    mod.limit_method = "ANGLE"
    assign(obj, mats["brushed"])
    shade_smooth(obj)
    return obj


def bezel(mats, teeth=120):
    """A rotating bezel with real knurling.

    This is the part that justifies Blender. The knurl is cut, not faked with a
    normal map: a cylinder, then an array of thin boxes rotated around it and
    subtracted. At a 41 mm watch on a 1440 px page the teeth are two or three
    pixels each, which is exactly where a normal map stops being convincing and
    real geometry still reads.
    """
    bpy.ops.mesh.primitive_cylinder_add(vertices=teeth * 2, radius=21.5 * MM,
                                        depth=3.2 * MM, location=(0, 0, 6 * MM))
    ring = named(bpy.context.active_object, "bezel")

    # The bore, so the bezel is a ring rather than a disc.
    bpy.ops.mesh.primitive_cylinder_add(vertices=teeth * 2, radius=18.2 * MM,
                                        depth=6 * MM, location=(0, 0, 6 * MM))
    bore = bpy.context.active_object
    boolean(ring, bore, "DIFFERENCE")

    # The knurl. One cutter, arrayed around the axis by an empty.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(21.9 * MM, 0, 6 * MM))
    cutter = bpy.context.active_object
    cutter.scale = (0.9 * MM, 0.55 * MM, 3.6 * MM)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    pivot = bpy.context.active_object
    pivot.name = "bezel-knurl-pivot"

    bpy.context.view_layer.objects.active = cutter
    bpy.ops.object.modifier_add(type="ARRAY")
    array = cutter.modifiers[-1]
    array.count = teeth
    array.use_relative_offset = False
    array.use_object_offset = True
    array.offset_object = pivot
    pivot.rotation_euler = (0, 0, math.radians(360.0 / teeth))

    bpy.ops.object.modifier_apply(modifier=array.name)
    boolean(ring, cutter, "DIFFERENCE")
    bpy.data.objects.remove(pivot, do_unlink=True)

    assign(ring, mats["brushed"])
    shade_smooth(ring, 25)
    return ring


def boolean(target, cutter, operation):
    """Apply a boolean and remove the cutter. EXACT solver, because FAST leaves
    holes on coincident faces and the hole only shows up after export."""
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_add(type="BOOLEAN")
    mod = target.modifiers[-1]
    mod.operation = operation
    mod.object = cutter
    mod.solver = "EXACT"
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(cutter, do_unlink=True)


def crystal(mats):
    """A domed sapphire. Thickness is not optional: a zero-thickness surface has
    no refraction to compute, and the depth in the glass is the whole point."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48,
                                         radius=18.2 * MM, location=(0, 0, 7.2 * MM))
    obj = named(bpy.context.active_object, "crystal")
    # Flatten into a shallow dome and cut everything below the seat.
    obj.scale = (1.0, 1.0, 0.22)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.mesh.primitive_cube_add(size=0.1, location=(0, 0, 7.2 * MM - 0.05))
    boolean(obj, bpy.context.active_object, "DIFFERENCE")
    bpy.ops.object.modifier_add(type="SOLIDIFY")
    obj.modifiers[-1].thickness = 1.1 * MM
    bpy.ops.object.modifier_apply(modifier=obj.modifiers[-1].name)
    assign(obj, mats["crystal"])
    shade_smooth(obj)
    return obj


def dial(mats):
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=18 * MM, depth=0.8 * MM,
                                        location=(0, 0, 3.2 * MM))
    obj = named(bpy.context.active_object, "dial")
    assign(obj, mats["lacquer"])
    return obj


def indices(mats, count=12):
    """Applied indices, joined into ONE object called `indices`.

    Twelve separate objects would be twelve draw calls and twelve names for a
    web runtime to guess at. One named object is what the runtime wants, and
    `data-repeat` in exploded.js already covers the case where you want them
    treated as a set.
    """
    made = []
    for i in range(count):
        angle = math.radians(i * (360.0 / count))
        r = 15.4 * MM
        wide = i % 3 == 0
        bpy.ops.mesh.primitive_cube_add(size=1, location=(math.sin(angle) * r,
                                                          math.cos(angle) * r,
                                                          3.9 * MM))
        marker = bpy.context.active_object
        marker.scale = ((1.6 if wide else 0.9) * MM, 2.6 * MM, 0.55 * MM)
        marker.rotation_euler = (0, 0, -angle)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        made.append(marker)

    bpy.ops.object.select_all(action="DESELECT")
    for m in made:
        m.select_set(True)
    bpy.context.view_layer.objects.active = made[0]
    bpy.ops.object.join()
    obj = named(bpy.context.active_object, "indices")
    assign(obj, mats["lume"])
    return obj


def hands(mats):
    made = []
    for name, length, width, z in (("hour", 10.5 * MM, 1.5 * MM, 4.6 * MM),
                                   ("minute", 15.5 * MM, 1.1 * MM, 5.0 * MM),
                                   ("second", 16.5 * MM, 0.35 * MM, 5.3 * MM)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, length / 2, z))
        hand = bpy.context.active_object
        hand.scale = (width, length, 0.35 * MM)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        made.append(hand)
    # A watch is photographed at ten past ten. It is not a detail nobody notices;
    # it is the only hand position that does not cover the logo.
    made[0].rotation_euler = (0, 0, math.radians(-60))
    made[1].rotation_euler = (0, 0, math.radians(60))
    made[2].rotation_euler = (0, 0, math.radians(180))

    bpy.ops.object.select_all(action="DESELECT")
    for m in made:
        m.select_set(True)
    bpy.context.view_layer.objects.active = made[0]
    bpy.ops.object.join()
    obj = named(bpy.context.active_object, "hands")
    assign(obj, mats["gold"])
    return obj


def movement(mats):
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=15 * MM, depth=4 * MM,
                                        location=(0, 0, -2 * MM))
    obj = named(bpy.context.active_object, "movement")
    assign(obj, mats["polished"])
    shade_smooth(obj)
    return obj


def rotor(mats):
    """The winding rotor: a half-disc, which is what makes it read as a rotor
    rather than another washer."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=14 * MM, depth=1.2 * MM,
                                        location=(0, 0, -4.2 * MM))
    obj = named(bpy.context.active_object, "rotor")
    bpy.ops.mesh.primitive_cube_add(size=0.06, location=(0, -0.03, -4.2 * MM))
    boolean(obj, bpy.context.active_object, "DIFFERENCE")
    assign(obj, mats["brushed"])
    shade_smooth(obj)
    return obj


def caseback(mats):
    bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=19 * MM, depth=1.4 * MM,
                                        location=(0, 0, -5.4 * MM))
    obj = named(bpy.context.active_object, "caseback")
    assign(obj, mats["brushed"])
    shade_smooth(obj)
    return obj


def bracelet(mats, links=14):
    """A chain of links, joined into one object, curving away from the case so it
    reads as a bracelet rather than a stack of boxes."""
    made = []
    for side in (1, -1):
        for i in range(links):
            t = i / float(links - 1)
            drop = -(t ** 2) * 14 * MM
            bpy.ops.mesh.primitive_cube_add(
                size=1, location=(0, side * (22 * MM + i * 4.6 * MM), drop))
            link = bpy.context.active_object
            link.scale = (17 * MM - t * 4 * MM, 4.0 * MM, 1.5 * MM)
            link.rotation_euler = (side * -t * 0.55, 0, 0)
            bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
            made.append(link)

    bpy.ops.object.select_all(action="DESELECT")
    for m in made:
        m.select_set(True)
    bpy.context.view_layer.objects.active = made[0]
    bpy.ops.object.join()
    obj = named(bpy.context.active_object, "bracelet")
    assign(obj, mats["brushed"])
    return obj


# -------------------------------------------------------------------- main --

def build():
    clear_scene()
    mats = build_materials()
    parts = [
        case(mats), bezel(mats), crystal(mats), dial(mats), indices(mats),
        hands(mats), movement(mats), rotor(mats), caseback(mats), bracelet(mats),
    ]
    print("built %d named parts: %s" % (len(parts), ", ".join(p.name for p in parts)))
    return parts


def export_glb(out, draco=True):
    """Write the scene as a GLB with the part names intact.

    +Y up is not optional. Blender is Z-up and three.js is Y-up, and the
    exporter's default conversion is the only thing standing between a watch and
    a watch lying on its back. `export_yup=True` is the default, and it is named
    here so nobody helpfully removes it.
    """
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    kwargs = dict(
        filepath=out,
        export_format="GLB",
        export_yup=True,
        export_apply=True,          # bake modifiers; three.js cannot read them
        export_materials="EXPORT",
        use_selection=False,
    )
    if draco:
        # Draco roughly halves a mesh like this, but three.js then needs
        # DRACOLoader wired up. references/blender.md says when that trade is
        # worth making; it usually is not for a single hero object.
        kwargs.update(export_draco_mesh_compression_enable=True,
                      export_draco_mesh_compression_level=6)
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError as err:
        # The exporter's argument list moves between versions. Rather than
        # guess, drop the optional arguments and say which one was refused.
        print("  note: exporter refused an argument (%s); retrying without the optional set" % err)
        bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_yup=True,
                                  export_apply=True)
    size = os.path.getsize(out) if os.path.exists(out) else 0
    print("wrote %s (%d bytes)" % (out, size))
    if size == 0:
        raise RuntimeError("the exporter reported success but wrote nothing")
    return out


def main():
    parts = build()
    out = arg("out")
    if out:
        export_glb(out, draco=arg("no-draco") is None)
    else:
        print("no --out given; parts are in the scene and nothing was written")


if __name__ == "__main__":
    main()
