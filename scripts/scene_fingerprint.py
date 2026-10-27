"""Read-only fingerprints of supported Blender RNA structures; no model policy."""
import bpy

def rna(value, depth=5, seen=None):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if depth < 0:
        return ('reference', getattr(value, 'name', type(value).__name__))
    seen = set() if seen is None else seen
    if hasattr(value, 'bl_rna'):
        key = value.as_pointer() if hasattr(value, 'as_pointer') else id(value)
        if key in seen:
            return ('reference', getattr(value, 'name', value.bl_rna.identifier))
        seen = seen | {key}
        out = {}
        for prop in value.bl_rna.properties:
            name = prop.identifier
            # Runtime IDs change on file reload and must not invalidate saved history.
            if name in {'rna_type','id_data','original','users','use_fake_user','is_updated','is_updated_data','is_updated_transform','session_uid'}:
                continue
            try:
                v = getattr(value, name)
                if prop.type == 'COLLECTION':
                    out[name] = [rna(x, depth-1, seen) for x in v]
                elif prop.type == 'POINTER':
                    # External object references retain identity; owned structures expand.
                    out[name] = ('object',v.name) if isinstance(v,bpy.types.Object) else rna(v,depth-1,seen)
                elif getattr(prop,'is_array',False):
                    out[name] = list(v)
                elif prop.type in {'BOOLEAN','INT','FLOAT','STRING','ENUM'}:
                    out[name] = sorted(v) if isinstance(v,set) else v
            except (AttributeError, RuntimeError, TypeError):
                out[name] = '<unavailable>'
        return out
    return repr(value)

def object_details(obj):
    return {'data': rna(obj.data) if obj.type in {'CURVE','SURFACE','FONT','LIGHT','CAMERA','ARMATURE'} else None,
            'modifiers': [rna(m) for m in obj.modifiers],
            'materials': [rna(s.material.node_tree, 7) if s.material and s.material.use_nodes else rna(s.material,2) for s in obj.material_slots],
            'animation': rna(obj.animation_data, 9),
            'data_animation': rna(getattr(obj.data,'animation_data',None),9),
            'constraints': [rna(c) for c in obj.constraints]}
