import bpy
import bmesh
import math
from math import pi, sin, cos, radians, tan
from mathutils import Vector

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for coll in list(bpy.data.collections):
        if coll.users == 0:
            bpy.data.collections.remove(coll)
    for block in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                  bpy.data.cameras, bpy.data.lights, bpy.data.actions):
        pass


def srgb_to_linear(c):
    if c <= 0.04045:
        return c / 12.92
    return ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h, alpha=1.0):
    h = h.lstrip('#')
    vals = [srgb_to_linear(int(h[i:i+2], 16) / 255.0) for i in (0, 2, 4)]
    return (*vals, alpha)


def make_material(name, hex_color, metallic=0.0, roughness=0.4, coat=0.0,
                  coat_roughness=0.1, bump_scale=None, bump_strength=0.0,
                  anisotropy=0.0, noise_detail=2.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = hex_rgba(hex_color)
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    out.location = (560, 0)
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bsdf.location = (240, 0)
    bsdf.inputs['Base Color'].default_value = hex_rgba(hex_color)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Coat Weight'].default_value = coat
    bsdf.inputs['Coat Roughness'].default_value = coat_roughness
    if anisotropy:
        bsdf.inputs['Anisotropic'].default_value = anisotropy
    if bump_scale is not None and bump_strength > 0:
        texcoord = nt.nodes.new('ShaderNodeTexCoord')
        texcoord.location = (-660, -180)
        noise = nt.nodes.new('ShaderNodeTexNoise')
        noise.location = (-440, -160)
        noise.inputs['Scale'].default_value = bump_scale
        noise.inputs['Detail'].default_value = noise_detail
        noise.inputs['Roughness'].default_value = 0.55
        bump = nt.nodes.new('ShaderNodeBump')
        bump.location = (-100, -160)
        bump.inputs['Strength'].default_value = bump_strength
        bump.inputs['Distance'].default_value = 0.015
        nt.links.new(texcoord.outputs['Object'], noise.inputs['Vector'])
        nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
        nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    return mat


def new_collection(name, parent=None):
    coll = bpy.data.collections.new(name)
    if parent is not None:
        parent.children.link(coll)
    else:
        bpy.context.scene.collection.children.link(coll)
    return coll


def link_to_coll(obj, coll):
    for c in list(obj.users_collection):
        c.objects.unlink(obj)
    coll.objects.link(obj)


def lathe(name, profile, segments=96, axis='Z', mat=None, coll=None,
          shade_smooth=True, smooth_angle=38):
    """Revolve a (radius, axial) profile around Z or Y.

    Profile may start/end at radius 0; fan caps are generated.
    """
    verts = []
    faces = []
    start_center = abs(profile[0][0]) < 1e-8
    end_center = abs(profile[-1][0]) < 1e-8
    mid = profile[1:-1] if start_center and end_center else profile
    rings = []
    for r, a in mid:
        ring = []
        for s in range(segments):
            t = 2 * pi * s / segments
            rr = max(r, 1e-7)
            if axis == 'Z':
                p = (rr * cos(t), rr * sin(t), a)
            elif axis == 'Y':
                p = (rr * cos(t), a, rr * sin(t))
            else:  # X
                p = (a, rr * cos(t), rr * sin(t))
            ring.append(len(verts))
            verts.append(p)
        rings.append(ring)
    # surfaces between rings
    for i in range(len(rings) - 1):
        r0 = rings[i]
        r1 = rings[i + 1]
        for s in range(segments):
            s2 = (s + 1) % segments
            faces.append((r0[s], r0[s2], r1[s2], r1[s]))
    # caps at radius-zero profile ends
    if start_center:
        c = len(verts)
        r, a = profile[0]
        if axis == 'Z':
            verts.append((0, 0, a))
        elif axis == 'Y':
            verts.append((0, a, 0))
        else:
            verts.append((a, 0, 0))
        r0 = rings[0]
        for s in range(segments):
            s2 = (s + 1) % segments
            faces.append((c, r0[s2], r0[s]))
    if end_center:
        c = len(verts)
        r, a = profile[-1]
        if axis == 'Z':
            verts.append((0, 0, a))
        elif axis == 'Y':
            verts.append((0, a, 0))
        else:
            verts.append((a, 0, 0))
        r1 = rings[-1]
        for s in range(segments):
            s2 = (s + 1) % segments
            faces.append((c, r1[s], r1[s2]))
    # open profiles at both ends: cap them flat if they're not at zero radius
    if not start_center and not end_center:
        # The shroud's closed loop doesn't need caps. For open shells we add ngon caps.
        # If profile is a closed ring loop, this object will not be watertight anyway.
        pass
    mesh = bpy.data.meshes.new(name + '_mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    if coll:
        coll.objects.link(obj)
    else:
        bpy.context.collection.objects.link(obj)
    if mat:
        obj.data.materials.append(mat)
    if shade_smooth:
        for p in mesh.polygons:
            p.use_smooth = True
        try:
            bpy.context.view_layer.objects.active = obj
            obj.select_set(True)
            bpy.ops.object.shade_smooth_by_angle(angle=radians(smooth_angle))
            obj.select_set(False)
        except Exception:
            pass
    return obj


def add_bevel(obj, width=0.001, segments=2, angle=45):
    bevel = obj.modifiers.new('Soft edge', 'BEVEL')
    bevel.width = width
    bevel.segments = segments
    bevel.limit_method = 'ANGLE'
    bevel.angle_limit = radians(angle)
    bevel.harden_normals = True
    return bevel


def torus(name, major, minor, location, rotation=(pi/2, 0, 0),
          mat=None, coll=None, major_segments=96, minor_segments=8):
    bpy.ops.mesh.primitive_torus_add(
        align='WORLD', location=location, rotation=rotation,
        major_radius=major, minor_radius=minor,
        major_segments=major_segments, minor_segments=minor_segments)
    obj = bpy.context.object
    obj.name = name
    if coll:
        link_to_coll(obj, coll)
    if mat:
        obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def cylinder(name, radius, depth, location, rotation=(0, 0, 0), mat=None,
             coll=None, vertices=64, bevel=0.0015):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth,
        location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    if coll:
        link_to_coll(obj, coll)
    if mat:
        obj.data.materials.append(mat)
    if bevel:
        add_bevel(obj, bevel, 2, 35)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def add_curve_tube(name, points, radius, mat, coll, resolution=16, bevel_res=3,
                   cyclic=False, spline_type='NURBS'):
    cu = bpy.data.curves.new(name + '_curve', 'CURVE')
    cu.dimensions = '3D'
    cu.resolution_u = resolution
    cu.bevel_depth = radius
    cu.bevel_resolution = bevel_res
    cu.use_fill_caps = True
    cu.resolution_u = resolution
    if spline_type == 'NURBS':
        sp = cu.splines.new('NURBS')
        sp.points.add(len(points) - 1)
        for p, co in zip(sp.points, points):
            p.co = (*co, 1.0)
        sp.order_u = min(4, len(points))
        sp.use_endpoint_u = True
        sp.resolution_u = resolution
    elif spline_type == 'POLY':
        sp = cu.splines.new('POLY')
        sp.points.add(len(points) - 1)
        for p, co in zip(sp.points, points):
            p.co = (*co, 1.0)
    else:
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(len(points) - 1)
        for bp, co in zip(sp.bezier_points, points):
            bp.co = co
            bp.handle_left_type = 'AUTO'
            bp.handle_right_type = 'AUTO'
        sp.resolution_u = resolution
    cu.materials.append(mat)
    obj = bpy.data.objects.new(name, cu)
    coll.objects.link(obj)
    return obj


def make_text(name, text, size, location, rotation, mat, coll,
              extrude=0.0005, align_x='CENTER'):
    cu = bpy.data.curves.new(name + '_curve', 'FONT')
    cu.body = text
    cu.align_x = align_x
    cu.align_y = 'CENTER'
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = 0.00012
    cu.bevel_resolution = 2
    obj = bpy.data.objects.new(name, cu)
    coll.objects.link(obj)
    obj.location = location
    obj.rotation_euler = rotation
    cu.materials.append(mat)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.object
    obj.name = name
    obj.select_set(False)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def parent_keep_transform(child, parent):
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = parent
    child.matrix_parent_inverse = parent.matrix_world.inverted()
    child.matrix_world = mw
    bpy.context.view_layer.update()


def blade_mesh(name, base_angle, mat_body, mat_brass, coll, head_z=0.46,
               blade_y=-0.014):
    nr = 28
    nc = 14
    verts = []
    faces = []
    face_uvs = []
    for iv in range(nr + 1):
        u = iv / nr
        r = 0.038 + 0.114 * u
        # Tapered rounded tip, broad middle, narrow root.
        chord = (0.032 + 0.074 * sin(pi * (u ** 0.82)) + 0.010 * sin(pi * u))
        chord *= (max(0.0, 1.0 - u ** 9)) ** 0.28
        chord = max(chord, 0.002)
        sweep = radians(45.0) * (u ** 1.18)
        theta_c = base_angle + sweep
        for ic in range(nc + 1):
            s = ic / nc - 0.5  # chord coordinate
            angle = theta_c + s * chord / r
            # Blade pitch, cupped surface, slight forward lean at tip.
            y = blade_y
            y += -tan(radians(27.0 + 10.0 * u)) * (s * chord)
            y += -0.0085 * (1.0 - 4.0 * s * s) * (0.45 + 0.55 * u)
            y += -0.0035 * (u ** 2)
            z = head_z + r * sin(angle)
            x = r * cos(angle)
            verts.append((x, y, z))
            face_uvs.append((u, s + 0.5))
    for iv in range(nr):
        for ic in range(nc):
            a = iv * (nc + 1) + ic
            b = a + 1
            c = a + (nc + 1) + 1
            d = a + (nc + 1)
            faces.append((a, b, c, d))
    mesh = bpy.data.meshes.new(name + '_mesh')
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    coll.objects.link(obj)
    obj.data.materials.append(mat_body)
    obj.data.materials.append(mat_brass)
    # Brass leading edge + tip cap. Use the average UV of each face (not vertex order).
    for poly in mesh.polygons:
        us = [face_uvs[vi][0] for vi in poly.vertices]
        ss = [face_uvs[vi][1] for vi in poly.vertices]
        u_avg = sum(us) / len(us)
        s_avg = sum(ss) / len(ss)
        if u_avg > 0.945 or (u_avg > 0.30 and s_avg > 0.925):
            poly.material_index = 1
    for p in mesh.polygons:
        p.use_smooth = True
    sol = obj.modifiers.new('Thickness', 'SOLIDIFY')
    sol.thickness = 0.0027
    sol.offset = 0.0
    sol.use_even_offset = True
    add_bevel(obj, 0.0011, 2, 50)
    return obj


# -----------------------------------------------------------------------------
# Scene setup and materials
# -----------------------------------------------------------------------------

scene = bpy.context.scene
clear_scene()
scene.unit_settings.system = 'METRIC'
scene.unit_settings.length_unit = 'METERS'

fan_coll = new_collection('FAN')
base_coll = new_collection('Base & Stem', fan_coll)
head_coll = new_collection('Fan Head', fan_coll)
studio_coll = new_collection('Studio')

navy = make_material('Navy Enamel', '#081A30', metallic=0.3, roughness=0.27,
                     coat=0.65, coat_roughness=0.08, bump_scale=22,
                     bump_strength=0.035)
navy_deep = make_material('Deep Navy', '#07162C', metallic=0.18, roughness=0.3,
                          coat=0.45, coat_roughness=0.1, bump_scale=18,
                          bump_strength=0.025)
navy_blade = make_material('Blue Steel Blades', '#17395C', metallic=0.6,
                           roughness=0.26, coat=0.2, coat_roughness=0.1,
                           bump_scale=90, bump_strength=0.02,
                           anisotropy=0.18)
brass = make_material('Satin Brass', '#BC8D45', metallic=1.0, roughness=0.24,
                      anisotropy=0.22, bump_scale=180, bump_strength=0.025)
brass_soft = make_material('Brushed Brass', '#A87D3A', metallic=1.0,
                           roughness=0.32, anisotropy=0.35, bump_scale=260,
                           bump_strength=0.018)
brass_dark = make_material('Aged Brass', '#8F6B36', metallic=1.0,
                           roughness=0.37, anisotropy=0.2, bump_scale=210,
                           bump_strength=0.03)
rubber = make_material('Soft Black Rubber', '#07090B', metallic=0.0,
                       roughness=0.72)
ivory = make_material('Ivory Inlay', '#E9E1CF', metallic=0.0, roughness=0.34,
                      coat=0.4)
stage_mat = make_material('Warm Studio Plaster', '#B8B4AA', metallic=0.0,
                          roughness=0.78, bump_scale=5, bump_strength=0.012)

# -----------------------------------------------------------------------------
# Base
# -----------------------------------------------------------------------------

base_profile = [
    (0.000, 0.006), (0.168, 0.006), (0.190, 0.009),
    (0.202, 0.017), (0.205, 0.028), (0.201, 0.039),
    (0.191, 0.047), (0.175, 0.052), (0.121, 0.055),
    (0.060, 0.058), (0.000, 0.059),
]
base = lathe('Base_Plinth', base_profile, segments=128, axis='Z',
             mat=navy, coll=base_coll, smooth_angle=30)
base['design_role'] = 'Weighted plinth; stays fixed during animation'

# Rubber foot ring and underside pad.
torus('Base_Rubber_Foot', 0.181, 0.0032, (0, 0, 0.0042),
      rotation=(0, 0, 0), mat=rubber, coll=base_coll,
      major_segments=128, minor_segments=8)
cylinder('Base_Underside_Pad', 0.162, 0.004, (0, 0, 0.0032),
         mat=rubber, coll=base_coll, bevel=0.001)
# Brass waist ring.
torus('Base_Brass_Waist', 0.2022, 0.0026, (0, 0, 0.031),
      rotation=(0, 0, 0), mat=brass, coll=base_coll,
      major_segments=128, minor_segments=8)
# Recessed top halo.
torus('Base_Top_Halo', 0.078, 0.0016, (0, 0, 0.0588),
      rotation=(0, 0, 0), mat=brass_soft, coll=base_coll,
      major_segments=96, minor_segments=8)

# Control knobs on base top.
def control_knob(name, x, y, r, h, coll):
    prof = [
        (0.000, 0.0580), (r, 0.0580), (r, 0.0580 + h * 0.55),
        (r * 0.93, 0.0580 + h * 0.82), (r * 0.58, 0.0580 + h),
        (0.000, 0.0580 + h),
    ]
    obj = lathe(name + '_BrassBody', prof, segments=64, axis='Z',
                mat=brass, coll=coll, smooth_angle=35)
    obj.location.x = x
    obj.location.y = y
    # dark inset dot on top
    disc = cylinder(name + '_Inlay', r * 0.5, 0.0012,
                    (x, y, 0.0582 + h), mat=navy_deep, coll=coll,
                    vertices=48, bevel=0.0005)
    # little ivory index mark
    mark = cylinder(name + '_Index', r * 0.11, 0.0017,
                    (x, y + r * 0.65, 0.0585 + h), mat=ivory,
                    coll=coll, vertices=16, bevel=0.0002)
    return obj

control_knob('Speed_Knob', -0.071, -0.126, 0.026, 0.017, base_coll)
control_knob('Power_Switch', 0.060, -0.144, 0.014, 0.012, base_coll)

# Brass maker's plate on the base front.
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.205, 0.0295))
plate = bpy.context.object
plate.name = 'Base_Nameplate'
plate.dimensions = (0.092, 0.003, 0.018)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
link_to_coll(plate, base_coll)
plate.data.materials.append(brass_soft)
add_bevel(plate, 0.0018, 3, 45)
make_text('Base_Wordmark', 'A U R A', 0.0105, (0, -0.2072, 0.0295),
          (radians(90), 0, 0), navy_deep, base_coll, extrude=0.00035)

