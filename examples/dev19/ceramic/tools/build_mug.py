"""Build the handmade ceramic mug and its clean studio set.

The mug is authored as a closed wheel-thrown profile with real wall thickness,
then a swept, flared handle is unioned into the body. Geometry stays editable;
materials use packed image textures so the GLB export remains self contained.

Run with blender_execute(tool_path="tools/build_mug.py").
"""
from pathlib import Path
import math
import bpy
import bmesh
from mathutils import Vector

# blender_execute exposes the managed workspace path explicitly; Blender's cwd
# is not guaranteed to be the workspace.
ROOT = Path(workspace)
TEX_DIR = ROOT / "textures"

ANGLE_SEGMENTS = 224
OUTER_RINGS = 90
INNER_RINGS = 58
UV_TILE_M = 0.28

MUG_NAME = "CeramicMug"
OBJECTS = {}


# ---------------------------------------------------------------------------
# generic helpers
# ---------------------------------------------------------------------------
def smoothstep(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def lerp(a, b, t):
    return a + (b - a) * t


def make_mesh(name, verts, faces, mat_indices, uv_coords, materials):
    mesh = bpy.data.meshes.new(name + "_mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.update(calc_edges=True)
    for poly, mi in zip(mesh.polygons, mat_indices):
        poly.material_index = mi
        poly.use_smooth = True
    uv = mesh.uv_layers.new(name="UVMap")
    for loop, uv_co in zip(uv.data, uv_coords):
        loop.uv = uv_co
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for m in materials:
        obj.data.materials.append(m)
    return obj


def orient_outward(obj):
    """Make a closed mesh consistently outward-facing based on signed volume."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bm.calc_volume(signed=True) < 0.0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def shade_creases(obj, angle_degrees=58):
    """Smooth everything, keep truly sharp creases crisp."""
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()
    threshold = math.radians(angle_degrees)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            try:
                e.smooth = e.calc_face_angle(0.0) < threshold
            except ValueError:
                e.smooth = True
        else:
            e.smooth = True
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    for p in mesh.polygons:
        p.use_smooth = True


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
def load_image(filename, non_color=False):
    path = TEX_DIR / filename
    img = bpy.data.images.load(str(path), check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    else:
        img.colorspace_settings.name = "sRGB"
    return img


def make_textured_material(name, color_file, normal_file, roughness,
                           coat=0.0, coat_roughness=0.06,
                           bump_strength=0.18, normal_strength=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (560, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (280, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.name = "BaseColorTexture"
    tex.label = "Base Color"
    tex.location = (-300, 140)
    tex.image = load_image(color_file)
    tex.interpolation = "Linear"
    tex.extension = "REPEAT"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

    ntex = nt.nodes.new("ShaderNodeTexImage")
    ntex.name = "NormalTexture"
    ntex.label = "Orange-peel normal"
    ntex.location = (-300, -180)
    ntex.image = load_image(normal_file, non_color=True)
    ntex.interpolation = "Linear"
    ntex.extension = "REPEAT"
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.location = (0, -180)
    nmap.inputs["Strength"].default_value = normal_strength
    nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])

    # Procedural 3D bump avoids a tangent-space seam on the lathe and gives a
    # subtle glaze orange-peel in the Blender renders. The GLB keeps the full
    # modelled silhouette and the baked colour texture.
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.location = (-300, -480)
    noise.inputs["Scale"].default_value = 165.0
    noise.inputs["Detail"].default_value = 3.0
    noise.inputs["Roughness"].default_value = 0.58
    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (0, -430)
    bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = 0.00045
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])

    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = 1.47
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = coat_roughness
    return mat


def make_simple_material(name, color, roughness=0.5, bump_scale=None,
                         bump_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    if bump_scale:
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.location = (-300, -250)
        noise.inputs["Scale"].default_value = bump_scale
        noise.inputs["Detail"].default_value = 3.0
        noise.inputs["Roughness"].default_value = 0.6
        bump = nt.nodes.new("ShaderNodeBump")
        bump.location = (0, -250)
        bump.inputs["Strength"].default_value = bump_strength
        bump.inputs["Distance"].default_value = 0.00035
        nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
        nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


# ---------------------------------------------------------------------------
# mug body
# ---------------------------------------------------------------------------
def outer_base_radius(z):
    """Gentle thrown belly that tucks into a narrower foot and lip."""
    z0, z1 = 0.0090, 0.0942
    t = max(0.0, min(1.0, (z - z0) / (z1 - z0)))
    belly = 0.00492 * (math.sin(math.pi * t) ** 1.20)
    shoulder = 0.00262 * t
    neck = 0.00034 * smoothstep((t - 0.84) / 0.16)
    return 0.03778 + shoulder + belly - neck


def asym_scale(theta):
    return 1.0 + (0.00230 * math.sin(2.0 * theta + 0.45)
                  + 0.00105 * math.sin(3.0 * theta - 1.25)
                  + 0.00048 * math.sin(5.0 * theta + 2.10))


def rim_z_wave(theta):
    return (0.00082 * math.sin(3.0 * theta + 0.50)
            + 0.00045 * math.sin(5.0 * theta - 1.10)
            + 0.00022 * math.sin(7.0 * theta + 2.00))


def rim_r_wave(theta):
    return (0.00038 * math.sin(2.0 * theta + 1.25)
            + 0.00019 * math.sin(4.0 * theta - 0.40))


def rim_fade(z):
    return smoothstep((z - 0.069) / (0.0942 - 0.069))


def thrown_ridges(z, theta):
    if z < 0.011:
        return 0.0
    fade = smoothstep((z - 0.011) / 0.008) * (1.0 - smoothstep((z - 0.083) / 0.009))
    # A tiny angle-dependent phase drift makes the wheel rings feel hand-pulled.
    drift = 0.00055 * math.sin(2.0 * theta + 0.6) + 0.00025 * math.sin(3.0 * theta - 0.9)
    a = 0.000060 * math.sin(2.0 * math.pi * (z - 0.011 + drift) / 0.0069 + 0.8)
    b = 0.000026 * math.sin(2.0 * math.pi * (z - 0.011 + drift * 0.6) / 0.00305 + 2.2)
    return (a + b) * fade * 0.28


def wall_thickness(z):
    t = max(0.0, min(1.0, (z - 0.0090) / (0.0942 - 0.0090)))
    return 0.00420 + 0.00122 * ((1.0 - t) ** 1.55)


def body_ring_point(r0, z0, theta, region):
    """Apply subtle wheel-thrown asymmetry and a living, undulating rim."""
    r = r0
    z = z0
    if z0 > 0.0095:
        r *= asym_scale(theta)
        f = rim_fade(z0)
        r += rim_r_wave(theta) * f
        z += rim_z_wave(theta) * f
        if region in {"outer", "inner"}:
            r += thrown_ridges(z0, theta) * (1.0 if region == "outer" else 0.35)
    # Extremely subtle ovality of the upper opening; leaves the foot ring flat.
    if z0 > 0.025:
        oval = smoothstep((z0 - 0.025) / 0.040)
        r += (0.00020 * math.cos(2.0 * theta + 0.7)) * oval
    return r, z


def build_mug_body(materials):
    profile = []  # list of (r, z, region)
    seg_mats = []  # material index for the surface to the following profile point

    # Underside, foot ring, and the outside of the foot: exposed stoneware.
    bottom = [
        (0.0000, 0.00465),
        (0.0060, 0.00460),
        (0.0120, 0.00455),
        (0.0180, 0.00448),
        (0.0230, 0.00440),
        (0.0256, 0.00460),
        (0.0270, 0.00415),
        (0.0280, 0.00305),
        (0.0286, 0.00155),
        (0.0290, 0.00055),
        (0.0298, 0.00002),
        (0.0339, 0.00002),
        (0.0347, 0.00025),
        (0.0354, 0.00095),
        (0.0361, 0.00215),
        (0.0367, 0.00375),
        (0.0372, 0.00565),
        (0.0375, 0.00745),
        (0.0378, 0.00900),
    ]
    for r, z in bottom:
        profile.append((r, z, "clay"))
    # Keep the unglazed stoneware visible on the foot only, not as a wide band.
    for i in range(len(bottom) - 1):
        seg_mats.append(2 if bottom[i][1] < 0.00560 else 0)

    # Outer wall, sampled all the way to the lip.
    for i in range(1, OUTER_RINGS + 1):
        t = i / OUTER_RINGS
        # Slightly denser near the top where the rim undulates.
        tt = t ** 0.94
        z = lerp(0.0090, 0.0942, tt)
        profile.append((outer_base_radius(z), z, "outer"))
        seg_mats.append(0)

    # Rounded rim top. Interpolating radius and doming z gives a lip that rolls
    # naturally over instead of looking like a cut tube.
    z_top = 0.0942
    r_out_top = outer_base_radius(z_top)
    r_in_top = r_out_top - 0.00420
    rim_steps = 12
    for i in range(1, rim_steps + 1):
        t = i / rim_steps
        r = lerp(r_out_top, r_in_top, t)
        z = z_top + 0.00148 * (math.sin(math.pi * t) ** 0.58)
        profile.append((r, z, "rim"))
        # Keep most of the rolled lip teal; only the inner edge turns cream.
        seg_mats.append(0 if t < 0.73 else 1)

    # Inner wall, with a real 4.2-5.4 mm ceramic wall.
    for i in range(INNER_RINGS + 1):
        t = i / INNER_RINGS
        z = lerp(0.09375, 0.0242, t)
        r = outer_base_radius(z) - wall_thickness(z)
        profile.append((r, z, "inner"))
        seg_mats.append(1)

    # Concave inside-bottom fillet.
    r_wall_bottom = outer_base_radius(0.0242) - wall_thickness(0.0242)
    p0 = Vector((r_wall_bottom, 0.0242))
    p1 = Vector((r_wall_bottom, 0.0206))
    p2 = Vector((0.0332, 0.01785))
    p3 = Vector((0.0293, 0.01762))
    fillet_steps = 12
    for i in range(1, fillet_steps + 1):
        t = i / fillet_steps
        p = ((1 - t) ** 3) * p0 + 3 * ((1 - t) ** 2) * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3
        profile.append((p.x, p.y, "inner_floor"))
        seg_mats.append(1)

    # Gently dished inner floor.
    floor_edge = 0.0293
    floor_steps = 18
    z_center = 0.01610
    for i in range(1, floor_steps + 1):
        t = i / floor_steps
        r = floor_edge * (1.0 - t)
        z = z_center + 0.00152 * (r / floor_edge) ** 1.8
        profile.append((r, z, "inner_floor"))
        seg_mats.append(1)

    # Work out per-ring UV V from the physical profile length.
    s_vals = [0.0]
    for i in range(1, len(profile)):
        dr = profile[i][0] - profile[i - 1][0]
        dz = profile[i][1] - profile[i - 1][1]
        s_vals.append(s_vals[-1] + math.hypot(dr, dz))

    segments = ANGLE_SEGMENTS
    verts = []
    uvs = []
    ring_indices = []
    pole_indices = {}
    for ri, (r0, z0, region) in enumerate(profile):
        v = s_vals[ri] / UV_TILE_M
        if r0 < 1e-9:
            idx = len(verts)
            verts.append((0.0, 0.0, z0))
            uvs.append((0.5, v))
            pole_indices[ri] = idx
            ring_indices.append([idx] * segments)
            continue
        ring = []
        for j in range(segments):
            # Put the lathe/UV seam at the back, away from the front, side and
            # three-quarter viewing axes. The wobble stays visually identical.
            theta = 2.0 * math.pi * j / segments + math.pi
            r, z = body_ring_point(r0, z0, theta, region)
            ring.append(len(verts))
            verts.append((r * math.cos(theta), r * math.sin(theta), z))
            uvs.append((j / segments, v))
        ring_indices.append(ring)

    faces = []
    face_mats = []
    loop_uvs = []
    for ri in range(len(profile) - 1):
        current = ring_indices[ri]
        nxt = ring_indices[ri + 1]
        mat = seg_mats[ri]
        current_pole = current[0] == current[-1]
        next_pole = nxt[0] == nxt[-1]
        if current_pole and next_pole:
            continue
        for j in range(segments):
            j2 = (j + 1) % segments
            if current_pole:
                f = (current[0], nxt[j], nxt[j2])
                uv_tri = (uvs[current[0]], uvs[nxt[j]], uvs[nxt[j2]])
            elif next_pole:
                f = (current[j], current[j2], nxt[0])
                uv_tri = (uvs[current[j]], uvs[current[j2]], uvs[nxt[0]])
            else:
                f = (current[j], current[j2], nxt[j2], nxt[j])
                uv_quad = (uvs[current[j]], uvs[current[j2]],
                           uvs[nxt[j2]], uvs[nxt[j]])
            faces.append(f)
            face_mats.append(mat)
            loop_uvs.extend(uv_tri if (current_pole or next_pole) else uv_quad)

    obj = make_mesh(MUG_NAME, verts, faces, face_mats, loop_uvs, materials)

    # Correct winding and clean any tiny degenerate face from the poles.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-8)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    orient_outward(obj)
    shade_creases(obj, 62)
    return obj


# ---------------------------------------------------------------------------
# handle
# ---------------------------------------------------------------------------
def bezier(p0, p1, p2, p3, t):
    q = 1.0 - t
    return (q ** 3) * p0 + 3 * (q ** 2) * t * p1 + 3 * q * (t ** 2) * p2 + (t ** 3) * p3


def bezier_tangent(p0, p1, p2, p3, t):
    q = 1.0 - t
    return (3 * q * q) * (p1 - p0) + (6 * q * t) * (p2 - p1) + (3 * t * t) * (p3 - p2)


def build_handle(materials):
    p0 = Vector((0.0395, 0.0, 0.0355))
    p1 = Vector((0.0930, 0.0, 0.0335))
    p2 = Vector((0.0920, 0.0, 0.0875))
    p3 = Vector((0.0395, 0.0, 0.0830))

    path_steps = 112
    ring_steps = 28
    path = []
    tangents = []
    for i in range(path_steps + 1):
        t = i / path_steps
        p = bezier(p0, p1, p2, p3, t)
        # Hand-pulled slight side sway.
        p.y += 0.00075 * math.sin(math.pi * t) * math.sin(2.2 * math.pi * t + 0.3)
        path.append(p)
        tangents.append(bezier_tangent(p0, p1, p2, p3, t).normalized())

    verts = []
    uvs = []
    rings = []
    path_len = 0.0
    for i in range(1, len(path)):
        path_len += (path[i] - path[i - 1]).length

    for i, (p, tan) in enumerate(zip(path, tangents)):
        t = i / path_steps
        # Broad, soft roots and a slightly fuller upper grip.
        root = max(math.exp(-((t / 0.067) ** 2)), math.exp(-(((1.0 - t) / 0.057) ** 2)))
        grip = 1.0 + 0.055 * math.sin(math.pi * t)
        r_normal = 0.00655 * grip * (1.0 + 0.255 * root)
        r_depth = 0.00720 * grip * (1.0 + 0.185 * root)
        # An organic, very slight change in section along the pull.
        r_normal *= 1.0 + 0.014 * math.sin(2.0 * math.pi * t + 0.7)
        r_depth *= 1.0 + 0.010 * math.sin(2.0 * math.pi * t - 0.5)

        side = Vector((0.0, 1.0, 0.0))
        # Do not force normal.z positive: that flips the section 180 degrees at
        # the crest of the arch and twists the tube into itself. The symmetric
        # elliptical section remains continuous with the raw cross product.
        normal = side.cross(tan).normalized()
        ring = []
        for j in range(ring_steps):
            phi = 2.0 * math.pi * j / ring_steps
            q = p + math.cos(phi) * r_normal * normal + math.sin(phi) * r_depth * side
            ring.append(len(verts))
            verts.append(tuple(q))
            # Physically-scaled cylindrical-ish mapping, tileable texture.
            u = (i / path_steps) * (path_len / UV_TILE_M)
            v = ((j / ring_steps) * (2.0 * math.pi * 0.0070) / UV_TILE_M)
            uvs.append((u, v))
        rings.append(ring)

    faces = []
    face_mats = []
    loop_uvs = []
    for i in range(len(rings) - 1):
        a = rings[i]
        b = rings[i + 1]
        for j in range(ring_steps):
            j2 = (j + 1) % ring_steps
            faces.append((a[j], a[j2], b[j2], b[j]))
            face_mats.append(0)
            loop_uvs.extend([uvs[a[j]], uvs[a[j2]], uvs[b[j2]], uvs[b[j]]])

    # Caps face inwards into the mug wall; they remain hidden after union.
    a = rings[0]
    b = rings[-1]
    for j in range(1, ring_steps - 1):
        faces.append((a[0], a[j + 1], a[j]))
        face_mats.append(0)
        loop_uvs.extend([uvs[a[0]], uvs[a[j + 1]], uvs[a[j]]])
        faces.append((b[0], b[j], b[j + 1]))
        face_mats.append(0)
        loop_uvs.extend([uvs[b[0]], uvs[b[j]], uvs[b[j + 1]]])

    obj = make_mesh("Mug_Handle_Source", verts, faces, face_mats, loop_uvs, materials)
    orient_outward(obj)
    shade_creases(obj, 62)
    return obj


def apply_modifiers(obj):
    """Apply all modifiers without relying on an active-area operator context."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    depsgraph.update()
    eval_obj = obj.evaluated_get(depsgraph)
    new_mesh = bpy.data.meshes.new_from_object(eval_obj, depsgraph=depsgraph)
    old_mesh = obj.data
    obj.modifiers.clear()
    obj.data = new_mesh
    new_mesh.name = obj.name + "_mesh"
    if old_mesh.users == 0:
        bpy.data.meshes.remove(old_mesh)
    obj.data.update()


def union_handle(body, handle):
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    handle.select_set(True)
    mod = body.modifiers.new(name="Handle_Union", type="BOOLEAN")
    mod.operation = "UNION"
    mod.solver = "EXACT"
    mod.use_self = False
    mod.use_hole_tolerant = True
    mod.material_mode = "INDEX"
    mod.object = handle
    try:
        apply_modifiers(body)
        result = "boolean"
    except Exception as exc:
        print("Boolean union failed:", exc)
        # Preserve both watertight shells rather than losing the handle.
        bm = bmesh.new()
        bm.from_mesh(body.data)
        bm.from_mesh(handle.data)
        bm.to_mesh(body.data)
        bm.free()
        body.modifiers.clear()
        result = "joined"
    if handle.name in bpy.data.objects:
        bpy.data.objects.remove(handle, do_unlink=True)
    bpy.context.view_layer.objects.active = body
    body.select_set(True)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(body.data)
    bm.free()
    body.data.update()

    # A sub-millimetre bevel only catches the hard Boolean seam at the handle
    # roots (and softly kisses the foot edge), so the join reads as a pulled,
    # glazed ceramic transition rather than a cut intersection.
    if result == "boolean":
        bev = body.modifiers.new("Handle_Seam_Fillet", "BEVEL")
        bev.width = 0.00062
        bev.segments = 2
        bev.limit_method = "ANGLE"
        bev.angle_limit = math.radians(42.0)
        bev.harden_normals = False
        apply_modifiers(body)
        bm = bmesh.new()
        bm.from_mesh(body.data)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-6)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(body.data)
        bm.free()
        body.data.update()

    shade_creases(body, 62)
    return result


# ---------------------------------------------------------------------------
# studio
# ---------------------------------------------------------------------------
def build_cyclorama(material):
    profile = [
        (0.000, -0.0125),
        (0.500, -0.0125),
        (1.050, -0.0125),
        (1.150, -0.0115),
        (1.235, -0.0070),
        (1.300, 0.0060),
        (1.345, 0.0350),
        (1.375, 0.0850),
        (1.395, 0.1600),
        (1.405, 0.5000),
        (1.410, 1.6000),
    ]
    seg = 128
    verts = []
    uvs = []
    rings = []
    for ri, (r, z) in enumerate(profile):
        if r < 1e-9:
            rings.append([len(verts)] * seg)
            verts.append((0, 0, z))
            uvs.append((0.5, 0.5))
            continue
        ring = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            ring.append(len(verts))
            verts.append((r * math.cos(a), r * math.sin(a), z))
            uvs.append((j / seg, ri / (len(profile) - 1)))
        rings.append(ring)
    faces = []
    loop_uvs = []
    for i in range(len(rings) - 1):
        for j in range(seg):
            j2 = (j + 1) % seg
            if i == 0:
                f = (rings[0][0], rings[1][j], rings[1][j2])
                uv_tri = (uvs[rings[0][0]], uvs[rings[1][j]], uvs[rings[1][j2]])
            else:
                f = (rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j])
                uv_quad = (uvs[rings[i][j]], uvs[rings[i][j2]],
                           uvs[rings[i + 1][j2]], uvs[rings[i + 1][j]])
            faces.append(f)
            loop_uvs.extend(uv_tri if i == 0 else uv_quad)
    obj = make_mesh("Studio_Cyclorama", verts, faces, [0] * len(faces), loop_uvs, [material])
    for p in obj.data.polygons:
        p.use_smooth = True
    # Ensure the visible inside faces point up / inward.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    # This lathe is seen from inside: the floor normal should point up. If the
    # consistent orientation faces the outside of the bowl, reverse everything.
    floor_normal = None
    for f in bm.faces:
        c = f.calc_center_median()
        if c.z < -0.0120:
            floor_normal = f.normal.z
            break
    if floor_normal is not None and floor_normal < 0:
        for f in bm.faces:
            f.normal_flip()
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def build_plinth(material):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=160, radius=0.100, depth=0.0120,
        location=(0.0, 0.0, -0.0060), rotation=(0, 0, 0))
    obj = bpy.context.view_layer.objects.active
    obj.name = "Studio_Plinth"
    obj.data.name = "Studio_Plinth_mesh"
    bevel = obj.modifiers.new("Soft edge", "BEVEL")
    bevel.width = 0.0030
    bevel.segments = 4
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(40)
    apply_modifiers(obj)
    obj.data.materials.append(material)
    for p in obj.data.polygons:
        p.use_smooth = True
    shade_creases(obj, 32)
    return obj


