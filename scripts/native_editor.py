"""Thin access to Blender's live editing context and RNA brush settings."""
from array import array
import hashlib
import math
from pathlib import Path

import bpy
import numpy as np
from bpy_extras import view3d_utils
from mathutils import Vector


class NativeEditor:
    def __init__(self, viewport, aliases):
        self.viewport = viewport
        self.aliases = aliases
        self.assets = None

    def groups(self):
        sculpt = bpy.context.tool_settings.sculpt
        brush = sculpt.brush
        unified = getattr(sculpt, 'unified_paint_settings', None)
        if unified is None:
            unified = getattr(bpy.context.tool_settings, 'unified_paint_settings', None)
        result = {'sculpt': sculpt, 'unified': unified, 'brush': brush}
        for owner in (brush, sculpt):
            if owner and hasattr(owner, 'mesh_automasking_settings'):
                result['automasking'] = owner.mesh_automasking_settings
                break
        return {key: value for key, value in result.items() if value is not None}

    def effective(self, name):
        groups = self.groups()
        brush, unified = groups.get('brush'), groups.get('unified')
        # The flag has lived on UnifiedPaintSettings and on Brush across releases.
        flag = 'use_unified_' + name
        unified_on = getattr(brush, flag, getattr(unified, flag, False))
        return (unified, 'unified') if unified is not None and unified_on else (brush, 'brush')

    def catalog(self, query='', offset=0, limit=30):
        if self.assets is None:
            directory = Path(bpy.utils.system_resource('DATAFILES')) / 'assets' / 'brushes'
            assets = []
            for path in sorted(directory.glob('*mesh_sculpt.blend')):
                with bpy.data.libraries.load(str(path), assets_only=True) as (source, _):
                    assets.extend({'name': name, 'identifier': 'brushes/' + path.name + '/Brush/' + name,
                                   'aliases': [a for a, n in self.aliases.items() if n == name]}
                                  for name in source.brushes)
            self.assets = sorted(assets, key=lambda a: a['name'].casefold())
        found = [a for a in self.assets if query.casefold() in (a['name'] + ' ' + ' '.join(a['aliases'])).casefold()]
        return {'brushes': found[offset:offset + limit], 'total': len(found), 'offset': offset,
                'has_more': offset + limit < len(found), 'source': 'Blender Essentials mesh sculpt assets'}

    def activate(self, name):
        current = self.groups().get('brush')
        wanted = self.aliases.get(name, name)
        if current and current.name == wanted:
            return
        assets = self.catalog(limit=10000)['brushes']
        asset = next((a for a in assets if wanted in (a['name'], a['identifier'])), None)
        if asset is None:
            raise ValueError('Brush asset unavailable: ' + name + '. Discover installed names with action=brushes.')
        bpy.ops.brush.asset_activate(asset_library_type='ESSENTIALS', relative_asset_identifier=asset['identifier'])

    @staticmethod
    def prop_info(owner, prop):
        value = getattr(owner, prop.identifier)
        result = {'type': prop.type, 'value': list(value) if getattr(prop, 'is_array', False) or isinstance(value, set) else value,
                  'description': prop.description, 'editable': not prop.is_readonly}
        if prop.type == 'ENUM':
            result['enum_flag'] = prop.is_enum_flag
            result['choices'] = [item.identifier for item in prop.enum_items]
        if prop.type in ('INT', 'FLOAT'):
            result['min'], result['max'] = prop.hard_min, prop.hard_max
        return result

    def settings(self, query='', group=None, offset=0, limit=30):
        values = []
        for name, owner in self.groups().items():
            if group and group != name:
                continue
            # Skip ID metadata inherited by Brush; expose its actual RNA parameters.
            for prop in owner.bl_rna.properties:
                if prop.identifier in bpy.types.ID.bl_rna.properties or prop.type not in ('BOOLEAN', 'INT', 'FLOAT', 'ENUM'):
                    continue
                if query.casefold() in (prop.identifier + ' ' + prop.description).casefold():
                    values.append({'group': name, 'property': prop.identifier, **self.prop_info(owner, prop)})
        return {'settings': values[offset:offset + limit], 'total': len(values), 'offset': offset,
                'has_more': offset + limit < len(values)}

    def configure(self, command):
        if command.get('brush'):
            self.activate(command['brush'])
        groups = self.groups()
        changes = []
        for group, fields in command.get('settings', {}).items():
            if group not in groups:
                raise ValueError('Unavailable native settings group: ' + group)
            owner = groups[group]
            for key, value in fields.items():
                prop = owner.bl_rna.properties.get(key)
                if (prop is None or prop.is_readonly or key in bpy.types.ID.bl_rna.properties or
                        prop.type not in ('BOOLEAN', 'INT', 'FLOAT', 'ENUM')):
                    raise ValueError('Choose an editable RNA property from action=settings: ' + group + '.' + key)
                flag = prop.type == 'ENUM' and prop.is_enum_flag
                if flag and not isinstance(value, list):
                    raise ValueError(key + ' requires a JSON list of native enum identifiers.')
                values = value if getattr(prop, 'is_array', False) or flag else [value]
                if getattr(prop, 'is_array', False) and (not isinstance(value, list) or len(value) != prop.array_length):
                    raise ValueError(key + ' requires ' + str(prop.array_length) + ' values.')
                for item in values:
                    if prop.type == 'BOOLEAN' and not isinstance(item, bool):
                        raise ValueError(key + ' requires a boolean.')
                    if prop.type in ('INT', 'FLOAT'):
                        if (isinstance(item, bool) or not isinstance(item, (int, float)) or not math.isfinite(item) or
                                not prop.hard_min <= item <= prop.hard_max or
                                (prop.type == 'INT' and int(item) != item)):
                            raise ValueError(key + ' requires a value in its native RNA range.')
                    if prop.type == 'ENUM' and item not in {e.identifier for e in prop.enum_items}:
                        raise ValueError(key + ' requires a native enum identifier.')
                changes.append((owner, key, set(value) if flag else value))
        # Validate the whole settings patch before writing its properties.
        for owner, key, value in changes:
            setattr(owner, key, value)
        with self.viewport() as (_, region, _):
            if 'radius' in command:
                owner, _ = self.effective('size')
                if owner is None:
                    raise ValueError('Activate a native brush before setting its radius.')
                owner.use_locked_size = 'VIEW'
                # Blender 5 changed pixel size from radius to diameter.
                factor = 2 if bpy.app.version >= (5, 0, 0) else 1
                owner.size = max(1, round(command['radius'] * region.width * factor))
            if 'strength' in command:
                owner, _ = self.effective('strength')
                if owner is None:
                    raise ValueError('Activate a native brush before setting its strength.')
                owner.strength = command['strength']
        if 'symmetry' in command:
            for axis in 'xyz':
                setattr(groups['sculpt'], 'use_symmetry_' + axis, axis in command['symmetry'])
        return self.snapshot()

    def snapshot(self):
        obj = bpy.context.view_layer.objects.active
        groups = self.groups()
        brush = groups.get('brush')
        with self.viewport() as (_, region, rv):
            tool = bpy.context.workspace.tools.from_space_view3d_mode(bpy.context.mode, create=False)
            result = {'active_object': obj.name if obj else None,
                      'mode': obj.mode if obj else 'OBJECT', 'context_mode': bpy.context.mode,
                      'selected_objects': [o.name for o in bpy.context.selected_objects][:40],
                      'tool': tool.idname if tool else None,
                      'viewport_pixels': [region.width, region.height],
                      'symmetry': ''.join(a for a in 'xyz' if getattr(groups['sculpt'], 'use_symmetry_' + a)),
                      'brush': None}
            shading = bpy.context.space_data.shading
            result['display'] = {key: getattr(shading, key) for key in
                                 ('type', 'light', 'color_type', 'show_shadows', 'show_cavity', 'studio_light')}
            result['render'] = {'engine': bpy.context.scene.render.engine,
                                'view_transform': bpy.context.scene.view_settings.view_transform,
                                'exposure': bpy.context.scene.view_settings.exposure}
            if brush:
                size, size_source = self.effective('size')
                strength, strength_source = self.effective('strength')
                factor = 2 if bpy.app.version >= (5, 0, 0) else 1
                radius_px = size.size / factor
                unit = size.use_locked_size
                if unit == 'SCENE' and obj:
                    field = 'unprojected_size' if hasattr(size, 'unprojected_size') else 'unprojected_radius'
                    world_radius = getattr(size, field) / factor
                    center = obj.matrix_world @ (sum((Vector(c) for c in obj.bound_box), Vector()) / 8)
                    right = rv.view_rotation @ Vector((1, 0, 0))
                    p = view3d_utils.location_3d_to_region_2d(region, rv, center)
                    q = view3d_utils.location_3d_to_region_2d(region, rv, center + right * world_radius)
                    radius_px = (q-p).length if p is not None and q is not None else None
                result['brush'] = {'name': brush.name, 'type': getattr(brush, 'sculpt_brush_type', getattr(brush, 'sculpt_tool', None)),
                    'size_source': size_source, 'native_size': size.size, 'size_unit': unit,
                    'radius': radius_px / region.width if radius_px is not None else None,
                    'radius_pixels': radius_px, 'strength': strength.strength, 'strength_source': strength_source,
                    'stroke_method': brush.stroke_method, 'spacing': brush.spacing,
                    'falloff_shape': brush.falloff_shape, 'front_faces_only': brush.use_frontface,
                    'pressure_size': brush.use_pressure_size, 'pressure_strength': brush.use_pressure_strength,
                    'footprint': 'Nominal radius before pressure/falloff; SCENE estimate uses object-center depth.'}
        if obj and obj.type == 'MESH':
            if obj.mode == 'EDIT':
                obj.update_from_editmode()
            result['mesh'] = mesh_state(obj, summaries=True)
            if obj.mode == 'EDIT':
                result['selection'] = {key: sum(x.select for x in values) for key, values in
                                       [('vertices', obj.data.vertices), ('edges', obj.data.edges), ('faces', obj.data.polygons)]}
            result['dynamic_topology'] = obj.use_dynamic_topology_sculpting
            result['multires'] = [{'name': m.name, 'sculpt_level': m.sculpt_levels} for m in obj.modifiers if m.type == 'MULTIRES']
        return result


