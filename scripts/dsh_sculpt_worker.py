"""Persistent native Blender sculpt worker. All bpy work runs on Blender's main thread."""
import argparse
from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
import traceback
import uuid

import bpy
from mathutils import Quaternion, Vector
from bpy_extras import view3d_utils

sys.path.insert(0, str(Path(__file__).parent))
from native_editor import NativeEditor, coordinates, mesh_state, displacement
from editing_feedback import aim_overlay, comparison

parser = argparse.ArgumentParser()
parser.add_argument('--config', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
config = json.loads(Path(args.config).read_text())
root = Path(config['directory'])
BRUSHES = config['brushes']
state = {'revision': 0, 'cursor': 0, 'hashes': [], 'view_id': None, 'closed': False,
         'highlight': True, 'isolate': False}
shared = None
editor = None
last_activity = time.monotonic()
last_recovery = 0


def write_json(path, value):
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False))
    temp.replace(path)


def journal(event, **fields):
    with (root / 'journal.jsonl').open('a') as stream:
        stream.write(json.dumps({'time': time.time(), 'event': event, **fields}) + '\n')


def object_now():
    obj = bpy.context.view_layer.objects.active if config.get('shared') else bpy.data.objects.get(config['object_name'])
    if obj is None or obj.type != 'MESH':
        raise ValueError('Select an existing mesh with blender_scene configure object_name, or blender_sculpt begin object_name. blender_scene inspect lists available objects.')
    return obj


@contextmanager
def viewport():
    window = bpy.context.window_manager.windows[0]
    area = next((a for a in window.screen.areas if a.type == 'VIEW_3D'), None)
    if area is None:
        raise RuntimeError('Keep a 3D Viewport open in the editing Blender window.')
    region = next(r for r in area.regions if r.type == 'WINDOW')
    with bpy.context.temp_override(window=window, area=area, region=region,
                                   space_data=area.spaces.active, region_data=area.spaces.active.region_3d):
        yield area, region, area.spaces.active.region_3d


def mesh_info():
    active = bpy.context.view_layer.objects.active
    if config.get('shared') and (active is None or active.type != 'MESH'):
        return {'object_name': None, 'vertices': 0, 'faces': 0, 'geometry_hash': hashlib.sha256(b'').hexdigest()}
    obj = object_now()
    return {'object_name': obj.name, **mesh_state(obj)}


def recovery():
    global last_recovery
    # copy=True preserves the source filename and writes no per-stroke snapshots.
    bpy.ops.wm.save_as_mainfile(filepath=str(root / 'recovery.blend'), copy=True, check_existing=False)
    last_recovery = time.monotonic()
    journal('recovery', revision=state['revision'])


def surface_hit(point, region, rv):
    mouse = (point[0] * region.width, (1 - point[1]) * region.height)
    origin = view3d_utils.region_2d_to_origin_3d(region, rv, mouse)
    direction = view3d_utils.region_2d_to_vector_3d(region, rv, mouse)
    obj = bpy.context.view_layer.objects.active if config.get('shared') else object_now()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    # Scene.ray_cast can include viewport-hidden objects. Match the visible editor.
    nearest = None
    space = bpy.context.space_data
    for candidate in bpy.context.scene.objects:
        if candidate.type != 'MESH' or not candidate.visible_get(view_layer=bpy.context.view_layer, viewport=space):
            continue
        if state['isolate'] and candidate != obj:
            continue
        evaluated = candidate.evaluated_get(depsgraph)
        if abs(evaluated.matrix_world.determinant()) < 1e-12:
            continue
        inverse = evaluated.matrix_world.inverted()
        hit, location, normal, face = evaluated.ray_cast(inverse @ origin, inverse.to_3x3() @ direction)
        if not hit:
            continue
        location = evaluated.matrix_world @ location
        normal = (evaluated.matrix_world.inverted().transposed().to_3x3() @ normal).normalized()
        distance = (location-origin).length
        if nearest is None or distance < nearest[0]:
            nearest = (distance, candidate, location, normal, face)
    return {'point': list(point[:2]), 'hit': nearest is not None,
            'object_name': nearest[1].name if nearest else None,
            'target': bool(nearest and nearest[1] == obj),
            'location': list(nearest[2]) if nearest else None,
            'normal': list(nearest[3]) if nearest else None, 'face_index': nearest[4] if nearest else None}


