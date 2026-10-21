"""Persistent native Blender sculpt worker. All bpy work runs on Blender's main thread."""
import argparse
from array import array
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

parser = argparse.ArgumentParser()
parser.add_argument('--config', required=True)
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
config = json.loads(Path(args.config).read_text())
root = Path(config['directory'])
BRUSHES = {'draw': 'Draw', 'grab': 'Grab', 'smooth': 'Smooth', 'inflate': 'Inflate/Deflate'}
state = {'revision': 0, 'cursor': 0, 'hashes': [], 'view_id': None, 'closed': False}
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
    obj = bpy.data.objects.get(config['object_name'])
    if obj is None or obj.type != 'MESH':
        raise ValueError('The selected mesh is unavailable; discard this editing session.')
    return obj


@contextmanager
def viewport():
    window = bpy.context.window_manager.windows[0]
    area = next((a for a in window.screen.areas if a.type == 'VIEW_3D'), None)
    if area is None:
        raise RuntimeError('Keep a 3D Viewport open in the editing Blender window.')
    region = next(r for r in area.regions if r.type == 'WINDOW')
    with bpy.context.temp_override(window=window, area=area, region=region):
        yield area, region, area.spaces.active.region_3d


def mesh_info():
    obj = object_now()
    coords = array('f', [0.0]) * (len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get('co', coords)
    digest = hashlib.sha256(coords.tobytes()).hexdigest()
    return {'object_name': obj.name, 'vertices': len(obj.data.vertices),
            'faces': len(obj.data.polygons), 'geometry_hash': digest}


def recovery():
    global last_recovery
    # copy=True preserves the source filename and writes no per-stroke snapshots.
    bpy.ops.wm.save_as_mainfile(filepath=str(root / 'recovery.blend'), copy=True, check_existing=False)
    last_recovery = time.monotonic()
    journal('recovery', revision=state['revision'])


def observe():
    with viewport() as (area, region, rv):
        rv.update()
        render = bpy.context.scene.render
        old = (render.filepath, render.resolution_x, render.resolution_y,
               render.resolution_percentage, render.image_settings.file_format)
        view_id = str(uuid.uuid4())
        path = root / ('view-' + view_id + '.png')
        width = min(1024, region.width)
        height = max(1, round(width * region.height / region.width))
        try:
            render.filepath = str(path)
            render.resolution_x, render.resolution_y = width, height
            render.resolution_percentage = 100
            render.image_settings.file_format = 'PNG'
            bpy.ops.render.opengl(write_still=True, view_context=True)
        finally:
            (render.filepath, render.resolution_x, render.resolution_y,
             render.resolution_percentage, render.image_settings.file_format) = old
        state['view_id'] = view_id
        state['view_signature'] = view_signature(rv, region)
        return {'view_id': view_id, 'revision': state['revision'], 'path': str(path),
                'width': width, 'height': height, 'coordinates': 'normalized, origin top-left',
                'rotation': list(rv.view_rotation), 'location': list(rv.view_location),
                'distance': rv.view_distance, 'projection': rv.view_perspective}


def view_signature(rv, region):
    return [*rv.view_rotation, *rv.view_location, rv.view_distance,
            rv.view_perspective, region.width, region.height]


def result(image=True, **extra):
    value = {'edit_id': config['edit_id'], 'pid': os.getpid(), 'revision': state['revision'],
             'undo_depth': state['cursor'], 'redo_depth': len(state['hashes']) - state['cursor'] - 1,
             'source_path': config['blend_path'], 'recovery_path': str(root / 'recovery.blend'),
             'journal_path': str(root / 'journal.jsonl'), **mesh_info(), **extra}
    if image:
        value['view'] = observe()
    return value


def set_view(command):
    with viewport() as (area, region, rv):
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
        area.spaces.active.overlay.show_overlays = False
        rv.update()


def stroke(command):
    with viewport() as (area, region, rv):
        if command.get('view_id') != state['view_id'] or state.get('view_signature') != view_signature(rv, region):
            raise ValueError('Stale view_id or changed viewport. Call blender_view and use its returned view_id.')
        obj = object_now()
        if obj.mode != 'SCULPT':
            raise ValueError('Editing mode changed in Blender. Restore Sculpt Mode or discard the session.')
        before = mesh_info()['geometry_hash']
        asset = BRUSHES[command['brush']]
        bpy.ops.brush.asset_activate(asset_library_type='ESSENTIALS',
            relative_asset_identifier='brushes/essentials_brushes-mesh_sculpt.blend/Brush/' + asset)
        brush = bpy.context.tool_settings.sculpt.brush
        radius = max(1, round(command.get('radius', 0.08) * region.width))
        brush.size = radius
        brush.strength = command.get('strength', 0.5)
        brush.use_frontface = True
        brush.use_locked_size = 'VIEW'
        settings = bpy.context.tool_settings.sculpt
        axes = command.get('symmetry', '')
        for axis in 'xyz':
            setattr(settings, 'use_symmetry_' + axis, axis in axes)
        # Native cursor projection and ray casting keep strokes aligned with the returned viewport.
        points = command['points']
        elems = []
        hits = 0
        depsgraph = bpy.context.evaluated_depsgraph_get()
        for i, point in enumerate(points):
            mouse = (point[0] * region.width, (1 - point[1]) * region.height)
            origin = view3d_utils.region_2d_to_origin_3d(region, rv, mouse)
            direction = view3d_utils.region_2d_to_vector_3d(region, rv, mouse)
            hit, location, normal, face, hit_obj, matrix = bpy.context.scene.ray_cast(depsgraph, origin, direction)
            if hit and hit_obj.original == obj:
                hits += 1
            elems.append({'name': 'dsh', 'mouse': mouse, 'mouse_event': mouse,
                          'location': tuple(location) if hit else (0, 0, 0),
                          'pressure': point[2] if len(point) == 3 else 1.0,
                          'size': float(radius), 'time': i * 0.04, 'is_start': i == 0,
                          'x_tilt': 0.0, 'y_tilt': 0.0})
        if not hits:
            raise ValueError('Stroke misses the selected mesh. Choose points on its visible surface.')
        operation = bpy.ops.sculpt.brush_stroke(stroke=elems, override_location=True,
                      mode='INVERT' if command.get('invert') else 'NORMAL')
        if 'FINISHED' not in operation:
            raise RuntimeError('Blender cancelled the native brush stroke.')
        bpy.ops.ed.undo_push(message='DSH sculpt stroke')
        after = mesh_info()['geometry_hash']
        state['hashes'] = state['hashes'][:state['cursor'] + 1] + [after]
        state['cursor'] += 1
        if len(state['hashes']) > 65:
            state['hashes'] = state['hashes'][-65:]
            state['cursor'] = 64
        state['revision'] += 1
        return {'changed': before != after, 'brush': command['brush'], 'surface_hits': hits}


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
            if mesh_info()['geometry_hash'] == state['hashes'][target]:
                state['cursor'] = target
                state['revision'] += 1
                return
    raise RuntimeError('Native undo boundary unavailable. Recover from recovery.blend or discard.')


def execute(command):
    action = command['action']
    extra = {}
    if action == 'stroke':
        extra = stroke(command)
    elif action in ('undo', 'redo'):
        history(action)
    elif action == 'view':
        set_view(command)
    elif action == 'commit':
        path = Path(command['save_path'])
        if path.exists() and not command.get('allow_overwrite'):
            raise ValueError('save_path already exists; choose a new path or allow_overwrite.')
        with viewport():
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


def deliver(path, request, response, capture=False):
    """Capture after Blender's event loop has refreshed sculpt GPU buffers."""
    if capture:
        try:
            response['value']['view'] = observe()
        except Exception as error:
            response = {'ok': False, 'error': str(error)}
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
        capture = response['ok'] and not state['closed']
        if capture:
            object_now().data.update()
            bpy.context.view_layer.update()
            with viewport() as (area, region, rv):
                area.tag_redraw()
        bpy.app.timers.register(lambda: deliver(path, request, response, capture), first_interval=0.15)
        return None
    return 0.1


def initialize():
    global last_activity
    try:
        if bpy.app.background:
            raise RuntimeError('Native viewport sculpting requires a windowed Blender graphics context.')
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
            set_view({'preset': config.get('preset', 'front'), 'frame': True, 'projection': 'ORTHO'})
            rv.view_distance *= 1.15
            rv.update()
            state['hashes'] = [mesh_info()['geometry_hash']]
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