# -----------------------------------------------------------------------------
# Stem
# -----------------------------------------------------------------------------

stem_profile = [
    (0.000, 0.052), (0.046, 0.052), (0.039, 0.063),
    (0.030, 0.076), (0.024, 0.105), (0.0215, 0.150),
    (0.021, 0.190), (0.024, 0.225), (0.028, 0.252),
    (0.0235, 0.275), (0.033, 0.293), (0.036, 0.305),
    (0.034, 0.316), (0.000, 0.316),
]
stem = lathe('Stem_Pillar', stem_profile, segments=96, axis='Z',
             mat=navy, coll=base_coll, smooth_angle=38)
stem['design_role'] = 'Fixed turned pillar supporting the oscillating head'
# Brass collars.
collar_profiles = [
    ('Stem_Brass_Base_Collar', [(0.040, 0.055), (0.050, 0.058), (0.048, 0.069),
                                (0.037, 0.076), (0.028, 0.076), (0.028, 0.055)]),
    ('Stem_Brass_Mid_Bead', [(0.0215, 0.162), (0.028, 0.166), (0.028, 0.177),
                             (0.0215, 0.181)]),
    ('Stem_Brass_Upper_Collar', [(0.025, 0.262), (0.032, 0.266), (0.032, 0.281),
                                 (0.025, 0.286)]),
]
for nm, prof in collar_profiles:
    # closed profile ring: revolve a closed polygon
    p = prof + [prof[0]]
    obj = lathe(nm, p, segments=96, axis='Z', mat=brass, coll=base_coll,
                smooth_angle=45)
