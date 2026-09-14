# Blender, headless

Everything here was run on Windows 11 against **Blender 4.5.13 LTS** (build date
2026-08-25) and the numbers are measured, not estimated. Where something was not
run it says UNVERIFIED.

## First: should this be Blender at all

Almost always not. Read this table before anything else in the file.

| The geometry is | Route | Weight on the page | Reach for |
|---|---|---|---|
| A ring, a disc, a dome, hands, a chain of links | **Procedural, in the markup** | nothing to download | `assets/exploded.js` and an `<ol>` |
| The same, but you need a shader or a camera move three.js can do | **Authored in three.js** | the library, already there | `references/three.md` |
| Real manufactured detail primitives cannot carry - knurling, guilloche, a movement bridge, a moulded grip | **Modelled in Blender to GLB** | 60-500 KB plus a decoder | this file |
| A material that cannot be done in real time - subsurface, caustics, minutes a frame | **Rendered to a frame sequence** | megabytes | this file, last section |
| A heavy shader you want as a cheap texture | **Baked to maps** | a few hundred KB of image | this file, baking |

The second row is where most briefs land. `exploded.js` builds a watch - bezel,
crystal, dial, twelve markers, hands, movement, case, bracelet - from a list in
the HTML, with no asset to download, no decoder to wire up and a semantic list
as the no-JS fallback. **A page that could have used it and loaded a GLB instead
is slower, more fragile and no better looking.**

The honest test for reaching past it: name the feature of the geometry that a
ring, a disc, a dome, a box, a torus, a cone and a sphere cannot express. If you
cannot name one in a sentence, stay in the markup.

## Getting Blender

It is not installed on most machines and this plugin will not install it.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" blender probe
```

Exit 3 and a list of where it looked means there is no Blender here. **Do not
stop the build to tell the user to install it** - go back to stage 3 in
`references/pipeline.md` and take the procedural route, which is the better
answer anyway.

The portable build needs no installer and no administrator, which matters when
the system drive is full: download `blender-<version>-windows-x64.zip` from
`https://download.blender.org/release/Blender<major.minor>/`, unzip it anywhere,
and point at it.

```bash
export BLENDER="D:\\blender\\blender-4.5.13-windows-x64\\blender.exe"   # or --exe
```

`probe` searches `$BLENDER`, then `PATH`, then the standard install locations.
A leftover `C:\Program Files\Blender Foundation\Blender 4.3\` directory with no
`blender.exe` in it is common after an uninstall and is not an installation -
probe reports absence correctly and you should believe it.

## The commands

```bash
blender probe [--json] [--exe <path>]
blender run <script.py> [--blend <file>] [-- args...]
blender glb <script.py> --out <file.glb> [--no-draco] [-- args...]
blender bake <blend> --out <dir> [--res 1024] [--samples 64]
blender frames <blend> --out <dir> --count N [--res 900] [--format WEBP]
```

Every one runs `-b --factory-startup -noaudio --python-exit-code 1`.
`--factory-startup` is the important flag: without it the user's own add-ons,
units and colour management load, and a script that works on your machine
silently produces something different on theirs.

Arguments after a bare `--` reach the script, because Blender consumes
everything before it. Every template here parses them the same way:

```python
def argv_after_double_dash():
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1:]
```

### Measured, end to end

```
blender glb scripts/blender/part-library.py --out D:/tmp/watch.glb

  D:/tmp/watch.glb
  65804 bytes (64.3 KB)  glTF 2  55.4 KB of buffer
  generator   Khronos glTF Blender I/O v4.5.51
  nodes       case, bezel, crystal, dial, indices, hands, movement, rotor, caseback, bracelet
  materials   steel-brushed, crystal-sapphire, dial-lacquer, lume, hands-gold, steel-polished
  extensions  KHR_draco_mesh_compression, KHR_materials_transmission,
              KHR_materials_emissive_strength, KHR_materials_anisotropy, KHR_materials_ior