def coordinates(obj):
    values = array('f', [0.0]) * (len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get('co', values)
    return values


def mesh_state(obj, summaries=False):
    if obj.mode == 'EDIT':
        obj.update_from_editmode()
    digest = hashlib.sha256(coordinates(obj).tobytes())
    indices = array('i', [0]) * len(obj.data.loops)
    obj.data.loops.foreach_get('vertex_index', indices)
    topology = hashlib.sha256(indices.tobytes())
    sizes = array('i', [0]) * len(obj.data.polygons)
    obj.data.polygons.foreach_get('loop_total', sizes)
    topology.update(sizes.tobytes())
    attributes = hashlib.sha256()
    result = {'vertices': len(obj.data.vertices), 'faces': len(obj.data.polygons), 'geometry_hash': digest.hexdigest(), 'topology_hash': topology.hexdigest()}
    for name, field, dtype in [('.sculpt_mask', 'value', 'f'), ('.sculpt_face_set', 'value', 'i'),
                               ('.hide_poly', 'value', 'b'), ('.hide_vert', 'value', 'b')]:
        attr = obj.data.attributes.get(name)
        if attr:
            values = array(dtype, [0]) * len(attr.data)
            attr.data.foreach_get(field, values)
            attributes.update(name.encode() + values.tobytes())
            if summaries:
                result[name] = {'count': len(values), 'nonzero': sum(v != 0 for v in values),
                                'min': min(values, default=0), 'max': max(values, default=0)}
    result['attributes_hash'] = attributes.hexdigest()
    return result


def displacement(before, obj, region=None, rv=None):
    after = coordinates(obj)
    if len(before) != len(after):
        return {'topology_changed': True, 'vertices_before': len(before)//3, 'vertices_after': len(after)//3}
    count, maximum, total = 0, 0.0, 0.0
    minimum, upper = [math.inf]*3, [-math.inf]*3
    for i in range(0, len(before), 3):
        distance = math.sqrt(sum((after[i+j]-before[i+j])**2 for j in range(3)))
        total += distance
        maximum = max(maximum, distance)
        if distance > 1e-7:
            count += 1
            for j in range(3):
                minimum[j] = min(minimum[j], after[i+j])
                upper[j] = max(upper[j], after[i+j])
    result = {'topology_changed': False, 'moved_vertices': count,
            'affected_fraction': count / max(1, len(after)//3), 'max_distance': maximum,
            'mean_distance': total / max(1, len(after)//3),
            'affected_bounds': [minimum, upper] if count else None, 'coordinates': 'object-local base mesh'}
    if count:
        a, b = np.asarray(before).reshape(-1,3), np.asarray(after).reshape(-1,3)
        moved = np.linalg.norm(b-a, axis=1) > 1e-7
        local_delta = (b-a)[moved]
        world_delta = local_delta @ np.asarray(obj.matrix_world.to_3x3()).T
        distances = np.linalg.norm(world_delta, axis=1)
        result['world'] = {'max_distance': float(distances.max()),
                           'mean_affected_distance': float(distances.mean()),
                           'mean_delta': world_delta.mean(axis=0).tolist(), 'units': 'scene units'}
        if region is not None and rv is not None:
            matrix = np.asarray(rv.perspective_matrix @ obj.matrix_world)
            def project(points):
                clip = np.column_stack((points, np.ones(len(points)))) @ matrix.T
                valid = clip[:,3] > 1e-8
                ndc = clip[valid,:2]/clip[valid,3,None]
                return np.column_stack(((ndc[:,0]+1)/2, (1-ndc[:,1])/2))
            projected = [project(points[moved]) for points in (a,b)]
            visible = [p for p in projected if len(p)]
            if visible:
                union = np.concatenate(visible)
                result['screen_bounds'] = [*union.min(axis=0).tolist(), *union.max(axis=0).tolist()]
                result['screen_coordinates'] = 'normalized viewport, origin top-left; includes before and after positions'
            if len(projected[0]) == len(projected[1]) and len(projected[0]):
                result['mean_screen_delta'] = (projected[1]-projected[0]).mean(axis=0).tolist()
    return result