# Top swivel bearing (fixed lower half).
fixed_bearing = lathe(
    'Stem_Swivel_Bearing',
    [(0.000, 0.301), (0.045, 0.301), (0.049, 0.310), (0.048, 0.325),
     (0.041, 0.333), (0.028, 0.338), (0.000, 0.338)],
    segments=96, axis='Z', mat=brass_soft, coll=base_coll, smooth_angle=32)

# -----------------------------------------------------------------------------
# Head hierarchy
# -----------------------------------------------------------------------------

head_z = 0.460
yaw = bpy.data.objects.new('Head_Yaw_Pivot', None)
head_coll.objects.link(yaw)
yaw.empty_display_type = 'SINGLE_ARROW'
yaw.empty_display_size = 0.085
yaw.location = (0, 0, 0.335)

rotor = bpy.data.objects.new('Blade_Rotor', None)
head_coll.objects.link(rotor)
rotor.empty_display_type = 'CIRCLE'
rotor.empty_display_size = 0.17
rotor.location = (0, 0.0, head_z)
parent_keep_transform(rotor, yaw)

# Shroud ring, axis Y.
shroud_profile = [
    (0.202, -0.020), (0.202, 0.040), (0.198, 0.064),
    (0.188, 0.076), (0.174, 0.073), (0.166, 0.058),
    (0.166, -0.040), (0.174, -0.058), (0.189, -0.066),
    (0.202, -0.051), (0.202, -0.020),
]
shroud = lathe('Head_Shroud', shroud_profile, segments=128, axis='Y',
               mat=navy, coll=head_coll, smooth_angle=38)