```

13,756 triangles across ten objects. With `--no-draco` the same file is
**479,224 bytes**, so Draco is a **7.3x** saving here.

One number worth staring at: **the crystal is 9,212 of those 13,756
triangles** - 67 per cent of the model, for a piece of glass. It is a lathe at
96 segments with a solidify on top. Decimating it, or dropping the lathe to 48
segments, is worth more than every other optimisation in the file put together.
Measure before you optimise; the expensive part is rarely the one that looks
complicated.

## The rule that matters more than any of this: name the parts

A web runtime addresses parts by name. `exploded.js` takes
`data-model="watch.glb"` and each `<li data-part="Bezel">` names a mesh inside
it. A mesh called `Cube.003` is not addressable, and the name is baked at export
time, so it has to be right in Blender.

```python
def named(obj, name):
    obj.name = name
    obj.data.name = name + "-mesh"
    return obj
```

`export-glb.py` prints every object with its triangle count and **warns on any
object still carrying a primitive's default name**. Read that output; it is the
check that stops a model being useless on arrival.

Join sets into one named object rather than exporting twelve. Twelve hour
markers are twelve draw calls and twelve names for a runtime to guess at; one
object called `indices` is what it wants, and `data-repeat` already covers the
case where you want them treated as a set.

## Materials, in 4.x

The Principled BSDF sockets were renamed in 4.0 and every tutorial still uses
the old names. These are verified against a running 4.5.13:

| What you want | Socket |
|---|---|
| Albedo | `Base Color` |
| Metal | `Metallic` |
| Roughness | `Roughness` |
| Brushed metal | `Anisotropic` |
| Glass, crystal | `Transmission Weight` (**not** `Transmission`) and `IOR` |
| Lume, any glow | `Emission Color` and `Emission Strength` |

Set a socket that does not exist and Blender raises `KeyError` deep inside your
script. Check first, and say so rather than failing:

```python
def put(socket, value):
    if socket in bsdf.inputs:
        bsdf.inputs[socket].default_value = value
    else:
        print("  note: no socket %r (Blender %s)" % (socket, bpy.app.version_string))
