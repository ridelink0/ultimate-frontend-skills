"""Export a scene to a web-ready GLB with its part names intact.

    blender -b -P scripts/blender/export-glb.py -- --out D:/tmp/watch.glb
    blender -b scene.blend -P scripts/blender/export-glb.py -- --out D:/tmp/thing.glb

With no .blend given it builds the watch from `part-library.py` first, so the
two files together are a complete example: geometry in, GLB out, nothing else
installed.

What this is for: `assets/exploded.js` takes `data-model="thing.glb"` and pulls
the named parts apart. It finds them BY NAME, so the export has to preserve the
names, and that is most of what this file is about.

Before using it, read `references/blender.md`. The decision table at the top of
that file exists because the honest answer for most pages is not to load a GLB
at all - `exploded.js` builds a watch from an <ol> in the markup with nothing to
download.
"""

import bpy
import os
import sys
import importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))


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


def load_part_library():
    """part-library.py has a hyphen in its name, so it cannot be imported the
    ordinary way. Load it by path rather than renaming a file the reference
    documents by name."""
    path = os.path.join(HERE, "part-library.py")
    spec = importlib.util.spec_from_file_location("part_library", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def report_parts():
    """Print what a web runtime will actually see. A mesh called `Cube.003` is
    not addressable, so this is the check that matters and it runs every time."""
    unnamed = []
    print("parts in the export:")
    for obj in sorted(mesh_objects(), key=lambda o: o.name):
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        print("  %-14s %6d tris  %d material(s)" % (obj.name, tris, len(obj.data.materials)))
        if obj.name.startswith(("Cube", "Sphere", "Cylinder", "Plane", "Circle", "Torus")):
            unnamed.append(obj.name)
    if unnamed:
        print("WARNING: %d object(s) still carry a primitive's default name: %s"
              % (len(unnamed), ", ".join(unnamed)))
        print("         A web runtime addresses parts by name; rename them before shipping.")
    total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in mesh_objects())
    print("total %d triangles across %d objects" % (total, len(mesh_objects())))
    return total


def main():
    out = arg("out")
    if not out:
        print("export-glb.py needs --out <file.glb>")
        sys.exit(2)

    # No .blend on the command line means an empty startup scene, which is the
    # cue to build the example rather than export a default cube.
    if not mesh_objects() or all(o.name.startswith("Cube") for o in mesh_objects()):
        print("no scene given; building the watch from part-library.py")
        lib = load_part_library()
        lib.build()
        export = lib.export_glb
    else:
        lib = load_part_library()
        export = lib.export_glb

    tris = report_parts()
    # A hero object on a scroll page has a budget. This is a warning, not a
    # refusal: the number that matters is what it costs on the page, and
    # `webdesign.mjs quality --record` measures that for real.
    if tris > 150000:
        print("WARNING: %d triangles is heavy for a single web hero object." % tris)
        print("         Decimate, or accept the download and measure it with")
        print("         `webdesign.mjs quality <dir> --record 4000`.")

    export(out, draco=arg("no-draco") is None)


if __name__ == "__main__":
    main()