shroud.location.z = head_z
parent_keep_transform(shroud, yaw)
shroud['design_role'] = 'Deep navy outer barrel with a brass front/rear rim'

for i, (ypos, mat, nm) in enumerate([
        (-0.059, brass, 'Head_Front_Trim_Ring'),
        (0.074, brass_soft, 'Head_Rear_Trim_Ring'),
        (0.010, brass_dark, 'Head_Mid_Band')]):
    ring = torus(nm, 0.198 if i < 2 else 0.2032,
                 0.0026 if i < 2 else 0.0022,
                 (0, ypos, head_z), rotation=(pi/2, 0, 0),
                 mat=mat, coll=head_coll, major_segments=128, minor_segments=8)
    parent_keep_transform(ring, yaw)

# Fasteners on front rim.
for i in range(8):
    a = 2 * pi * i / 8 + pi / 8
    x = 0.179 * cos(a)
    z = head_z + 0.179 * sin(a)
    bolt = cylinder('Shroud_Bolt_%02d' % i, 0.0042, 0.0043,
                    (x, -0.0655, z), rotation=(pi / 2, 0, 0),
                    mat=brass, coll=head_coll, vertices=24, bevel=0.0007)
    parent_keep_transform(bolt, yaw)

# Rear motor housing, axis Y.
motor_profile = [
    (0.000, 0.055), (0.070, 0.055), (0.084, 0.064),
    (0.089, 0.088), (0.089, 0.122), (0.083, 0.153),
    (0.068, 0.174), (0.040, 0.189), (0.000, 0.193),
]
motor = lathe('Rear_Motor_Drum', motor_profile, segments=96, axis='Y',
              mat=navy_deep, coll=head_coll, smooth_angle=35)
motor.location.z = head_z
parent_keep_transform(motor, yaw)
motor_ring = torus('Motor_Brass_Band', 0.0865, 0.0025, (0, 0.112, head_z),
                   rotation=(pi/2, 0, 0), mat=brass_soft, coll=head_coll,
                   major_segments=96, minor_segments=8)