def target_evidence(region, rv):
    active = bpy.context.view_layer.objects.active
    if config.get('shared') and (active is None or active.type != 'MESH'):
        return {'object_name': None, 'screen_bounds': None, 'surface_samples': []}
    obj = object_now()
    projected = [view3d_utils.location_3d_to_region_2d(region, rv, obj.matrix_world @ Vector(corner))
                 for corner in obj.bound_box]
    points = [p for p in projected if p is not None]
    if not points:
        return {'object_name': obj.name, 'screen_bounds': None, 'surface_samples': []}
    bounds = [min(p.x for p in points) / region.width, 1 - max(p.y for p in points) / region.height,
              max(p.x for p in points) / region.width, 1 - min(p.y for p in points) / region.height]
    left, top, right, bottom = [max(0, min(1, value)) for value in bounds]
    samples = []
    if right > left and bottom > top:
        for y in (0.5, 0.3, 0.7, 0.1, 0.9):
            for x in (0.5, 0.3, 0.7, 0.1, 0.9):
                hit = surface_hit([left + (right-left)*x, top + (bottom-top)*y], region, rv)
                if hit['target']:
                    samples.append(hit)
                if len(samples) >= 9:
                    break
            if len(samples) >= 9:
                break
    return {'object_name': obj.name, 'screen_bounds': bounds, 'surface_samples': samples}


def observe(refresh=False):
    if refresh:
        # Code can observe several mutations within one timer callback. Flush
        # native sculpt buffers before capturing those synchronous observations.
        if mesh_info()['object_name']:
            object_now().data.update()
        bpy.context.view_layer.update()
        with viewport() as (area, region, rv):
            area.tag_redraw()
            bpy.ops.wm.redraw_timer(type='DRAW_WIN_SWAP', iterations=1)
    with viewport() as (area, region, rv):
        rv.update()
        render = bpy.context.scene.render
        old = (render.filepath, render.resolution_x, render.resolution_y,
               render.resolution_percentage, render.image_settings.file_format)
        view_id = str(uuid.uuid4())
        path = root / ('view-' + view_id + '.png')
        width = min(1024, region.width)
        height = max(1, round(width * region.height / region.width))
        shading = area.spaces.active.shading
        old_shading = (shading.type, shading.color_type)
        old_colors = [(obj, tuple(obj.color)) for obj in bpy.context.scene.objects] if state['highlight'] else []
        try:
            if state['highlight']:
                shading.type, shading.color_type = 'SOLID', 'OBJECT'
                target = object_now()
                for obj, _ in old_colors:
                    obj.color = (1.0, 0.35, 0.06, 1.0) if obj == target else (0.35, 0.39, 0.44, 1.0)
            render.filepath = str(path)
            render.resolution_x, render.resolution_y = width, height
            render.resolution_percentage = 100
            render.image_settings.file_format = 'PNG'
            bpy.ops.render.opengl(write_still=True, view_context=True)
        finally:
            for obj, color in old_colors:
                obj.color = color
            shading.type, shading.color_type = old_shading
            (render.filepath, render.resolution_x, render.resolution_y,
             render.resolution_percentage, render.image_settings.file_format) = old
        state['view_id'] = view_id
        state['view_signature'] = view_signature(rv, region)
        value = {'view_id': view_id, 'revision': state['revision'], 'path': str(path),
                'width': width, 'height': height, 'coordinates': 'normalized, origin top-left',
                'rotation': list(rv.view_rotation), 'location': list(rv.view_location),
                'distance': rv.view_distance, 'projection': rv.view_perspective,
                'highlight': state['highlight'], 'isolate': state['isolate'],
                'display': 'Orange target, gray context; temporary geometry colors' if state['highlight'] else 'Scene viewport appearance',
                'target': target_evidence(region, rv),
                'shading': {key: getattr(shading, key) for key in ('type','light','color_type','show_shadows','show_cavity')},
                'purpose': 'Viewport observation and normalized editing coordinates'}
        state['last_view'] = value
        return value


def view_signature(rv, region):
    active = bpy.context.view_layer.objects.active
    return [*rv.view_rotation, *rv.view_location, rv.view_distance,
            rv.view_perspective, region.width, region.height,
            active.name if active else None, active.mode if active else None,
            *[v for row in rv.perspective_matrix for v in row],
            *([v for row in active.matrix_world for v in row] if active else []),
            history_key() if active and active.type == 'MESH' else None,
            state['revision'], state['isolate'], state['highlight'],
            [(o.name, o.hide_get(), o.hide_viewport, [v for row in o.matrix_world for v in row])
             for o in bpy.context.scene.objects]]


