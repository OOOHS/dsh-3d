import { defineTool } from '@deepseek-ai/dsh-tools'
import { renderScene } from './scene-session.js'

export const NATIVE_ACTIONS = ['create', 'select', 'transform', 'duplicate', 'join', 'parent', 'unparent',
  'delete', 'visibility', 'material', 'shade', 'remesh', 'subdivide', 'apply_transform',
  'camera', 'light', 'environment', 'mesh_select', 'mesh_transform', 'mesh_extrude', 'undo', 'redo']
export const NATIVE_TOOLS = ['modeling_notes_read', 'modeling_notes_write', 'blender_edit', 'blender_scene', 'blender_sculpt', 'blender_view',
  'blender_checkpoint', 'inspect_image', 'review_reconstruction', 'read_image', 'present', 'web_search', 'web_fetch']

export function scopeNativeDescriptions(ctx) {
  const scene = ctx.tools.get('blender_scene')
  if (scene) ctx.tools.register({ ...scene,
    description: 'Manage this conversation’s live Blender scene. new creates an empty scene; open revisits a saved workspace scene; inspect lists objects; configure selects an object and native mode/tool; save preserves a project snapshot; close retains recovery. Native object controls, brushes and views share this scene. Methods and work order are your choice.',
    async execute(args, exec) {
      const { project_tools, ...value } = await scene.execute(args, exec)
      return { ...value, ...(value.capabilities ? { capabilities: value.capabilities.filter(c => !['python', 'project-tools'].includes(c)) } : {}) }
    },
  })
  const sculpt = ctx.tools.get('blender_sculpt')
  if (sculpt) ctx.tools.register({ ...sculpt,
    description: sculpt.description.replace('Code, mesh edits and brushes', 'Object controls, mesh edits and brushes').replace(' See references/sculpting.md.', ''),
  })
}