parent_keep_transform(motor_ring, yaw)
rear_cap = lathe(
    'Rear_Brass_Cap',
    [(0.000, 0.205), (0.016, 0.204), (0.029, 0.200), (0.039, 0.194),
     (0.044, 0.187), (0.030, 0.184), (0.000, 0.184)],
    segments=64, axis='Y', mat=brass, coll=head_coll, smooth_angle=32)
rear_cap.location.z = head_z
parent_keep_transform(rear_cap, yaw)
# Concentric rear disc detail.
rear_disc = lathe(
    'Rear_Cap_Inlay',
    [(0.000, 0.206), (0.018, 0.206), (0.019, 0.203),
     (0.014, 0.200), (0.000, 0.200)],
    segments=64, axis='Y', mat=navy_deep, coll=head_coll, smooth_angle=32)
rear_disc.location.z = head_z
parent_keep_transform(rear_disc, yaw)
# Brass trim and screws around the motor's rear shoulder.
rear_shoulder = torus('Rear_Shoulder_Ring', 0.060, 0.0022,
                      (0, 0.181, head_z), rotation=(pi / 2, 0, 0),
                      mat=brass_soft, coll=head_coll,
                      major_segments=96, minor_segments=8)
parent_keep_transform(rear_shoulder, yaw)
for i in range(6):
    a = 2 * pi * i / 6 + pi / 6
    scr = cylinder('Rear_Shoulder_Screw_%d' % i, 0.0032, 0.0030,
                   (0.070 * cos(a), 0.171, head_z + 0.070 * sin(a)),
                   rotation=(pi / 2, 0, 0), mat=brass_soft,
                   coll=head_coll, vertices=20, bevel=0.0004)
    parent_keep_transform(scr, yaw)

# Side pivot caps and brass bearing rings.
for sign in (-1, 1):
    xpos = sign * 0.211
    cap = lathe(
        'Head_Side_Cap_%s' % ('L' if sign < 0 else 'R'),
        [(0.000, xpos - 0.019 if sign > 0 else xpos + 0.019),
         (0.030, xpos - 0.019 if sign > 0 else xpos + 0.019),
         (0.037, xpos - 0.012 if sign > 0 else xpos + 0.012),
         (0.038, xpos + 0.003 if sign > 0 else xpos - 0.003),
         (0.032, xpos + 0.011 if sign > 0 else xpos - 0.011),
         (0.000, xpos + 0.011 if sign > 0 else xpos - 0.011)],
        segments=64, axis='X', mat=brass, coll=head_coll, smooth_angle=35)
    cap.location = (0, 0.008, head_z)
    parent_keep_transform(cap, yaw)
    rr = torus('Head_Side_Ring_%s' % ('L' if sign < 0 else 'R'),
               0.033, 0.0023, (sign * 0.224, 0.006, head_z),
               rotation=(0, pi / 2, 0), mat=brass_soft, coll=head_coll,
               major_segments=64, minor_segments=8)
    parent_keep_transform(rr, yaw)

# -----------------------------------------------------------------------------
# Yoke, rotating with head
# -----------------------------------------------------------------------------

for sign in (-1, 1):
    pts = [
        (sign * 0.016, 0.018, 0.342),
        (sign * 0.065, 0.055, 0.351),
        (sign * 0.125, 0.074, 0.381),
        (sign * 0.180, 0.064, 0.420),
        (sign * 0.207, 0.028, 0.449),
        (sign * 0.212, 0.008, 0.460),
    ]
    tube = add_curve_tube('Yoke_Arm_%s' % ('L' if sign < 0 else 'R'),
                          pts, 0.0072, brass, head_coll, resolution=24,
                          bevel_res=4, spline_type='BEZIER')
    parent_keep_transform(tube, yaw)

yoke_hub = lathe(
    'Yoke_Brass_Hub',
    [(0.000, 0.328), (0.040, 0.328), (0.044, 0.334), (0.044, 0.346),
     (0.032, 0.354), (0.024, 0.358), (0.000, 0.358)],
    segments=64, axis='Z', mat=brass, coll=head_coll, smooth_angle=32)
parent_keep_transform(yoke_hub, yaw)
# A tiny set screw on the swivel.
setscrew = cylinder('Yoke_Set_Screw', 0.004, 0.012,
                    (0.043, 0.0, 0.338), rotation=(0, pi / 2, 0),
                    mat=brass_dark, coll=head_coll, vertices=24,
                    bevel=0.0005)
parent_keep_transform(setscrew, yaw)

# -----------------------------------------------------------------------------
# Blades
# -----------------------------------------------------------------------------

blade_objs = []
for i, base_angle in enumerate((radians(90), radians(210), radians(330))):
    blade = blade_mesh('Blade_%02d' % (i + 1), base_angle,
                       navy_blade, brass, head_coll, head_z=head_z,
                       blade_y=-0.014)
    parent_keep_transform(blade, rotor)
    blade_objs.append(blade)

# Rotor hub: dark inner disc + brass spinner.
hub_profile = [
    (0.000, -0.077), (0.016, -0.076), (0.029, -0.070),
    (0.036, -0.059), (0.040, -0.043), (0.043, -0.018),
    (0.045, 0.006), (0.038, 0.019), (0.000, 0.024),
]
hub = lathe('Rotor_Hub', hub_profile, segments=96, axis='Y',
            mat=brass, coll=head_coll, smooth_angle=32)