def require_view(command):
    with viewport() as (_, region, rv):
        rv.update()
        if command.get('view_id') != state['view_id'] or state.get('view_signature') != view_signature(rv, region):
            raise ValueError('Stale view_id or changed scene/viewport. Call blender_view and use its returned view_id.')


def preview(command):
    require_view(command)
    obj = object_now()
    if obj.mode != 'SCULPT':
        raise ValueError('Select a mesh in Sculpt Mode before previewing its active brush.')
    snapshot = editor.snapshot()
    if not snapshot['brush']:
        raise ValueError('Configure an installed brush before previewing its gesture.')
    with viewport() as (_, region, rv):
        probes = [surface_hit(point, region, rv) for point in command['points']]
        owner, _ = editor.effective('size')
        if owner.use_locked_size == 'SCENE' and probes[0]['location']:
            factor = 2 if bpy.app.version >= (5,0,0) else 1
            field = 'unprojected_size' if hasattr(owner,'unprojected_size') else 'unprojected_radius'
            center = Vector(probes[0]['location'])
            right = rv.view_rotation @ Vector((1,0,0))
            a = view3d_utils.location_3d_to_region_2d(region,rv,center)
            b = view3d_utils.location_3d_to_region_2d(region,rv,center+right*getattr(owner,field)/factor)
            if a is not None and b is not None:
                snapshot['brush']['radius_pixels'] = (b-a).length
                snapshot['brush']['radius'] = (b-a).length/region.width
                snapshot['brush']['footprint'] = 'Nominal SCENE radius projected at the initial hit depth before pressure/falloff.'
    return {'preview': {'probes': probes, 'start_on_target': probes[0]['target'],
                        'brush': snapshot['brush'], 'symmetry': snapshot['symmetry'],
                        'scope': 'Geometric aiming and nominal brush footprint. Actual deformation is measured after stroke.'},
            'preview_points': command['points']}


def result(image=True, **extra):
    value = {'edit_id': config['edit_id'], 'pid': os.getpid(), 'revision': state['revision'],
             'undo_depth': state['cursor'], 'redo_depth': len(state['hashes']) - state['cursor'] - 1,
             'source_path': config['blend_path'], 'recovery_path': config.get('working_path', str(root / 'recovery.blend')),
             'journal_path': str(root / 'journal.jsonl'), **mesh_info(), 'editor': editor.snapshot(), **extra}
    if image:
        value['view'] = observe()
    return value


def set_view(command):
    with viewport() as (area, region, rv):
        if 'shading' in command:
            shading = area.spaces.active.shading
            permitted = {'type','light','color_type','show_shadows','show_cavity','cavity_type','background_type','studio_light'}
            changes = []
            for key, value in command['shading'].items():
                if key not in permitted:
                    raise ValueError('Viewport shading field: ' + ', '.join(sorted(permitted)))
                prop = shading.bl_rna.properties[key]
                if prop.type == 'BOOLEAN' and not isinstance(value, bool):
                    raise ValueError(key + ' requires a boolean.')
                if prop.type == 'ENUM' and value not in {p.identifier for p in prop.enum_items}:
                    raise ValueError(key + ': ' + ', '.join(p.identifier for p in prop.enum_items))
                if prop.type == 'STRING' and (not isinstance(value, str) or len(value) > 200):
                    raise ValueError(key + ' requires a native studio light name.')
                changes.append((key,value))
            for key, value in changes:
                setattr(shading,key,value)
        if 'highlight' in command:
            state['highlight'] = command['highlight']
        if 'isolate' in command:
            wanted = command['isolate']
            if bool(area.spaces.active.local_view) != wanted:
                bpy.ops.view3d.localview(frame_selected=False)
            state['isolate'] = wanted
        if command.get('preset'):
            bpy.ops.view3d.view_axis(type=command['preset'].upper(), align_active=False)
        if command.get('frame'):
            obj = object_now()
            bounds = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
            rv.view_location = sum(bounds, Vector()) / 8
            right = rv.view_rotation @ Vector((1, 0, 0))
            up = rv.view_rotation @ Vector((0, 1, 0))
            width = max(p.dot(right) for p in bounds) - min(p.dot(right) for p in bounds)
            height = max(p.dot(up) for p in bounds) - min(p.dot(up) for p in bounds)
            rv.view_distance = max(0.01, width, height * region.width / region.height) * 1.1
        if command.get('rotation') is not None:
            rv.view_rotation = Quaternion(command['rotation']).normalized()
        orbit = command.get('orbit', [0, 0])
        if any(orbit):
            yaw = Quaternion(Vector((0, 0, 1)), math.radians(orbit[0]))
            right = rv.view_rotation @ Vector((1, 0, 0))
            pitch = Quaternion(right, math.radians(orbit[1]))
            rv.view_rotation = yaw @ pitch @ rv.view_rotation
        if command.get('zoom') is not None:
            rv.view_distance = max(0.001, min(1e6, rv.view_distance / command['zoom']))
        if command.get('pan') is not None:
            right = rv.view_rotation @ Vector((1, 0, 0))
            up = rv.view_rotation @ Vector((0, 1, 0))
            rv.view_location += (right * command['pan'][0] + up * command['pan'][1]) * rv.view_distance
        if command.get('projection'):
            rv.view_perspective = command['projection']
        active = bpy.context.view_layer.objects.active
        area.spaces.active.overlay.show_overlays = bool(active and active.mode == 'EDIT')
        rv.update()


