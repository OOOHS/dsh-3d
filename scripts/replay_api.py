"""Thin code adapters over existing native scene operations."""
import math
import shutil
import uuid
from pathlib import Path

from mathutils import Vector
from bpy_extras.view3d_utils import location_3d_to_region_2d


class ReplayAPI:
    def __init__(self, scene):
        self.scene = scene
        self.outputs = []

    def edit(self, action, **options):
        return self.scene.execute({**options, 'action': 'native_edit', 'operation': action})

    def sculpt(self, action, **options):
        if action not in ('begin', 'brushes', 'settings', 'configure', 'preview', 'stroke', 'undo', 'redo', 'commit', 'discard', 'status'):
            raise ValueError('Unknown sculpt action: ' + str(action))
        if action == 'begin':
            action = 'select'
        if action in ('stroke', 'preview') and not options.get('view_id'):
            options['view_id'] = self.scene.view()['view_id']
        value = self.scene.execute({**options, 'action': action})
        if action not in ('brushes', 'settings'):
            value = self.scene.host['capture_result'](value, refresh=True)
        return value

    def project(self, points, object_name=None):
        """Project current world/object-local points; report visible surface hits."""
        import bpy
        obj = bpy.data.objects.get(object_name) if object_name else None
        if object_name and obj is None:
            raise ValueError('Object not found: ' + object_name)
        bpy.context.view_layer.update()
        result = []
        with self.scene.host['viewport']() as (_, region, rv):
            rv.update()
            for point in points:
                if len(point) != 3 or not all(math.isfinite(float(v)) for v in point):
                    raise ValueError('points must contain finite XYZ triples')
                world = obj.matrix_world @ Vector(point) if obj else Vector(point)
                pixel = location_3d_to_region_2d(region, rv, world)
                uv = [pixel.x / region.width, 1 - pixel.y / region.height] if pixel is not None else None
                inside = uv is not None and all(0 <= v <= 1 for v in uv)
                result.append({'point': uv, 'world': list(world), 'in_view': inside,
                               'hit': self.scene.host['surface_hit'](uv, region, rv) if inside else None})
        return result

    def emit(self, value):
        """Explicitly return generated observations using the existing attachment pipeline."""
        images = [value] if isinstance(value, dict) and 'path' in value else [
            value[k] for k in ('view', 'feedback') if isinstance(value, dict) and value.get(k)]
        if not images:
            raise ValueError('emit expects a view/render or an operation containing view/feedback')
        for item in images:
            path = Path(item['path']).resolve()
            workspace = Path(self.scene.config['workspace']).resolve()
            if not path.is_relative_to(workspace) or path.suffix.lower() != '.png' or not path.is_file():
                raise ValueError('emit requires an existing workspace PNG observation')
            if len(self.outputs) >= 16:
                raise ValueError('At most 16 explicitly emitted images per execution')
            # A program may render several frames to the same output path.
            # Freeze each emitted image now, before a later operation replaces it.
            snapshot = self.scene.root / ('emitted-' + str(uuid.uuid4()) + '.png')
            shutil.copyfile(path, snapshot)
            self.outputs.append({**item, 'path': str(snapshot), 'source_path': str(path)})
        return {'emitted': len(images)}