hub.location.z = head_z
parent_keep_transform(hub, rotor)
hub_band = torus('Rotor_Hub_Band', 0.042, 0.0021, (0, -0.020, head_z),
                 rotation=(pi/2, 0, 0), mat=navy_deep, coll=head_coll,
                 major_segments=96, minor_segments=8)
parent_keep_transform(hub_band, rotor)
spinner_disc = lathe(
    'Rotor_Spinner_Inlay',
    [(0.000, -0.073), (0.018, -0.072), (0.024, -0.067), (0.022, -0.062),
     (0.000, -0.062)],
    segments=64, axis='Y', mat=navy, coll=head_coll, smooth_angle=30)
spinner_disc.location.z = head_z
parent_keep_transform(spinner_disc, rotor)

# -----------------------------------------------------------------------------
# Front guard
# -----------------------------------------------------------------------------

front_rings = [
    (0.164, -0.070), (0.132, -0.084), (0.101, -0.100),
    (0.070, -0.116), (0.039, -0.130),
]
for i, (rad, ypos) in enumerate(front_rings):
    ring = torus('Front_Guard_Ring_%d' % (i + 1), rad, 0.0020,
                 (0, ypos, head_z), rotation=(pi / 2, 0, 0),
                 mat=brass, coll=head_coll, major_segments=128,
                 minor_segments=8)
    parent_keep_transform(ring, yaw)

ring_r = [r for r, y in front_rings] + [0.020]
ring_y = [y for r, y in front_rings] + [-0.140]
for i in range(12):
    a = 2 * pi * i / 12
    pts = [(r * cos(a), y, head_z + r * sin(a))
           for r, y in zip(ring_r, ring_y)]
    rad = 0.00225 if i % 3 == 0 else 0.00125
    spoke = add_curve_tube('Front_Guard_Spoke_%02d' % i, pts, rad,
                           brass, head_coll, resolution=8,
                           bevel_res=2, spline_type='NURBS')
    parent_keep_transform(spoke, yaw)

# Center badge: brass ring, dark inset, small brass dome.
badge_outer = lathe(
    'Front_Badge_Brass',
    [(0.000, -0.145), (0.028, -0.145), (0.031, -0.149),
     (0.029, -0.155), (0.020, -0.158), (0.000, -0.158)],
    segments=64, axis='Y', mat=brass, coll=head_coll, smooth_angle=32)
badge_outer.location.z = head_z
parent_keep_transform(badge_outer, yaw)
badge_inset = lathe(
    'Front_Badge_Inlay',
    [(0.000, -0.155), (0.021, -0.155), (0.022, -0.159),
     (0.018, -0.163), (0.000, -0.163)],
    segments=64, axis='Y', mat=navy_deep, coll=head_coll, smooth_angle=32)
badge_inset.location.z = head_z
parent_keep_transform(badge_inset, yaw)
badge_dot = lathe(
    'Front_Badge_Center',
    [(0.000, -0.160), (0.0075, -0.160), (0.006, -0.165), (0.000, -0.166)],
    segments=48, axis='Y', mat=brass, coll=head_coll, smooth_angle=32)
badge_dot.location.z = head_z
parent_keep_transform(badge_dot, yaw)
# Three tiny brass blade marks on the badge.
for i in range(3):
    a = radians(90 + 120 * i)
    mark = cylinder('Badge_Mark_%d' % i, 0.0022, 0.0010,
                    (0.012 * cos(a), -0.1635, head_z + 0.012 * sin(a)),
                    rotation=(pi / 2, 0, 0), mat=brass_soft,
                    coll=head_coll, vertices=16, bevel=0.0002)
    parent_keep_transform(mark, yaw)

# -----------------------------------------------------------------------------
# Rear guard
# -----------------------------------------------------------------------------

rear_rings = [
    (0.166, 0.070), (0.132, 0.084), (0.100, 0.099),
    (0.070, 0.112), (0.044, 0.124),
]
for i, (rad, ypos) in enumerate(rear_rings):
    ring = torus('Rear_Guard_Ring_%d' % (i + 1), rad, 0.00175,
                 (0, ypos, head_z), rotation=(pi / 2, 0, 0),
                 mat=brass_dark, coll=head_coll, major_segments=128,
                 minor_segments=8)
    parent_keep_transform(ring, yaw)

rear_ring_r = [r for r, y in rear_rings] + [0.045]
rear_ring_y = [y for r, y in rear_rings] + [0.122]
for i in range(10):
    a = 2 * pi * i / 10 + pi / 10
    pts = [(r * cos(a), y, head_z + r * sin(a))
           for r, y in zip(rear_ring_r, rear_ring_y)]
    spoke = add_curve_tube('Rear_Guard_Spoke_%02d' % i, pts, 0.00145,
                           brass_dark, head_coll, resolution=8,
                           bevel_res=2, spline_type='NURBS')
    parent_keep_transform(spoke, yaw)

# -----------------------------------------------------------------------------
# Animation
# -----------------------------------------------------------------------------

scene.render.fps = 24
scene.frame_start = 0
scene.frame_end = 96
scene.frame_current = 0

# Head yaw: left -> right -> left, smooth 4 second cycle.
yaw_keys = [(0, -26.0), (24, 0.0), (48, 26.0), (72, 0.0), (96, -26.0)]
yaw.rotation_mode = 'XYZ'
for f, deg in yaw_keys:
    yaw.rotation_euler = (0, 0, radians(deg))
    yaw.keyframe_insert(data_path='rotation_euler', index=2, frame=f)