def stroke(command):
    require_view(command)
    with viewport() as (area, region, rv):
        obj = object_now()
        if obj.mode != 'SCULPT':
            raise ValueError('Editing mode changed in Blender. Restore Sculpt Mode or discard the session.')
        before = mesh_info()
        before_coords = coordinates(obj)
        # Replay the same screen-space gesture that Blender receives from a mouse/tablet.
        # Drag endpoints may leave the surface after a valid initial contact.
        points = command['points']
        anchor = surface_hit(points[0], region, rv)
        if not anchor['target']:
            raise ValueError('Start the stroke on the selected visible mesh; its drag endpoint may leave the surface.')
        before_view = state.get('last_view')
        if not editor.groups().get('brush') and not command.get('brush'):
            editor.activate('draw')
        editor.configure(command)
        brush = bpy.context.tool_settings.sculpt.brush
        size_owner, _ = editor.effective('size')
        elems = []
        hits = 0
        for i, point in enumerate(points):
            mouse = (point[0] * region.width, (1 - point[1]) * region.height)
            hit = surface_hit(point, region, rv)
            if hit['target']:
                hits += 1
            elems.append({'name': 'dsh', 'mouse': mouse, 'mouse_event': mouse,
                          'location': tuple(obj.matrix_world.inverted() @ Vector(anchor['location'])),
                          'pressure': point[2] if len(point) == 3 else 1.0,
                          'size': float(size_owner.size), 'time': i * 0.04, 'is_start': i == 0,
                          'x_tilt': 0.0, 'y_tilt': 0.0})
        # Blender's paint_stroke exec re-raycasts every sample when override_location=True.
        # Its native drag brushes accept off-surface mouse events and object-local locations.
        # Match paint_brush_type_require_location in Blender's paint_stroke.cc.
        brush_type = getattr(brush, 'sculpt_brush_type', getattr(brush, 'sculpt_tool', ''))
        drag = brush_type in {'GRAB', 'ELASTIC_DEFORM', 'POSE', 'BOUNDARY', 'ROTATE', 'SNAKE_HOOK', 'THUMB', 'CLOTH'}
        operation = bpy.ops.sculpt.brush_stroke(stroke=elems, override_location=not drag,
                      mode='INVERT' if command.get('invert') else 'NORMAL')
        if 'FINISHED' not in operation:
            raise RuntimeError('Blender cancelled the native brush stroke.')
        bpy.ops.ed.undo_push(message='DSH sculpt stroke')
        after = mesh_info()
        state['hashes'] = state['hashes'][:state['cursor'] + 1] + [history_key(after)]
        state['cursor'] += 1
        if len(state['hashes']) > 65:
            state['hashes'] = state['hashes'][-65:]
            state['cursor'] = 64
        state['revision'] += 1
        state['view_id'] = None
        radius = editor.snapshot()['brush']['radius'] or 0
        bounds = [min(p[0] for p in points)-radius, min(p[1] for p in points)-radius*region.width/region.height,
                  max(p[0] for p in points)+radius, max(p[1] for p in points)+radius*region.width/region.height]
        delta = displacement(before_coords, obj, region, rv)
        if delta.get('screen_bounds'):
            for i in (0,1):
                bounds[i] = min(bounds[i],delta['screen_bounds'][i])
                bounds[i+2] = max(bounds[i+2],delta['screen_bounds'][i+2])
        return {'changed': history_key(before) != history_key(after),
                'geometry_changed': (before['geometry_hash'], before.get('topology_hash')) != (after['geometry_hash'], after.get('topology_hash')),
                'attributes_changed': before.get('attributes_hash') != after.get('attributes_hash'),
                'brush': brush.name, 'surface_hits': hits, 'sample_count': len(points),
                'displacement': delta, 'before_view': before_view, 'detail_bounds': bounds,
                'effect': 'geometry' if before['geometry_hash'] != after['geometry_hash'] else
                          ('attributes' if before.get('attributes_hash') != after.get('attributes_hash') else 'no_change')}


