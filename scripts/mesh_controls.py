"""Native Edit Mode selection, transforms and region extrusion.

Screen selection uses Blender's own visibility and selection handling. Geometry
and selection remain in the live Edit Mode context across calls.
"""
import math
import bpy
import bmesh
from native_editor import coordinates, mesh_state, displacement

MESH_ACTIONS = {'mesh_select', 'mesh_transform', 'mesh_extrude'}


def execute(shared, command):
    operation = command['operation']
    if operation == 'mesh_select' and command.get('selection_box') is not None:
        shared.host['require_view'](command)
    obj = shared.active()
    name = command.get('object_name')
    if name and (obj is None or obj.name != name):
        if command.get('selection_box') is not None:
            raise ValueError('Select the target object and observe it before screen-space mesh selection.')
        shared.select(name, frame=False)
        obj = shared.active()
    if obj is None or obj.type != 'MESH' or not obj.visible_get():
        raise ValueError('Select a visible mesh before using Edit Mode controls.')
    if obj.mode != 'EDIT':
        shared.object_mode()
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode='EDIT')
    obj.update_from_editmode()
    before = mesh_state(obj)
    before_coordinates = coordinates(obj)
    with shared.host['viewport']() as (area, region, rv):
        area.spaces.active.overlay.show_overlays = True
        if operation == 'mesh_select':
            mode = command.get('selection_mode', 'VERT')
            if mode not in {'VERT','EDGE','FACE'}:
                raise ValueError('selection_mode: VERT, EDGE or FACE.')
            bpy.ops.mesh.select_mode(type=mode)
            action = command.get('selection_action', 'replace')
            if action in {'all','none'}:
                bpy.ops.mesh.select_all(action='SELECT' if action == 'all' else 'DESELECT')
            else:
                box = command.get('selection_box')
                if (not isinstance(box,list) or len(box) != 4 or
                    any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or not 0 <= v <= 1 for v in box) or
                    box[0] >= box[2] or box[1] >= box[3]):
                    raise ValueError('selection_box requires normalized [left,top,right,bottom] with positive width and height.')
                if action not in {'replace','add','subtract'}:
                    raise ValueError('selection_action: replace, add, subtract, all or none.')
                if action == 'replace':
                    bpy.ops.mesh.select_all(action='DESELECT')
                shading = area.spaces.active.shading
                old = shading.show_xray, shading.show_xray_wireframe
                try:
                    shading.show_xray = shading.show_xray_wireframe = bool(command.get('select_through',False))
                    # Refresh the selection buffer after the mode/selection change.
                    bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)
                    # redraw_timer may replace the transient region override.
                    with shared.host['viewport']() as (_, region, _):
                        result = bpy.ops.view3d.select_box(xmin=round(box[0]*region.width),
                            xmax=round(box[2]*region.width), ymin=round((1-box[3])*region.height),
                            ymax=round((1-box[1])*region.height), wait_for_input=False,
                            mode='SUB' if action == 'subtract' else 'ADD')
                    if 'FINISHED' not in result:
                        raise ValueError('Blender cancelled the selection. Refresh the viewport and select a visible region.')
                finally:
                    shading.show_xray, shading.show_xray_wireframe = old
        else:
            mesh = bmesh.from_edit_mesh(obj.data)
            selected = [v for v in mesh.verts if v.select and not v.hide]
            if not selected:
                raise ValueError('Select mesh elements before modifying them.')
            if operation == 'mesh_extrude':
                if not any(f.select and not f.hide for f in mesh.faces):
                    raise ValueError('mesh_extrude uses selected faces; choose selection_mode FACE.')
                value = numeric_vector(command.get('translation'), 'translation')
                if sum(v*v for v in value) < 1e-12:
                    raise ValueError('Extrusion requires a nonzero world-space translation.')
                result = bpy.ops.mesh.extrude_region_move(TRANSFORM_OT_translate={
                    'value': value, 'orient_type': 'GLOBAL', 'use_proportional_edit': False})
                if 'FINISHED' not in result:
                    raise RuntimeError('Blender cancelled the region extrusion.')
            else:
                radius = command.get('proportional_radius')
                if radius is not None and (isinstance(radius,bool) or not isinstance(radius,(int,float)) or
                                          not math.isfinite(radius) or not .00001 <= radius <= 10000):
                    raise ValueError('proportional_radius requires a positive world-space distance up to 10000.')
                falloff = command.get('falloff', 'SMOOTH')
                choices = {p.identifier for p in bpy.ops.transform.translate.get_rna_type().properties['proportional_edit_falloff'].enum_items}
                if falloff not in choices:
                    raise ValueError('falloff: ' + ', '.join(sorted(choices)))
                options = {'orient_type': 'GLOBAL', 'use_proportional_edit': radius is not None,
                           'use_proportional_connected': bool(command.get('connected',False)),
                           'use_proportional_projected': False,
                           'proportional_edit_falloff': falloff, 'proportional_size': radius or 1}
                if not any(k in command for k in ('translation','rotation','scale')):
                    raise ValueError('mesh_transform accepts translation, rotation and/or scale.')
                for key in ('translation','rotation','scale'):
                    if key in command:
                        numeric_vector(command[key],key)
                settings = bpy.context.scene.tool_settings
                pivot = settings.transform_pivot_point
                settings.transform_pivot_point = 'MEDIAN_POINT'
                try:
                    if 'translation' in command:
                        require_finished(bpy.ops.transform.translate(value=command['translation'], **options))
                    if 'rotation' in command:
                        for axis, value in zip('XYZ',command['rotation']):
                            if value:
                                require_finished(bpy.ops.transform.rotate(value=math.radians(value), orient_axis=axis, **options))
                    if 'scale' in command:
                        require_finished(bpy.ops.transform.resize(value=command['scale'], **options))
                finally:
                    settings.transform_pivot_point = pivot
        obj.update_from_editmode()
        mesh = bmesh.from_edit_mesh(obj.data)
        after = mesh_state(obj)
        extra = {} if operation == 'mesh_select' else {
            'geometry_changed': (before['geometry_hash'],before['topology_hash']) != (after['geometry_hash'],after['topology_hash']),
            'mesh_counts': {'before':{k:before[k] for k in ('vertices','faces')},'after':{k:after[k] for k in ('vertices','faces')}},
            'displacement': displacement(before_coordinates,obj,region,rv)}
        return {**extra, 'selection': {key: sum(e.select and not e.hide for e in elements)
                             for key,elements in [('vertices',mesh.verts),('edges',mesh.edges),('faces',mesh.faces)]},
                'mesh_control': {'operation':operation, 'coordinates':'World axes, scene units; rotation in degrees around selection median.'}}


def require_finished(result):
    if 'FINISHED' not in result:
        raise RuntimeError('Blender cancelled the native mesh transform.')


def numeric_vector(value, label):
    if (not isinstance(value,list) or len(value) != 3 or
        any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or abs(v)>10000 for v in value)):
        raise ValueError(label + ' requires three finite numbers in scene units.')
    return value