export function createNativeEditTool(manager) {
  return defineTool({ name: 'blender_edit',
    description: 'Edit the live Blender scene through native controls. create adds a standard primitive; density=base keeps simple editable topology and other densities prepare sculpt vertices. transform/duplicate/join/parent operate on objects. mesh_select selects vertices/edges/faces using a latest-view rectangle or all/none; mesh_transform translates/rotates/scales the selected region with optional proportional falloff; mesh_extrude extends selected faces. These retain native Edit Mode selection. remesh fuses overlapping volumes and changes mesh density; subdivide adds vertices. material sets a solid surface. camera/light/environment set presentation. Every edit returns an image, selected-element counts and actual changes; undo/redo revisit scene checkpoints including brush work. World positions use scene units; rotations use degrees. Construction and editing strategy remain your choice.',
    parameters: {
      action: { type: 'string', required: true, enum: NATIVE_ACTIONS },
      object_name: { type: 'string', description: 'Existing object; omitted uses the active object.' },
      object_names: { type: 'array', items: { type: 'string' }, description: 'Select multiple existing objects for transform, duplicate, join, parenting, material or visibility.' },
      name: { type: 'string', description: 'Name of the new primitive, duplicate, joined object, material, camera or light.' },
      primitive: { type: 'string', enum: ['sphere', 'icosphere', 'cube', 'cylinder', 'cone', 'torus', 'plane'], description: 'create: standard Blender mesh primitive.' },
      density: { type: 'string', enum: ['base', 'coarse', 'medium', 'fine'], description: 'create: base preserves simple primitive topology (cube: 8 vertices; plane: 4); coarse/medium/fine add sculpt density. Default medium.' },
      view_id: { type: 'string', description: 'mesh_select with selection_box: latest full viewport view_id, with the target already active.' },
      selection_mode: { type: 'string', enum: ['VERT','EDGE','FACE'], description: 'mesh_select: element type, default VERT.' },
      selection_action: { type: 'string', enum: ['replace','add','subtract','all','none'], description: 'mesh_select: default replace; all/none operate on the active mesh.' },
      selection_box: { type: 'array', items: { type: 'number' }, description: 'mesh_select: [left,top,right,bottom] in normalized full viewport coordinates, each 0..1.' },
      select_through: { type: 'boolean', description: 'mesh_select: native X-ray box selection; default false selects visible elements.' },
      translation: { type: 'array', items: { type: 'number' }, description: 'mesh_transform/mesh_extrude: world XYZ offset. Extrusion requires a nonzero offset and selected faces.' },
      proportional_radius: { type: 'number', description: 'mesh_transform: optional native proportional influence radius in world units.' },
      falloff: { type: 'string', enum: ['SMOOTH','SPHERE','ROOT','INVERSE_SQUARE','SHARP','LINEAR','CONSTANT','RANDOM'], description: 'mesh_transform: native proportional falloff, default SMOOTH.' },
      connected: { type: 'boolean', description: 'mesh_transform: proportional editing limited to connected topology, default false.' },
      location: { type: 'array', items: { type: 'number' }, description: 'XYZ position; transform defaults to absolute world position.' },
      rotation: { type: 'array', items: { type: 'number' }, description: 'XYZ Euler rotation in degrees.' },
      scale: { type: 'array', items: { type: 'number' }, description: 'XYZ scale factors.' },
      dimensions: { type: 'array', items: { type: 'number' }, description: 'XYZ bounding-box size. create defaults to (2,2,2); plane uses XY.' },
      relative: { type: 'boolean', description: 'transform: add world translation/Euler rotation and multiply scale; default false.' },
      color: { type: 'array', items: { type: 'number' }, description: 'material/create: RGBA solid color in 0..1.' },
      roughness: { type: 'number', description: 'material: 0..1, default .65.' },
      metallic: { type: 'number', description: 'material: 0..1, default 0.' },
      smooth: { type: 'boolean', description: 'shade: smooth or flat faces; default true.' },
      visible: { type: 'boolean', description: 'visibility: object visibility in viewport and render.' },
      parent_name: { type: 'string', description: 'parent: existing parent, retain children world transforms.' },
      voxel_size: { type: 'number', description: 'remesh: voxel edge length in world units after scale is applied; smaller gives more vertices.' },
      iterations: { type: 'integer', description: 'subdivide: native subdivision passes, 1..3, default 1.' },
      preset: { type: 'string', enum: ['front', 'back', 'left', 'right', 'top', 'bottom', 'threequarter'], description: 'camera: named view; omitted uses the current viewport.' },
      target: { type: 'array', items: { type: 'number' }, description: 'camera/light: look-at XYZ.' },
      projection: { type: 'string', enum: ['ORTHO', 'PERSP'], description: 'camera: default ORTHO.' },
      ortho_scale: { type: 'number', description: 'camera: orthographic vertical span in world units.' },
      light_type: { type: 'string', enum: ['AREA', 'POINT', 'SUN'], description: 'light: default AREA.' },
      energy: { type: 'number', description: 'light: native light energy, default 600; SUN usually 1..5.' },
      size: { type: 'number', description: 'light: area size, default 5.' },
      engine: { type: 'string', enum: ['BLENDER_WORKBENCH', 'BLENDER_EEVEE', 'BLENDER_EEVEE_NEXT'], description: 'environment: native render engine; Eevee names adapt to the installed Blender version. Default WORKBENCH uses solid material colors and studio illumination.' },
      background: { type: 'array', items: { type: 'number' }, description: 'environment: RGB in 0..1, default white.' },
      scene_id: { type: 'string' }, request_id: { type: 'string', description: 'Stable retry ID.' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: renderScene },
    async execute(args, exec) {
      if (!NATIVE_ACTIONS.includes(args.action)) throw new Error('Choose a supported native object action.')
      for (const key of ['script', 'code', 'tool_path', 'operator', 'vertices', 'faces', 'expression']) {
        if (key in args) throw new Error('Native editing accepts object controls and sculpt gestures.')
      }
      return manager.serial(() => manager.request({ ...args, action: 'native_edit', operation: args.action, observe: true }, exec))
    },
  })
}