def history_key(info=None):
    info = info or mesh_info()
    return info['geometry_hash'] + ':' + info.get('topology_hash', '') + ':' + info.get('attributes_hash', '')


def history(action):
    direction = -1 if action == 'undo' else 1
    target = state['cursor'] + direction
    if target < 0 or target >= len(state['hashes']):
        raise ValueError('No ' + action + ' step available.')
    with viewport():
        op = bpy.ops.ed.undo if action == 'undo' else bpy.ops.ed.redo
        # Asset activation can add native undo entries. Walk to the preceding stroke boundary.
        for _ in range(16):
            if not op.poll():
                break
            op()
            if history_key() == state['hashes'][target]:
                state['cursor'] = target
                state['revision'] += 1
                return
    raise RuntimeError('Native undo boundary unavailable. Recover from recovery.blend or discard.')


def execute(command):
    if shared:
        return shared.execute(command)
    action = command['action']
    extra = {}
    if action in ('brushes', 'settings'):
        extra = getattr(editor, 'catalog' if action == 'brushes' else 'settings')(**{k: command[k] for k in ('query', 'offset', 'limit', *(['group'] if action == 'settings' else [])) if k in command})
    elif action == 'configure':
        with viewport():
            extra['editor'] = editor.configure(command)
    elif action == 'stroke':
        extra = stroke(command)
    elif action == 'preview':
        extra = preview(command)
    elif action in ('undo', 'redo'):
        history(action)
    elif action == 'view':
        set_view(command)
        if command.get('probe_points'):
            with viewport() as (_, region, rv):
                extra['probes'] = [surface_hit(point, region, rv) for point in command['probe_points']]
    elif action == 'commit':
        path = Path(command['save_path'])
        if path.exists() and not command.get('allow_overwrite'):
            raise ValueError('save_path already exists; choose a new path or allow_overwrite.')
        with viewport():
            set_view({'isolate': False})
            bpy.ops.object.mode_set(mode='OBJECT')
            bpy.ops.wm.save_as_mainfile(filepath=str(path), check_existing=False)
        state['closed'] = True
        return result(image=False, closed=True, saved_path=str(path), bytes=path.stat().st_size)
    elif action == 'discard':
        state['closed'] = True
        return result(image=False, closed=True, discarded=True)
    elif action == 'suspend':
        recovery()
        state['closed'] = True
        return result(image=False, closed=True, suspended=True)
    elif action != 'status':
        raise ValueError('Unknown sculpt action: ' + action)
    return result(image=False, **extra)


def capture_result(value, refresh=False):
    value['view'] = observe(refresh=refresh)
    before = value.pop('before_view', None)
    bounds = value.pop('detail_bounds', None)
    points = value.pop('preview_points', None)
    view = value['view']
    if before:
        value['feedback'] = comparison(before, view, bounds, root / ('detail-' + view['view_id'] + '.png'))
    elif points:
        value['feedback'] = aim_overlay(view, value['preview']['probes'],
            root / ('aim-' + view['view_id'] + '.png'), points, value['preview']['brush']['radius'])
    elif value.get('probes'):
        value['feedback'] = aim_overlay(view, value['probes'], root / ('probe-' + view['view_id'] + '.png'))
    return value


def deliver(path, request, response, capture=False):
    """Capture after Blender's event loop has refreshed sculpt GPU buffers."""
    if capture:
        try:
            response['value'] = capture_result(response['value'])
        except Exception as error:
            # Execution succeeded. Preserve its evidence so retries cannot repeat a mutation.
            response['value']['observation_error'] = str(error)
            response['value']['observation_recovery'] = 'Use blender_view to refresh the observation.'
            response['value'].pop('before_view', None)
            response['value'].pop('detail_bounds', None)
            response['value'].pop('preview_points', None)
            if not response['value'].get('view'):
                state['view_id'] = None
            journal('capture-error', error=str(error))
    write_json(root / 'responses' / path.name, response)
    path.unlink()
    if state['closed']:
        bpy.app.timers.register(shutdown, first_interval=0.5)
    else:
        bpy.app.timers.register(tick, first_interval=0.1)
    return None