def action_fcurves(obj):
    """Yield F-curves across legacy and Blender 5 layered actions."""
    if not (obj.animation_data and obj.animation_data.action):
        return
    act = obj.animation_data.action
    try:
        legacy = act.fcurves
        for fc in legacy:
            yield fc
        if len(legacy):
            return
    except Exception:
        pass
    try:
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    for fc in cb.fcurves:
                        yield fc
    except Exception:
        pass


for fc in action_fcurves(yaw):
    for kp in fc.keyframe_points:
        kp.interpolation = 'BEZIER'
        kp.handle_left_type = 'AUTO_CLAMPED'
        kp.handle_right_type = 'AUTO_CLAMPED'

# Blades: 11 x 120 deg = 1320 deg over the 4 second cycle.
# Because the three blades are identical at 120 deg spacing, the loop is seamless,
# while the five sampled moments show distinct blade orientations.
rotor.rotation_mode = 'XYZ'
rotor.rotation_euler = (0, 0, 0)
rotor.keyframe_insert(data_path='rotation_euler', index=1, frame=0)
for f, deg in [(12, 165), (24, 330), (36, 495), (48, 660),
               (60, 825), (72, 990), (84, 1155), (96, 1320)]:
    rotor.rotation_euler = (0, radians(deg), 0)
    rotor.keyframe_insert(data_path='rotation_euler', index=1, frame=f)
for fc in action_fcurves(rotor):
    for kp in fc.keyframe_points:
        kp.interpolation = 'LINEAR'

# -----------------------------------------------------------------------------
# Studio stage
# -----------------------------------------------------------------------------

# Seamless cyclorama: floor sweeping into a back wall.
x_half = 3.0
profile_yz = [
    (-2.5, 0.0), (-0.2, 0.0), (0.25, 0.004), (0.55, 0.035),
    (0.78, 0.115), (0.95, 0.28), (1.06, 0.52), (1.12, 0.90),
    (1.16, 1.50), (1.18, 2.4),
]
verts = []
faces = []
for y, z in profile_yz:
    for x in (-x_half, x_half):
        verts.append((x, y, z))
for i in range(len(profile_yz) - 1):
    a = i * 2
    b = a + 1
    c = a + 3
    d = a + 2
    faces.append((a, b, c, d))
cyc = bpy.data.meshes.new('Cyclorama_mesh')
cyc.from_pydata(verts, [], faces)
cyc.validate()
cyc_obj = bpy.data.objects.new('Studio_Cyclorama', cyc)
studio_coll.objects.link(cyc_obj)
cyc_obj.data.materials.append(stage_mat)
for p in cyc.polygons:
    p.use_smooth = True
# Ensure normals face toward the product/camera side.
bm = bmesh.new(); bm.from_mesh(cyc)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(cyc); bm.free()

# Engraved oscillation scale on the top of the base.
osc_arc = []
osc_radius = 0.113
for k in range(25):
    a = radians(-31 + 62 * k / 24)
    osc_arc.append((osc_radius * sin(a), -osc_radius * cos(a), 0.0558))
add_curve_tube('Base_Oscillation_Arc', osc_arc, 0.00042, brass_dark,
               base_coll, resolution=4, bevel_res=1, spline_type='POLY')
for k in range(7):
    a = radians(-30 + 10 * k)
    tick_len = 0.0075 if k in (0, 3, 6) else 0.0048
    x = 0.113 * sin(a)
    y = -0.113 * cos(a)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, 0.0559))
    tick = bpy.context.object
    tick.name = 'Base_Oscillation_Tick_%d' % k
    tick.dimensions = (tick_len, 0.00125, 0.0007)
    tick.rotation_euler[2] = a - pi / 2
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    link_to_coll(tick, base_coll)
    tick.data.materials.append(brass_dark)
    add_bevel(tick, 0.0002, 1, 40)

# World: cool ambient for metal reflections.
world = bpy.data.worlds.new('Studio World')
scene.world = world
world.use_nodes = True
nt = world.node_tree
nt.nodes.clear()
out = nt.nodes.new('ShaderNodeOutputWorld')
bg = nt.nodes.new('ShaderNodeBackground')
bg.inputs['Color'].default_value = (0.13, 0.145, 0.17, 1.0)
bg.inputs['Strength'].default_value = 0.8
nt.links.new(bg.outputs['Background'], out.inputs['Surface'])

# -----------------------------------------------------------------------------
# Lighting
# -----------------------------------------------------------------------------


def add_area(name, location, target, energy, size, color, shape='RECTANGLE',
             size_y=None, spp=2):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.color = color
    ld.shape = shape
    ld.size = size
    if size_y is not None:
        ld.size_y = size_y
    obj = bpy.data.objects.new(name, ld)
    studio_coll.objects.link(obj)
    obj.location = location
    direction = Vector(target) - Vector(location)
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return obj

add_area('Key_Softbox', (-1.35, -1.30, 1.55), (0, 0, 0.34), 190,
         1.7, (1.0, 0.84, 0.65), size_y=1.15)
add_area('Fill_Softbox', (1.45, -0.85, 0.85), (0, 0, 0.32), 70,
         1.25, (0.68, 0.82, 1.0), size_y=1.0)
add_area('Rim_Softbox', (0.6, 1.25, 1.7), (0, 0, 0.42), 220,
         0.9, (1.0, 0.89, 0.72), size_y=0.7)