def add_area_light(name, loc, target, size, energy, color):
    data = bpy.data.lights.new(name, type="AREA")
    data.shape = "DISK"
    data.size = size
    data.energy = energy
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    look_at(obj, target)
    return obj


def build_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 10
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 5
    scene.cycles.transmission_bounces = 4
    scene.render.resolution_x = 1200
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    scene.view_settings.exposure = -0.70

    world = bpy.data.worlds.new("Studio_World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.28, 0.265, 0.240, 1.0)
    bg.inputs["Strength"].default_value = 0.12
    scene.world = world

    teal = make_textured_material(
        "Glaze_Teal", "glaze_teal_basecolor.png", "ceramic_normal.png",
        roughness=0.235, coat=0.30, coat_roughness=0.055,
        bump_strength=0.16, normal_strength=0.55)
    cream = make_textured_material(
        "Glaze_Cream", "glaze_cream_basecolor.png", "ceramic_normal.png",
        roughness=0.315, coat=0.16, coat_roughness=0.08,
        bump_strength=0.12, normal_strength=0.42)
    clay = make_textured_material(
        "Stoneware_Foot", "stoneware_basecolor.png", "stoneware_normal.png",
        roughness=0.56, coat=0.0, bump_strength=0.10, normal_strength=0.85)
    materials = [teal, cream, clay]

    body = build_mug_body(materials)
    handle = build_handle(materials)
    mode = union_handle(body, handle)
    body.name = MUG_NAME
    body.data.name = MUG_NAME + "_mesh"
    body["asset"] = "Hand-thrown stoneware mug"
    body["height_mm"] = 97.0
    body["outer_diameter_mm"] = 87.9
    body["rim_wall_mm"] = 4.2
    body["foot_ring_mm"] = 4.1
    body["handle_span_mm"] = 45.0
    body["capacity_approx_ml"] = 300
    body["design_notes"] = (
        "Lathe-authored closed ceramic shell with 4.2-5.4 mm walls, undulating "
        "rim, dished interior floor, recessed foot ring, and a swept flared "
        "handle unioned and locally filleted into the body."
    )
    OBJECTS["mug"] = body.name
    OBJECTS["union_mode"] = mode

    studio_mat = make_simple_material(
        "Studio_Backdrop", (0.300, 0.280, 0.250), roughness=0.76,
        bump_scale=8.0, bump_strength=0.02)
    plinth_mat = make_simple_material(
        "Studio_Plinth_Stone", (0.360, 0.340, 0.305), roughness=0.58,
        bump_scale=40.0, bump_strength=0.03)
    backdrop = build_cyclorama(studio_mat)
    plinth = build_plinth(plinth_mat)
    OBJECTS["backdrop"] = backdrop.name
    OBJECTS["plinth"] = plinth.name

    # Three deliberate soft sources keep the glaze dimensional and clean.
    add_area_light("Key_Softbox", (-0.58, -0.56, 0.77), (0.0, 0.0, 0.050),
                   0.72, 20.0, (1.0, 0.955, 0.885))
    add_area_light("Fill_Softbox", (0.63, -0.42, 0.34), (0.0, 0.0, 0.048),
                   0.90, 8.0, (0.86, 0.92, 1.0))
    add_area_light("Rim_Strip", (0.34, 0.58, 0.66), (0.0, 0.0, 0.060),
                   0.45, 35.0, (0.92, 0.97, 1.0))
    add_area_light("Top_Softbox", (0.02, -0.06, 0.95), (0.0, 0.0, 0.040),
                   0.58, 12.0, (1.0, 0.98, 0.94))

    # Cameras.
    def make_camera(name, location, target, lens):
        cam_data = bpy.data.cameras.new(name)
        cam_data.lens = lens
        cam_data.sensor_width = 36.0
        cam_data.dof.use_dof = True
        cam_data.dof.focus_distance = (Vector(location) - Vector(target)).length
        cam_data.dof.aperture_fstop = 8.0
        cam = bpy.data.objects.new(name, cam_data)
        bpy.context.scene.collection.objects.link(cam)
        cam.location = location
        look_at(cam, target)
        return cam

    make_camera("Cam_Front", (0.0, -0.515, 0.078), (0.002, 0.0, 0.047), 88.0)
    make_camera("Cam_Side", (0.505, 0.0, 0.078), (0.0, 0.0, 0.047), 88.0)
    make_camera("Cam_Top", (0.105, -0.115, 0.455), (0.0, 0.0, 0.047), 82.0)
    make_camera("Cam_Hero", (0.365, -0.405, 0.132), (0.004, 0.0, 0.050), 96.0)
    scene.camera = bpy.data.objects["Cam_Front"]

    # Organize the outliner.
    prod = bpy.data.collections.new("PRODUCT")
    studio = bpy.data.collections.new("STUDIO")
    scene.collection.children.link(prod)
    scene.collection.children.link(studio)
    for collection, names in (
        (prod, [MUG_NAME]),
        (studio, ["Studio_Cyclorama", "Studio_Plinth", "Key_Softbox",
                  "Fill_Softbox", "Rim_Strip", "Top_Softbox",
                  "Cam_Front", "Cam_Side", "Cam_Top", "Cam_Hero"]),
    ):
        for n in names:
            obj = bpy.data.objects.get(n)
            if not obj:
                continue
            for c in list(obj.users_collection):
                c.objects.unlink(obj)
            collection.objects.link(obj)

    # A compact in-file handoff note for anyone opening the editable source.
    if "README_HandmadeMug" in bpy.data.texts:
        bpy.data.texts.remove(bpy.data.texts["README_HandmadeMug"])
    text = bpy.data.texts.new("README_HandmadeMug")
    text.write(
        "HANDMADE CERAMIC MUG\n"
        "====================\n"
        "Product object: CeramicMug (one watertight, editable mesh)\n"
        "Dimensions: approx. 88 mm diameter x 97 mm high; 130 mm including handle\n"
        "Wall: 4.2 mm at rim, 5.4 mm low down; recessed foot ring, dished interior.\n"
        "Materials: teal glaze exterior/rolled lip, ivory liner, exposed stoneware foot.\n"
        "Studio: closed cyclorama, low stone plinth, four soft sources, four cameras.\n"
        "Cameras: Cam_Front, Cam_Side, Cam_Top (interior visible), Cam_Hero.\n"
        "Render: Cycles, AgX Medium High Contrast, 1200 x 1200 PNG.\n"
        "All image textures are packed into this .blend.\n"
    )

    for obj in bpy.context.scene.objects:
        obj.select_set(False)
    body.select_set(True)
    bpy.context.view_layer.objects.active = body

    # Save a stable, self-contained working source.
    try:
        bpy.ops.file.pack_all()
    except Exception as exc:
        print("Pack warning:", exc)
    blend_path = ROOT / "mug_studio.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    OBJECTS["blend"] = str(blend_path)

    # Report factual geometry metrics.
    bm = bmesh.new()
    bm.from_mesh(body.data)
    boundary = sum(1 for e in bm.edges if len(e.link_faces) != 2)
    bm.free()
    OBJECTS["verts"] = len(body.data.vertices)
    OBJECTS["faces"] = len(body.data.polygons)
    OBJECTS["boundary_edges"] = boundary
    dims = body.dimensions
    OBJECTS["dimensions_mm"] = [round(v * 1000, 2) for v in dims]
    print("Build report:", OBJECTS)
    return OBJECTS


def run(params=None):
    result = build_scene()
    dsh_result = result
    return result


if __name__ == "__main__":
    result = build_scene()
    dsh_result = result