def shutdown():
    bpy.ops.wm.quit_blender()
    return None


def tick():
    global last_activity
    try:
        os.kill(config['parent_pid'], 0)
    except OSError:
        recovery()
        journal('parent-exit')
        return shutdown()
    if time.monotonic() - last_activity > config['idle_seconds']:
        recovery()
        journal('idle-exit')
        return shutdown()
    if state['revision'] and time.monotonic() - last_recovery > 60:
        recovery()
    for path in sorted((root / 'requests').glob('*.json'))[:1]:
        last_activity = time.monotonic()
        request = json.loads(path.read_text())
        try:
            value = execute(request['command'])
            response = {'ok': True, 'value': value}
            journal('command', request_id=request['id'], action=request['command']['action'], revision=state['revision'])
        except Exception as error:
            response = {'ok': False, 'error': str(error)}
            journal('error', request_id=request['id'], error=str(error), traceback=traceback.format_exc())
        capture = response['ok'] and not state['closed'] and request['command']['action'] != 'render' and request['command'].get('observe', True)
        if response['ok'] and not capture:
            for internal in ('before_view','detail_bounds','preview_points'):
                response['value'].pop(internal, None)
        if capture:
            if mesh_info()['object_name']:
                object_now().data.update()
            bpy.context.view_layer.update()
            with viewport() as (area, region, rv):
                area.tag_redraw()
        bpy.app.timers.register(lambda: deliver(path, request, response, capture), first_interval=0.15)
        return None
    return 0.1


def initialize():
    global last_activity, shared, editor
    try:
        if bpy.app.background:
            raise RuntimeError('Native viewport sculpting requires a windowed Blender graphics context.')
        editor = NativeEditor(viewport, BRUSHES)
        if config.get('shared'):
            sys.path.insert(0, str(Path(__file__).parent))
            from shared_scene_runtime import SharedScene
            shared = SharedScene(globals())
            shared.initialize()
            value = shared.execute({'action': 'status'})
            value['view'] = observe()
            write_json(root / 'ready.json', {'ok': True, 'value': value})
            last_activity = time.monotonic()
            bpy.app.timers.register(tick, first_interval=0.1)
            return None
        with viewport() as (area, region, rv):
            if bpy.context.object and bpy.context.object.mode != 'OBJECT':
                bpy.ops.object.mode_set(mode='OBJECT')
            bpy.ops.object.select_all(action='DESELECT')
            obj = object_now()
            if obj.hide_get() or obj.hide_viewport:
                raise ValueError('Choose a visible mesh object.')
            if any(m.type == 'MULTIRES' for m in obj.modifiers):
                raise ValueError('This first sculpt interface supports base meshes. Apply or remove Multires before begin.')
            if obj.data.shape_keys:
                raise ValueError('This first sculpt interface supports base meshes without Shape Keys. Prepare a separate base mesh before begin.')
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            bpy.context.preferences.edit.use_global_undo = True
            bpy.context.preferences.edit.undo_steps = 256
            bpy.context.preferences.view.smooth_view = 0
            bpy.ops.object.mode_set(mode='SCULPT')
            if obj.use_dynamic_topology_sculpting:
                raise ValueError('Disable Dynamic Topology before begin; this interface preserves mesh topology.')
            set_view({'preset': config.get('preset', 'front'), 'frame': True, 'projection': 'ORTHO',
                      'highlight': config.get('highlight', True), 'isolate': config.get('isolate', False)})
            rv.view_distance *= 1.15
            rv.update()
            state['hashes'] = [history_key()]
            bpy.ops.ed.undo_push(message='DSH sculpt session base')
            recovery()
            write_json(root / 'ready.json', {'ok': True, 'value': result()})
        last_activity = time.monotonic()
        bpy.app.timers.register(tick, first_interval=0.1)
    except Exception as error:
        write_json(root / 'ready.json', {'ok': False, 'error': str(error), 'traceback': traceback.format_exc()})
        bpy.app.timers.register(shutdown, first_interval=0.5)
    return None

bpy.app.timers.register(initialize, first_interval=2.0)
