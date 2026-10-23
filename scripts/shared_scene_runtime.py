"""Incremental scene operations layered on the native viewport/brush worker."""
from array import array
from contextlib import redirect_stdout, redirect_stderr
import hashlib
import io
import json
from pathlib import Path
import traceback
import uuid
from types import SimpleNamespace

import bpy
import bmesh
import mathutils


class TailOutput(io.StringIO):
    def write(self, text):
        tail = (self.getvalue() + text)[-20000:]
        self.seek(0)
        self.truncate(0)
        super().write(tail)
        return len(text)


class SharedScene:
    def __init__(self, host):
        self.host = host
        self.config, self.state = host['config'], host['state']
        self.root = Path(self.config['directory'])
        self.working = Path(self.config['working_path'])
        self.brush_base = None
        self.last_brush_base = None
        self.state['highlight'] = False
        self.api = SimpleNamespace(inspect=self.inspect, select=self.select,
                                   view=self.view, stroke=self.stroke, render=self.render)

    def target(self):
        obj = bpy.data.objects.get(self.config.get('object_name') or '')
        return obj if obj and obj.type == 'MESH' else None

    def active(self):
        layer = getattr(bpy.context, 'view_layer', None)
        return getattr(bpy.context, 'object', None) or (layer.objects.active if layer else None)

    def object_mode(self):
        if self.active() and self.active().mode != 'OBJECT':
            bpy.ops.object.mode_set(mode='OBJECT')
        if self.state.get('isolate'):
            self.host['set_view']({'isolate': False})

    def save(self, path):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_as_mainfile(filepath=str(path), copy=True, check_existing=False)
        return {'saved_path': str(path), 'bytes': path.stat().st_size}

    def persist(self):
        self.save(self.working)
        manifest = {'scene_id': self.config['edit_id'], 'revision': self.state['revision'],
                    'working_path': str(self.working), 'active_object': self.active().name if self.active() else None,
                    'mode': self.active().mode if self.active() else 'OBJECT'}
        self.host['write_json'](self.root / 'state.json', manifest)

    def reset_history(self):
        self.state['view_id'] = None
        self.state['hashes'] = [self.host['mesh_info']()['geometry_hash']]
        self.state['cursor'] = 0

    def initialize(self):
        if not self.config.get('blend_path'):
            self.object_mode()
            for obj in list(bpy.data.objects):
                bpy.data.objects.remove(obj, do_unlink=True)
        self.object_mode()
        bpy.context.preferences.edit.use_global_undo = True
        bpy.context.preferences.edit.undo_steps = 256
        self.config['object_name'] = None
        self.host['set_view']({'preset': self.config.get('preset', 'front'), 'projection': 'ORTHO'})
        with self.host['viewport']() as (_, _, rv):
            rv.view_distance = 6
            if bpy.context.scene.objects:
                bpy.ops.view3d.view_all(center=False)
        self.reset_history()
        self.persist()

    def signatures(self):
        signatures = {}
        for obj in bpy.context.scene.objects:
            digest = hashlib.sha256()
            digest.update(repr((obj.type, list(obj.matrix_world), obj.hide_viewport, obj.hide_render)).encode())
            if obj.type == 'MESH':
                coords = array('f', [0.0]) * (len(obj.data.vertices) * 3)
                obj.data.vertices.foreach_get('co', coords)
                indices = array('i', [0]) * len(obj.data.loops)
                obj.data.loops.foreach_get('vertex_index', indices)
                digest.update(coords.tobytes())
                digest.update(indices.tobytes())
                digest.update(repr([(m.type, m.name) for m in obj.modifiers]).encode())
                for slot in obj.material_slots:
                    mat = slot.material
                    if not mat:
                        continue
                    digest.update(repr((mat.name, tuple(mat.diffuse_color))).encode())
                    if mat.use_nodes:
                        for node in mat.node_tree.nodes:
                            digest.update(repr((node.name, node.type)).encode())
                            for socket in node.inputs:
                                if hasattr(socket, 'default_value'):
                                    digest.update(repr((socket.name, socket.default_value[:]
                                                       if hasattr(socket.default_value, '__len__') else socket.default_value)).encode())
            signatures[obj.name] = digest.hexdigest()
        return signatures

    def inspect(self, object_names=None, limit=40):
        limit = max(1, min(200, int(limit)))
        objects = [bpy.data.objects.get(name) for name in object_names] if object_names else list(bpy.context.scene.objects)
        items = []
        for obj in objects[:limit]:
            if obj is None:
                continue
            mesh = obj.type == 'MESH'
            items.append({'name': obj.name, 'type': obj.type, 'location': list(obj.location),
                          'dimensions': list(obj.dimensions), 'scale': list(obj.scale),
                          'vertices': len(obj.data.vertices) if mesh else None,
                          'faces': len(obj.data.polygons) if mesh else None,
                          'visible': obj.visible_get(), 'selected': obj.select_get(),
                          'materials': [s.material.name if s.material else None for s in obj.material_slots],
                          'modifiers': [{'name': m.name, 'type': m.type} for m in obj.modifiers],
                          'sculpt_prerequisites': {'base_mesh': mesh,
                              'shape_keys': bool(obj.data.shape_keys) if mesh else False,
                              'multires': any(m.type == 'MULTIRES' for m in obj.modifiers)}})
        return {'object_count': len(bpy.context.scene.objects), 'objects': items,
                'truncated': len(objects) > limit,
                'active_object': self.active().name if self.active() else None,
                'mode': self.active().mode if self.active() else 'OBJECT'}

    def select(self, object_name, sculpt=False, **view_options):
        obj = bpy.data.objects.get(object_name)
        if obj is None:
            raise ValueError('Object not found: ' + str(object_name) + '. Inspect the scene for exact names.')
        if sculpt:
            if obj.type != 'MESH' or obj.hide_get() or obj.hide_viewport:
                raise ValueError('Choose a visible mesh for native brushes.')
            if any(m.type == 'MULTIRES' for m in obj.modifiers) or obj.data.shape_keys:
                raise ValueError('Prepare the base mesh: apply/remove Multires and resolve Shape Keys before brushing.')
            if obj.use_dynamic_topology_sculpting:
                raise ValueError('Disable Dynamic Topology to use this fixed-topology brush interface.')
        self.object_mode()
        if sculpt:
            self.brush_base = self.root / ('brush-base-' + str(uuid.uuid4()) + '.blend')
            self.last_brush_base = str(self.brush_base)
            self.save(self.brush_base)
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        self.config['object_name'] = obj.name if obj.type == 'MESH' else None
        if sculpt:
            bpy.ops.object.mode_set(mode='SCULPT')
            bpy.ops.ed.undo_push(message='DSH brush editing base')
        self.state['highlight'] = sculpt
        self.reset_history()
        self.host['set_view']({'frame': True, **view_options})
        return self.inspect([obj.name])

    def view(self, **options):
        if options.get('object_name'):
            self.select(options.pop('object_name'))
        self.host['set_view'](options)
        return self.host['observe']()

    def stroke(self, **options):
        value = self.host['stroke'](options)
        self.persist()
        return value

    def render(self, output_path=None, camera=None, width=768, height=768, samples=32, **_):
        width, height, samples = int(width), int(height), int(samples)
        if not (16 <= width <= 4096 and 16 <= height <= 4096 and 1 <= samples <= 512):
            raise ValueError('Render dimensions: 16..4096; samples: 1..512.')
        scene = bpy.context.scene
        cam = bpy.data.objects.get(camera) if camera else scene.camera
        if not cam or cam.type != 'CAMERA':
            raise ValueError('Choose a scene camera, or use the viewport to observe.')
        self.persist()
        path = Path(output_path or (self.root / ('render-' + str(self.state['revision']) + '.png')))
        workspace = Path(self.config['workspace']).resolve()
        if not path.is_absolute():
            path = workspace / path
        if not path.resolve().is_relative_to(workspace):
            raise ValueError('Render output stays in the workspace.')
        path.parent.mkdir(parents=True, exist_ok=True)
        settings = scene.render
        previous = (scene.camera, settings.filepath, settings.resolution_x, settings.resolution_y,
                    settings.resolution_percentage, settings.image_settings.file_format)
        old_samples = scene.cycles.samples
        old_eevee = scene.eevee.taa_render_samples if hasattr(scene, 'eevee') else None
        try:
            scene.camera = cam
            settings.filepath = str(path)
            settings.resolution_x, settings.resolution_y, settings.resolution_percentage = width, height, 100
            settings.image_settings.file_format = 'PNG'
            scene.cycles.samples = samples
            if old_eevee is not None:
                scene.eevee.taa_render_samples = samples
            bpy.ops.render.render(write_still=True)
        finally:
            (scene.camera, settings.filepath, settings.resolution_x, settings.resolution_y,
             settings.resolution_percentage, settings.image_settings.file_format) = previous
            scene.cycles.samples = old_samples
            if old_eevee is not None:
                scene.eevee.taa_render_samples = old_eevee
        record = {'path': str(path), 'width': width, 'height': height, 'kind': 'render',
                  'scene_id': self.config['edit_id'], 'revision': self.state['revision'], 'camera': cam.name,
                  'scene_sha256': hashlib.sha256(self.working.read_bytes()).hexdigest(),
                  'image_sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        self.host['write_json'](path.with_suffix('.png.json'), record)
        return record

    def python(self, command):
        before = self.signatures()
        recovery = self.root / 'before-python.blend'
        self.save(recovery)
        self.object_mode()
        self.brush_base = None
        self.state['highlight'] = False
        stream = TailOutput()
        namespace = {'bpy': bpy, 'bmesh': bmesh, 'mathutils': mathutils, 'dsh': self.api,
                     'workspace': self.config['workspace'], 'params': command.get('params', {}),
                     '__file__': command.get('tool_path', '<blender_execute>'), '__name__': '__dsh_tool__'}
        source = command.get('tool_source', command.get('script', ''))
        source_hash = hashlib.sha256(source.encode()).hexdigest()
        source_snapshot = self.root / 'executed-code' / (source_hash + '.py')
        source_snapshot.parent.mkdir(exist_ok=True)
        source_snapshot.write_text(source)
        try:
            with redirect_stdout(stream), redirect_stderr(stream):
                with self.host['viewport']():
                    exec(compile(source, namespace['__file__'], 'exec'), namespace)
                    if command.get('tool_path') and callable(namespace.get('run')):
                        value = namespace['run'](namespace['params'])
                    else:
                        value = namespace.get('dsh_result')
            value = json.loads(json.dumps(value, allow_nan=False))
        except Exception as error:
            diagnostic = traceback.format_exc()
            bpy.ops.wm.open_mainfile(filepath=str(recovery), load_ui=False)
            self.config['object_name'] = None
            self.reset_history()
            self.persist()
            raise RuntimeError('Python failed; scene restored to revision ' + str(self.state['revision']) +
                               '. ' + str(error) + '\n' + diagnostic[-6000:] + '\n' + stream.getvalue()[-2000:]) from error
        bpy.context.view_layer.update()
        active = self.active()
        self.config['object_name'] = active.name if active and active.type == 'MESH' else None
        after = self.signatures()
        changed = [name for name in sorted(before.keys() | after.keys()) if before.get(name) != after.get(name)]
        self.state['revision'] += 1
        self.reset_history()
        self.persist()
        if not before and after:
            with self.host['viewport']():
                bpy.ops.view3d.view_all(center=False)
        return {'script_result': value, 'stdout': stream.getvalue()[-20000:],
                'source_sha256': source_hash, 'source_snapshot': str(source_snapshot),
                'changed_objects': changed[:80], 'changed_object_count': len(changed),
                'change_scope': 'Object presence, transforms, base mesh coordinates/indices, material node inputs; inspect other effects as needed.',
                **({'tool_path': command['tool_path'], 'tool_sha256': command['tool_sha256']} if command.get('tool_path') else {})}

    def execute(self, command):
        action = command['action']
        extra = {}
        if action == 'python':
            extra = self.python(command)
        elif action == 'select':
            extra = self.select(command['object_name'], sculpt=True,
                                **{key: command[key] for key in ('preset', 'highlight', 'isolate') if key in command})
            self.persist()
        elif action == 'stroke':
            extra = self.stroke(**{key: value for key, value in command.items() if key != 'action'})
        elif action in ('undo', 'redo'):
            self.host['history'](action)
            self.persist()
        elif action == 'view':
            self.host['set_view'](command)
            if command.get('probe_points'):
                with self.host['viewport']() as (_, region, rv):
                    extra['probes'] = [self.host['surface_hit'](point, region, rv) for point in command['probe_points']]
        elif action == 'render':
            extra['view'] = self.render(**{key: value for key, value in command.items() if key != 'action'})
        elif action == 'inspect':
            extra = self.inspect(command.get('object_names'), command.get('limit', 40))
        elif action in ('commit', 'save'):
            if action == 'commit':
                self.object_mode()
                self.state['highlight'] = False
                self.brush_base = None
                self.reset_history()
            self.persist()
            extra = self.save(command['save_path']) if command.get('save_path') else {'saved_path': str(self.working)}
        elif action == 'discard':
            if self.brush_base:
                self.object_mode()
                bpy.ops.wm.open_mainfile(filepath=str(self.brush_base), load_ui=False)
                self.config['object_name'] = None
                self.brush_base = None
                self.state['highlight'] = False
                self.state['revision'] += 1
                self.reset_history()
                self.persist()
            extra['discarded'] = True
        elif action in ('close', 'suspend'):
            self.persist()
            self.state['closed'] = True
            extra['closed'] = True
        elif action != 'status':
            raise ValueError('Unknown shared scene action: ' + action)
        return {**self.host['result'](image=False), **self.inspect(limit=12),
                'status': 'closed' if self.state['closed'] else 'open', 'blendPath': str(self.working),
                'brush_base_path': self.last_brush_base, 'blender_version': bpy.app.version_string, **extra}
