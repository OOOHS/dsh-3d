"""Bounded native Blender object controls for the gesture-based experiment.

All construction goes through fixed Blender operators. Tool arguments contain
object controls; no source, expressions, mesh arrays or operator names are run.
"""
import hashlib
import json
import math
from pathlib import Path
import uuid

import bpy
from mathutils import Vector, Euler
from mesh_controls import MESH_ACTIONS, execute as mesh_control


def vector(value, length=3, label='vector'):
    if not isinstance(value, (list, tuple)) or len(value) != length:
        raise ValueError(label + ' requires ' + str(length) + ' numbers.')
    result = [float(v) for v in value]
    if not all(math.isfinite(v) and abs(v) <= 10000 for v in result):
        raise ValueError(label + ' requires finite scene-scale numbers.')
    return result


def bounded(value, low, high, label):
    value = float(value)
    if not math.isfinite(value) or not low <= value <= high:
        raise ValueError(label + ' must be in ' + str((low, high)))
    return value


class NativeModeling:
    def __init__(self, shared):
        self.shared = shared
        self.history = []
        self.cursor = -1
        self.directory = shared.root / 'native-history'
        self.directory.mkdir(exist_ok=True)
        if not bpy.context.scene.objects:
            self.environment({})

    def signature(self):
        return hashlib.sha256(json.dumps(self.shared.signatures(), sort_keys=True).encode()).hexdigest()

    def append(self, signature=None):
        path = self.directory / (str(uuid.uuid4()) + '.blend')
        self.shared.save(path)
        for removed in self.history[self.cursor + 1:]:
            Path(removed['path']).unlink(missing_ok=True)
        self.history = self.history[:self.cursor + 1]
        self.history.append({'path': str(path), 'signature': signature or self.signature()})
        self.cursor = len(self.history) - 1
        while len(self.history) > 33:
            removed = self.history.pop(0)
            Path(removed['path']).unlink(missing_ok=True)
            self.cursor -= 1

    def sync(self):
        signature = self.signature()
        if self.cursor < 0 or self.history[self.cursor]['signature'] != signature:
            self.append(signature)

    def restore(self, path):
        self.shared.object_mode()
        bpy.ops.wm.open_mainfile(filepath=str(path), load_ui=False)
        active = self.shared.active()
        self.shared.config['object_name'] = active.name if active and active.type == 'MESH' else None
        self.shared.brush_base = None
        self.shared.state['highlight'] = False
        self.shared.state['revision'] += 1
        self.shared.reset_history()
        if active and active.mode == 'SCULPT':
            with self.shared.host['viewport']():
                bpy.ops.ed.undo_push(message='Restored native edit')
        self.shared.persist()

    def objects(self, command):
        names = command.get('object_names') or ([command['object_name']] if command.get('object_name') else [])
        objects = [bpy.data.objects.get(n) for n in names] if names else [self.shared.active()]
        if not objects or len(objects) > 64 or any(o is None for o in objects):
            raise ValueError('Select 1..64 existing objects; inspect for their exact names.')
        return objects

    def select(self, objects):
        self.shared.object_mode()
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:
            obj.hide_set(False)
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        self.shared.config['object_name'] = objects[0].name if objects[0].type == 'MESH' else None

    def material(self, objects, command):
        color = vector(command.get('color', [.5, .5, .5, 1]), 4, 'color')
        if any(c < 0 or c > 1 for c in color):
            raise ValueError('RGBA color values must be in 0..1.')
        roughness = bounded(command.get('roughness', .65), 0, 1, 'roughness')
        metallic = bounded(command.get('metallic', 0), 0, 1, 'metallic')
        mat = bpy.data.materials.new(command.get('name') or 'SolidColor')
        mat.diffuse_color = color
        mat.use_nodes = True
        shader = mat.node_tree.nodes.get('Principled BSDF')
        shader.inputs['Base Color'].default_value = color
        shader.inputs['Roughness'].default_value = roughness
        shader.inputs['Metallic'].default_value = metallic
        for obj in objects:
            if obj.type != 'MESH':
                raise ValueError('Solid materials apply to meshes.')
            obj.data.materials.clear()
            obj.data.materials.append(mat)
            obj.color = color

    def transform(self, objects, command):
        relative = bool(command.get('relative', False))
        for obj in objects:
            if 'location' in command:
                value = Vector(vector(command['location'], label='location'))
                world = obj.matrix_world.copy()
                world.translation = world.translation + value if relative else value
                obj.matrix_world = world
            if 'rotation' in command:
                value = Euler([math.radians(v) for v in vector(command['rotation'], label='rotation')], 'XYZ')
                obj.rotation_euler = Euler([a+b for a, b in zip(obj.rotation_euler, value)], 'XYZ') if relative else value
            if 'scale' in command:
                value = vector(command['scale'], label='scale')
                if any(abs(v) < .00001 for v in value):
                    raise ValueError('Scale factors must be nonzero.')
                obj.scale = [a*b for a, b in zip(obj.scale, value)] if relative else value
            if 'dimensions' in command:
                size = vector(command['dimensions'], label='dimensions')
                if any(v <= 0 for v in size):
                    raise ValueError('Dimensions must be positive.')
                bpy.context.view_layer.update()
                obj.dimensions = size
        bpy.context.view_layer.update()

    def create(self, command):
        density = command.get('density', 'medium')
        if density not in ['base', 'coarse', 'medium', 'fine']:
            raise ValueError('density: base, coarse, medium, fine.')
        level = max(0, ['base', 'coarse', 'medium', 'fine'].index(density)-1)
        primitive = command.get('primitive', 'sphere')
        self.shared.object_mode()
        bpy.ops.object.select_all(action='DESELECT')
        if primitive == 'sphere':
            bpy.ops.mesh.primitive_uv_sphere_add(segments=[48, 96, 160][level], ring_count=[32, 64, 96][level])
        elif primitive == 'icosphere':
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4+level)
        elif primitive == 'cube':
            bpy.ops.mesh.primitive_cube_add()
        elif primitive == 'cylinder':
            bpy.ops.mesh.primitive_cylinder_add(vertices=[48, 96, 160][level])
        elif primitive == 'cone':
            bpy.ops.mesh.primitive_cone_add(vertices=[48, 96, 160][level])
        elif primitive == 'torus':
            bpy.ops.mesh.primitive_torus_add(major_segments=[48, 96, 160][level], minor_segments=[24, 48, 64][level])
        elif primitive == 'plane':
            bpy.ops.mesh.primitive_plane_add()
        else:
            raise ValueError('Choose a standard primitive from the tool catalog.')
        obj = bpy.context.object
        obj.name = str(command.get('name') or primitive)[:128]
        if primitive in ['cube', 'plane'] and density != 'base':
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.subdivide(number_cuts=[15, 31, 63][level])
            bpy.ops.object.mode_set(mode='OBJECT')
        self.transform([obj], command)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        if primitive in ['cylinder', 'cone'] and density != 'base':
            # Native voxel remesh supplies evenly spaced sculptable faces on caps and sides.
            self.remesh(obj, max(obj.dimensions) / [32, 48, 72][level])
        for face in obj.data.polygons:
            face.use_smooth = primitive not in ['cube', 'plane']
        if 'color' in command:
            self.material([obj], {**command, 'name': obj.name + '_Material'})
        return {'created_objects': [obj.name]}

    def remesh(self, obj, size):
        size = bounded(size, .0001, 1000, 'voxel_size')
        estimate = math.prod(max(1, d / size) for d in obj.dimensions)
        if estimate > 8000000:
            raise ValueError('Choose a coarser voxel_size for this object; estimated voxel grid exceeds 8 million cells.')
        if obj.type != 'MESH' or obj.data.shape_keys or any(m.type == 'MULTIRES' for m in obj.modifiers):
            raise ValueError('Voxel remesh uses a plain mesh base.')
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        obj.data.remesh_voxel_size = size
        obj.data.remesh_voxel_adaptivity = 0
        bpy.ops.object.voxel_remesh()
        for face in obj.data.polygons:
            face.use_smooth = True

    def camera(self, command):
        name = str(command.get('name') or 'Camera')[:128]
        obj = bpy.data.objects.get(name)
        if obj and obj.type != 'CAMERA':
            raise ValueError('Camera name belongs to another object.')
        if obj is None:
            data = bpy.data.cameras.new(name)
            obj = bpy.data.objects.new(name, data)
            bpy.context.scene.collection.objects.link(obj)
        target = Vector(vector(command.get('target', [0, 0, 0]), label='target'))
        if 'location' in command:
            location = Vector(vector(command['location'], label='location'))
        elif command.get('preset'):
            locations = {'front': (0, -10, 0), 'back': (0, 10, 0), 'left': (-10, 0, 0),
                         'right': (10, 0, 0), 'top': (0, 0, 10), 'bottom': (0, 0, -10),
                         'threequarter': (7, -10, 5)}
            if command['preset'] not in locations:
                raise ValueError('Choose a supported camera preset.')
            location = target + Vector(locations[command['preset']])
        else:
            with self.shared.host['viewport']() as (_, _, rv):
                target = rv.view_location.copy()
                location = target + rv.view_rotation @ Vector((0, 0, rv.view_distance))
                obj.rotation_euler = rv.view_rotation.to_euler()
                if 'ortho_scale' not in command:
                    command = {**command, 'ortho_scale': max(.01, rv.view_distance)}
        if (target - location).length < .00001:
            raise ValueError('Camera location and target must differ.')
        obj.location = location
        obj.rotation_euler = (target-location).to_track_quat('-Z', 'Y').to_euler()
        projection = command.get('projection', 'ORTHO')
        if projection not in ['ORTHO', 'PERSP']:
            raise ValueError('projection: ORTHO or PERSP.')
        obj.data.type = projection
        obj.data.ortho_scale = bounded(command.get('ortho_scale', 6), .001, 10000, 'ortho_scale')
        obj.data.clip_end = 10000
        bpy.context.scene.camera = obj
        return {'camera': obj.name}

    def light(self, command):
        name = str(command.get('name') or 'Light')[:128]
        kind = command.get('light_type', 'AREA')
        if kind not in ['AREA', 'POINT', 'SUN']:
            raise ValueError('light_type: AREA, POINT, SUN.')
        obj = bpy.data.objects.get(name)
        if obj and obj.type != 'LIGHT':
            raise ValueError('Light name belongs to another object.')
        if obj is None:
            obj = bpy.data.objects.new(name, bpy.data.lights.new(name, kind))
            bpy.context.scene.collection.objects.link(obj)
        obj.data.type = kind
        obj.location = vector(command.get('location', [-3, -4, 6]), label='location')
        target = Vector(vector(command.get('target', [0, 0, 0]), label='target'))
        if (target-obj.location).length > .00001:
            obj.rotation_euler = (target-obj.location).to_track_quat('-Z', 'Y').to_euler()
        obj.data.energy = bounded(command.get('energy', 600), 0, 100000, 'energy')
        if kind == 'AREA':
            obj.data.size = bounded(command.get('size', 5), .001, 1000, 'size')
        return {'light': obj.name}

    def environment(self, command):
        engine = command.get('engine', 'BLENDER_WORKBENCH')
        if engine not in ['BLENDER_WORKBENCH', 'BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE']:
            raise ValueError('Choose a supported native render engine.')
        color = vector(command.get('background', [1, 1, 1]), label='background')
        if any(c < 0 or c > 1 for c in color):
            raise ValueError('RGB background values must be in 0..1.')
        scene = bpy.context.scene
        try:
            scene.render.engine = engine
        except TypeError:
            if engine not in ['BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT']:
                raise
            scene.render.engine = 'BLENDER_EEVEE' if engine == 'BLENDER_EEVEE_NEXT' else 'BLENDER_EEVEE_NEXT'
        scene.world = scene.world or bpy.data.worlds.new('World')
        scene.world.color = color
        scene.world.use_nodes = True
        scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value = [*color, 1]
        scene.view_settings.view_transform = 'Standard'
        shading = scene.display.shading
        shading.color_type = 'MATERIAL'
        shading.light = 'STUDIO'
        shading.show_shadows = True
        shading.show_cavity = True
        shading.background_type = 'WORLD'
        # These are the same native solid-view controls visible in Blender's popover.
        for screen in bpy.data.screens:
            for area in screen.areas:
                if area.type == 'VIEW_3D':
                    area.spaces.active.shading.color_type = 'MATERIAL'
        return {'engine': scene.render.engine}

    def operation(self, command):
        action = command['operation']
        if action == 'create':
            return self.create(command)
        if action == 'camera':
            return self.camera(command)
        if action == 'light':
            return self.light(command)
        if action == 'environment':
            return self.environment(command)
        objects = self.objects(command)
        self.select(objects)
        if action == 'select':
            return {}
        if action == 'transform':
            self.transform(objects, command)
        elif action == 'duplicate':
            copies = []
            for obj in objects:
                copy = obj.copy()
                copy.data = obj.data.copy() if obj.data else None
                copy.name = str(command.get('name') or (obj.name + '_copy'))[:128]
                bpy.context.scene.collection.objects.link(copy)
                copies.append(copy)
            self.select(copies)
            self.transform(copies, command)
            for source, copy in zip(objects, copies):
                copy.hide_set(self.previous_visibility.get(source.name, False))
            return {'created_objects': [o.name for o in copies]}
        elif action == 'join':
            if any(o.type != 'MESH' for o in objects):
                raise ValueError('Join selects mesh objects.')
            bpy.ops.object.join()
            if command.get('name'):
                bpy.context.object.name = str(command['name'])[:128]
        elif action in ['parent', 'unparent']:
            parent = bpy.data.objects.get(command.get('parent_name', '')) if action == 'parent' else None
            if action == 'parent' and parent is None:
                raise ValueError('parent_name selects an existing parent.')
            for obj in objects:
                ancestor = parent
                while ancestor:
                    if ancestor == obj:
                        raise ValueError('Parenting must preserve an acyclic hierarchy.')
                    ancestor = ancestor.parent
                world = obj.matrix_world.copy()
                obj.parent = parent
                if parent:
                    obj.matrix_parent_inverse = parent.matrix_world.inverted()
                obj.matrix_world = world
        elif action == 'delete':
            bpy.ops.object.delete()
        elif action == 'visibility':
            for obj in objects:
                obj.hide_set(not bool(command.get('visible', True)))
                obj.hide_render = not bool(command.get('visible', True))
        elif action == 'material':
            self.material(objects, command)
        elif action == 'shade':
            for obj in objects:
                if obj.type == 'MESH':
                    for face in obj.data.polygons:
                        face.use_smooth = bool(command.get('smooth', True))
        elif action == 'apply_transform':
            bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        elif action == 'remesh':
            if len(objects) != 1 or 'voxel_size' not in command:
                raise ValueError('Remesh selects one mesh and a voxel_size.')
            self.remesh(objects[0], command['voxel_size'])
        elif action == 'subdivide':
            iterations = int(command.get('iterations', 1))
            if not 1 <= iterations <= 3 or any(o.type != 'MESH' for o in objects):
                raise ValueError('Subdivide selects meshes and 1..3 passes.')
            if sum(len(o.data.polygons) for o in objects) * 4**iterations > 500000:
                raise ValueError('Subdivision would exceed 500,000 faces; use fewer passes or remesh.')
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            for _ in range(iterations):
                bpy.ops.mesh.subdivide(number_cuts=1, smoothness=0)
            bpy.ops.object.mode_set(mode='OBJECT')
        else:
            raise ValueError('Unsupported native editing action: ' + str(action))
        return {}

    def execute(self, command):
        action = command['operation']
        before_view = None
        if action in {'mesh_transform','mesh_extrude'} and self.shared.state.get('view_id'):
            try:
                self.shared.host['require_view']({'view_id':self.shared.state['view_id']})
                before_view = self.shared.state.get('last_view')
            except ValueError:
                pass
        self.sync()
        if action in ['undo', 'redo']:
            index = self.cursor + (-1 if action == 'undo' else 1)
            if index < 0 or index >= len(self.history):
                raise ValueError('No native object ' + action + ' checkpoint available.')
            self.restore(self.history[index]['path'])
            self.cursor = index
            return {'operation': action, 'native_undo_depth': self.cursor,
                    'native_redo_depth': len(self.history)-self.cursor-1}
        previous = self.history[self.cursor]['path']
        before = self.shared.signatures()
        self.previous_visibility = {obj.name: obj.hide_get() for obj in bpy.context.scene.objects}
        try:
            if 'visible' in command and action != 'visibility':
                raise ValueError('Use action visibility to set the visible control.')
            with self.shared.host['viewport']():
                extra = mesh_control(self.shared, command) if action in MESH_ACTIONS else self.operation(command)
            if action != 'visibility':
                for name, hidden in self.previous_visibility.items():
                    obj = bpy.data.objects.get(name)
                    if obj:
                        obj.hide_set(hidden)
            bpy.context.view_layer.update()
        except Exception:
            self.restore(previous)
            raise
        active = self.shared.active()
        self.shared.config['object_name'] = active.name if active and active.type == 'MESH' else None
        self.shared.brush_base = None
        self.shared.state['highlight'] = False
        self.shared.state['revision'] += 1
        self.shared.reset_history()
        self.shared.persist()
        self.append()
        after = self.shared.signatures()
        changed = [n for n in sorted(before.keys() | after.keys()) if before.get(n) != after.get(n)]
        if not before and after and active and active.type == 'MESH':
            self.shared.host['set_view']({'frame': True})
        if before_view:
            extra['before_view'] = before_view
            extra['detail_bounds'] = extra.get('displacement',{}).get('screen_bounds')
        return {'operation': action, 'changed_objects': changed[:80], 'changed_object_count': len(changed),
                'native_undo_depth': self.cursor, 'native_redo_depth': 0, **extra}