add_area('Top_Softbox', (0.0, 0.05, 2.35), (0, 0, 0.35), 80,
         1.8, (0.92, 0.96, 1.0), shape='DISK')
add_area('Front_Kicker', (0.0, -1.8, 0.25), (0, 0, 0.32), 25,
         1.2, (0.86, 0.92, 1.0), size_y=0.5)

# -----------------------------------------------------------------------------
# Cameras
# -----------------------------------------------------------------------------

def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()


def add_camera(name, loc, target, lens, ortho=False):
    cam = bpy.data.cameras.new(name)
    cam.lens = lens
    cam.sensor_width = 36
    if ortho:
        cam.type = 'ORTHO'
        cam.ortho_scale = 0.8
    obj = bpy.data.objects.new(name, cam)
    studio_coll.objects.link(obj)
    obj.location = loc
    look_at(obj, target)
    return obj

cam_hero = add_camera('Camera_Hero', (0.62, -1.95, 0.70), (0.0, 0.0, 0.330), 60)
cam_anim = add_camera('Camera_Animation', (0.0, -1.92, 0.53), (0.0, 0.01, 0.345), 70)
scene.camera = cam_hero

# -----------------------------------------------------------------------------
# Render setup
# -----------------------------------------------------------------------------

scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 1600
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.image_settings.color_depth = '8'
scene.render.film_transparent = False
scene.render.use_file_extension = True
scene.eevee.taa_render_samples = 64
scene.eevee.use_raytracing = True
try:
    scene.eevee.ray_tracing_method = 'SCREEN'
    scene.eevee.ray_tracing_options.resolution_scale = '1'
    scene.eevee.ray_tracing_options.screen_trace_quality = 1.0
    scene.eevee.ray_tracing_options.trace_max_roughness = 0.65
    scene.eevee.shadow_ray_count = 2
    scene.eevee.shadow_step_count = 8
    scene.eevee.use_shadows = True
    scene.eevee.use_fast_gi = True
    scene.eevee.fast_gi_method = 'GLOBAL_ILLUMINATION'
except Exception as e:
    print('EEVEE setup warning:', e)

scene.view_settings.view_transform = 'AgX'
try:
    scene.view_settings.look = 'None'
except Exception:
    pass
scene.view_settings.exposure = 0.0
scene.view_settings.gamma = 1.0

# -----------------------------------------------------------------------------
# Scene organisation and metadata
# -----------------------------------------------------------------------------

# Group fan into a parent empty for easy transform, keeping base fixed.
fan_root = bpy.data.objects.new('AURA_Desk_Fan', None)
fan_coll.objects.link(fan_root)
fan_root.empty_display_type = 'PLAIN_AXES'
fan_root.empty_display_size = 0.26
for coll in (base_coll, head_coll):
    for child in list(coll.objects):
        if child is fan_root:
            continue
        if child.parent is None:
            parent_keep_transform(child, fan_root)

# Mark base/stand fixed by ensuring no animation data on them.
for obj in base_coll.objects:
    obj.animation_data_clear()

# Selection and display.
bpy.context.view_layer.objects.active = None
bpy.ops.object.select_all(action='DESELECT')
scene.frame_set(0)

# Timeline cues at the evenly spaced review moments.
for f, label in [(0, 'LEFT · cycle start'), (24, 'CENTER'), (48, 'RIGHT · 2 s'),
                 (72, 'CENTER'), (96, 'LEFT · cycle end')]:
    marker = scene.timeline_markers.new(label, frame=f)
    marker.name = label

# Compact edit notes inside the .blend.
notes = bpy.data.texts.new('AURA_Fan_README')
notes.write("AURA oscillating desk fan\n")
notes.write("=========================\n")
notes.write("Scene units: metres. Frame rate 24 fps. Animation range 0-96 frames (4.0 s).\n")
notes.write("\nHierarchy\n")
notes.write("- AURA_Desk_Fan: whole product root (static).\n")
notes.write("- Head_Yaw_Pivot: head oscillation, -26 deg -> +26 deg -> -26 deg.\n")
notes.write("- Blade_Rotor: continuous blade rotation, 1320 deg over the cycle (linear).\n")
notes.write("- Three blade meshes are separate editable objects.\n")
notes.write("\nRendering\n")
notes.write("- Camera_Hero: 1600x1200 product still at frame 18.\n")
notes.write("- Camera_Animation: 1280x1280 review animation camera.\n")
notes.write("- Materials use procedural Principled shaders; no external image textures.\n")
notes.write("\nReview moments: 0, 24, 48, 72, 96 frames (0.0, 1.0, 2.0, 3.0, 4.0 s).\n")

# Add metadata.
scene['design'] = 'AURA premium oscillating desk fan'
scene['materials'] = 'Deep navy enamel, polished satin brass, blue steel blades, rubber'
scene['animation'] = '96 frames @ 24 fps; head sweep -26 to +26 deg; blade rotor 1320 deg'
scene['units'] = 'meters'
fan_root['component_system'] = 'Fixed base/stem; Head_Yaw_Pivot; Blade_Rotor; three curved blades; front/rear guards'

print('Fan build complete')
print('Objects:', len(bpy.data.objects))
print('Head yaw pivot:', yaw.name, 'Rotor:', rotor.name)
print('Blade objects:', [b.name for b in blade_objs])
