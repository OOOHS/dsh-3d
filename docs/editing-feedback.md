# Editing and feedback contract

The shared Blender process owns selection, mode, geometry and brush settings. The
plugin adds structured access and observations; the model chooses methods and
work order. The standard and native presets share the same editing implementation.

## Native mesh controls

- `blender_edit create` with `density:"base"` retains simple primitive topology;
  coarse/medium/fine prepare denser meshes for brushes.
- `mesh_select` uses VERT/EDGE/FACE selection and either all/none or a normalized
  `[left,top,right,bottom]` rectangle from the latest full viewport. Visible
  selection and X-ray selection use Blender's native selection operator. Selection
  remains in Edit Mode and every response reports its actual counts.
- `mesh_transform` translates, rotates or scales the selection around its median,
  with optional proportional radius, falloff and connected-topology influence.
  Translation/radius use world scene units; rotation uses degrees on world axes.
- `mesh_extrude` extends selected faces by a world-space translation. Native scene
  undo/redo retains the resulting geometry and intervening brush work.

## Brush aiming and effects

`configure` selects an installed native brush and sets its parameters. Optional
`preview` accepts the latest `view_id` and a path and leaves geometry, settings and
undo depth unchanged. Its diagnostic image marks the path, target/occluder hits and
nominal starting radius. VIEW size follows pixels; SCENE size is projected at the
initial surface hit. Pressure, falloff, symmetry, masks and brush behavior determine
the actual deformation.

Strokes use the full viewport's normalized top-left coordinates. Each observed
stroke returns that current viewport plus a same-view before/after detail image.
The detail panels record their crop and scale separately. Geometry/attribute
hashes, affected vertex count, local/world displacement and projected movement
describe the measured result. Native local mesh transforms/extrusions also return
comparable images when a current preceding observation is available.

Images and scalar results complement one another: projected movement measures
execution, while resemblance and craftsmanship require visual judgment. A preview
describes targeting and the nominal footprint; it supplies no predicted final mesh.

## Observation and recovery

- `blender_view shading` exposes native viewport type, light, material/object
  color, shadows and cavity. Responses report the effective display and separate
  camera render settings. Geometry remains unchanged.
- Visible-surface probes account for viewport-hidden meshes and local isolation.
  Old view IDs expire after geometry, active-context or viewpoint changes.
- After a successful mutation, image capture/feedback failure preserves operation
  evidence and returns `observation_error`. Refresh with `blender_view`. A stable
  retry ID returns the completed result and preserves the original edit count.
- Action text is compact; full evidence remains in the worker journal/results.
  The default runtime context-pruning budget is 8192 characters. The representative
  tested preview and stroke responses are about 6 KB plus two image attachments.

## Verified scope

Windowed Blender 5.2.2 LTS on macOS: configured brush preview, real Grab motion,
same-view comparison, local/world/image displacement, hidden occluders, visible
and X-ray selection, face extrusion, proportional editing, native history,
partial observation failure, stable retries and existing code/brush/code editing.
The brush contract continues to target prepared fixed-topology base meshes.
Multires, Shape Keys and Dynamic Topology require separate bridge support.

## Community references

Reviewed on 2026-10-24 as design/implementation references:

- [bestmaa/codex-blender](https://github.com/bestmaa/codex-blender/blob/master/skills/blender/SKILL.md):
  structured actions and scene inspection by actual object names.
- [EL4CTEO/blender-skills, blender-core](https://github.com/EL4CTEO/blender-skills/blob/main/skills/blender-core/SKILL.md):
  runtime environment facts, RNA enum discovery and measured plus visual checks.
- [edemaistre/blender-expert-skills, bx_gui](https://github.com/edemaistre/blender-expert-skills/blob/main/blender-expert/scripts/bx_gui.py):
  view-region context, redraw/projection consistency, Blender 5 brush diameter and
  object-space stroke locations. Existing dev.12 already implemented diameter and
  drag conversion; dev.14 adds the feedback and selection changes above.

These are community projects supporting Codex and other agents. Their task-specific
modeling recipes remain reference material; this plugin's modeling strategy stays
with the agent. The implementation here is original and the upstream notices are
retained in NOTICE.