```

**Anisotropy is what makes steel read as steel.** A brushed case with
`Anisotropic` at 0.85 has a highlight stretched along the grain; the same case
at 0 is a grey ball. It survives export as `KHR_materials_anisotropy` and
three.js reads it. One socket, and it is the difference between a watch and a
render of a watch.

## Export, and the two things that go wrong

```python
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    export_yup=True,      # Blender is Z-up, three.js is Y-up
    export_apply=True,    # bake modifiers - three.js cannot read them
    export_materials="EXPORT",
)
```

1. **`export_yup=True`** is the default and is named explicitly because removing
   it lays the object on its back, and the symptom - a watch face pointing at
   the horizon - reads as a camera bug rather than an export flag.
2. **`export_apply=True`** bakes modifiers. Without it the boolean that cut the
   knurling, the array that placed it and the solidify on the crystal simply do
   not exist in the file, and the model arrives smooth and wrong.

The exporter's argument list moves between versions. Rather than assert one,
catch `TypeError` and retry with the minimum set, printing which argument was
refused - a template that hard-codes a 4.2 argument list fails on 4.5 with a
stack trace nobody reads.

### Draco is not free

`KHR_draco_mesh_compression` lands in **`extensionsRequired`**, not
`extensionsUsed`. That means the file will not load at all without a
`DRACOLoader` wired up:

```js
const draco = new DRACOLoader().setDecoderPath('/draco/');
new GLTFLoader().setDRACOLoader(draco).load('watch.glb', onLoad);
```

**Serve the decoder from your own origin.** A CSP with `connect-src 'self'` -
which the scaffold ships - blocks a CDN decoder path, and the failure looks like
a broken model rather than a blocked fetch, which is an hour of the wrong
debugging. `blender glb` prints this warning every time for that reason.

For a single hero object at this size the trade is arguable: 415 KB saved
against a decoder download and a CSP entry. `--no-draco` exists. For anything
over a megabyte raw, take the compression.

## Baking a material to textures

When the shader is the expensive part rather than the geometry - a procedural
guilloche, a worn edge mask, layered noise - bake it and ship an image.

```bash
blender bake scene.blend --out img/mat --res 1024 --samples 64
```

Baking needs a UV unwrap and Cycles, not EEVEE. UNVERIFIED: the bake path in
`blender.mjs` was not exercised in this session's testing - `probe`, `run`,
`glb` and the frame sequence were. Treat the flags above as documented rather
than measured until somebody runs it.

## The frame sequence, and why it is a last resort

```bash
blender run scripts/blender/turntable.py -- --out img/seq --count 90 --res 1200
```

Measured at 6 frames, 600 px, EEVEE Next, transparent WebP: **8 KB per frame**,
0.35 s per frame to render. Scaled to a real sequence that is roughly 90 frames
at 1200 px, and the template prints the real total and warns past 6 MB.

Three things about this route, in order of how much they cost:

1. **It cannot respond to the pointer.** Whatever the visitor does, they get the
   frames you rendered. Every hover, every drag, every bit of parallax is gone.
2. **It is the heaviest thing on the page by an order of magnitude.** The same
   watch as real-time geometry is 64 KB. A sequence of it is megabytes.
3. **Every frame you cut to save weight shows as a stutter**, and it shows worst
   exactly where the choreography peaks, because that is where the motion is
   fastest.

Use it when the material genuinely cannot be done in real time. Not because 3D
sounded hard.

Two details the template gets right and a hand-rolled one usually does not:
**the camera orbits, the object never moves** (rotating the object swings its
shadow and reflections with it, and it reads as a prop on a lazy susan), and
**the film is transparent** so the sequence composites onto the page's own
ground instead of carrying a grey square around.

EEVEE Next is `BLENDER_EEVEE_NEXT` in 4.2+; the old `BLENDER_EEVEE` identifier
is gone, so try the current one and fall back rather than asserting a version.

## bpy 4.x gotchas, all hit while writing the templates here

- **`shade_smooth_by_angle`** is the 4.1+ operator; the old `use_auto_smooth`
  mesh flag no longer exists. Setting `poly.use_smooth` per polygon still works
  and is the safe floor.
- **Boolean solver must be `EXACT`.** `FAST` leaves holes on coincident faces,
  and the hole does not appear until after export, in the browser.
- **A `-b` run still opens the startup file**, cube and all. Clear the scene
  first or the default cube ships inside your GLB.
- **Model at real size in metres.** A 41 mm watch is 0.041 across. three.js has
  no units, but a physical material, a camera near plane and a contact shadow
  all behave better at plausible scale, and an HDRI lit scene at 1000x is
  strange in ways that are hard to trace back.
- **Array-around-a-circle needs an empty as the offset object**, rotated by
  `360/count` degrees. It is the only way to get knurling, screws or markers
  round a bezel without writing the trigonometry.

## The templates that ship here

| File | What it is |
|---|---|
| `scripts/blender/part-library.py` | The watch: case, knurled bezel, domed crystal, dial, applied indices, hands, movement, rotor, caseback, bracelet. Every object named, every material set up. The knurl is cut geometry, not a normal map, which is the case that justifies Blender at all. |
| `scripts/blender/export-glb.py` | Unwrap, report every part with its triangle count, warn on default names and heavy models, export with Draco. |
| `scripts/blender/turntable.py` | An N-frame orbit with a key and fill, transparent film, and a warning when the sequence is too heavy to put in front of somebody. |

Each states at its top the exact command that runs it. Each can be run against
your own `.blend` instead of building the example.

## What not to try headlessly

- Anything that needs a GPU you do not have. Cycles on CPU is minutes a frame.
- Sculpting, simulation, cloth, fluid - all of it wants an interactive session
  and a person looking at it.
- Guessing at a `.blend` somebody else made. Open it, look at it, then script.
