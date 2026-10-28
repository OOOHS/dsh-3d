## 0.2.3-dev.20

- Add the code-modeler preset using the host's programmatic tool runtime: every authorized tool remains behind the existing registry, policy and result pipeline.
- Add thin Blender Python adapters for native edits, full sculpt actions, world/object-local point projection and explicit image emission, including brush comparison images.
- Document editable replay programs, initialization choices, image feedback and partial-failure semantics. Existing mixed/native/reviewer presets retain their interfaces.
- Exercise repeated sculpt recipes, changed parameters, scene rollback and images returned through both Python and the host code interface.

## 0.2.3-dev.19

- Exclude Blender session-local datablock IDs from persistent scene fingerprints so undo/reload preserves the redo branch.
- Add a save/reload fingerprint regression covering materials, curves, modifiers and animation.
- Add test:acceptance to enable every Blender integration suite and update the DSH smoke test to check the current named capabilities.

## 0.2.3-dev.18

- Start import and export round-trip checks with an empty Blender scene, preventing default startup objects from contaminating asset inspection.
- Restore default asset import/export, structural and round-trip validation, saved-scene preview, animation frame rendering and helper discovery independently of legacy scene transport.
- Reuse upstream object details in live inspection, with opt-in evaluated topology and explicit missing-name feedback.
- Add animation-time selection to live views and temporary time/transparency overrides to camera renders, restoring render state on failure.
- Exercise saved asset import, live editing, export/re-import, animation observations and analysis helper execution together.

# 0.2.3-dev.17

- Rank partial operation-note matches and return the index on empty search results.
- Activate restored checkpoints in the current shared Blender scene.
- Extend change evidence to curve data, modifier parameters, material links and animation RNA.
- Test continued edits across save/restore for all four domains.

# 0.2.3-dev.15

- Resolve current-scene editing IDs and recover a current view ID supplied as edit ID.
- Synchronize brush entry boundaries with native mode and object changes.
- Prioritize active editing context in compact feedback; retain full diagnostic evidence.

# Changelog

All notable changes to this project are documented in this file.

## 0.2.3-dev.14 - 2026-10-24

- Extend `blender_edit` with native mesh selection, proportional transforms and selected-face extrusion. Base-density primitives retain simple editable topology. The existing mixed and native presets share these controls.
- Add optional read-only brush previews with visible-target/occluder hits, gesture arrows and nominal radius. Return full viewport images plus same-view before/after detail panels for strokes and local mesh edits.
- Report effective viewport shading and camera render settings, world/image-space deformation, selection counts and geometry/attribute/no-change outcomes. Compact action text keeps feedback within the host's context-pruning budget.
- Match raycasts to viewport visibility, invalidate stale coordinates after unobserved edits, disable animated view changes and refresh the native selection context after redraw.
- Preserve committed operation evidence when observation fails, so stable request retries retain the original mutation. Preserve existing native and mixed modeling workflows and independent review.
- Validate native brush size/drag, masks/undo, visible/X-ray selection, extrusion, proportional editing, comparison images, hidden occluders, partial image failure and shared code/brush edits in windowed Blender.

## 0.2.3-dev.13 - 2026-10-24

- Add an independently selectable native modeling experiment preset, with an agent-scoped capability allowlist in tool presentation and dispatch. Keep the regular mixed code-and-brush modeler available.
- Add `blender_edit` for native primitives, transforms, duplication, assembly, solid materials, density preparation, cameras and lights in the existing live scene. Mesh creation and density use fixed Blender operators.
- Preserve complete object-operation checkpoints, atomic error recovery and undo/redo through intervening sculpt changes. Reuse the installed native brushes and editing state.
- Retain native viewport hiding through selection, transforms and duplication; validate visibility controls against their intended action. Preserve the completed experiment before applying this runtime fix.
- Keep the experiment's interface contract concise and its method/work-order choices autonomous. Preserve the standard skill and review agent configuration.
- Exercise dense primitive creation, genuine sculpt changes, copying sculpted geometry, undo/redo, assembly, remesh, rendering and recovery in Blender. Check actual DSH capability isolation and direct dispatch rejection of code escape paths.

## 0.2.3-dev.12 - 2026-10-23

- Read and configure Blender's actual selection, object mode, workspace tool and brush context. Preserve native context across Python calls and retain stroke history through read-only queries.
- Discover installed Essentials sculpt assets and searchable RNA parameters through the existing brush tool, with paginated results. Retain legacy brush aliases and all seven default tool entries.
- Respect the effective unified/per-brush setting owner, adapt Blender 5 diameter semantics, preserve omitted settings and report the effective radius, pressure/falloff and symmetry.
- Replay drag-brush paths beyond the silhouette with object-local anchoring. Keep Blender's native raycasts for surface brushes. Report measured displacement and mask/Face Sets attribute changes; include those attributes in undo boundaries.
- Add native regressions for radius scaling, off-surface dragging, context persistence, settings discovery, masks, mode changes and existing scene/legacy flows.

## 0.2.3-dev.11 - 2026-10-23

- Present Python editing and native brush modeling as peer interfaces to shared geometry, with overlapping scope across construction, reshaping and refinement.
- Describe direct edits to existing and sculpted meshes, native brush applications and the ability to alternate methods throughout a task in the main skill.
- Explain the existing-mesh prerequisite for brushes and simple Python-created starting volumes. Keep method choice and work order open.

## 0.2.3-dev.10 - 2026-10-23

- Add a conversation-owned live Blender scene shared by incremental Python, native brushes and viewport/camera observations. Keep explicit new/open starting points and project snapshots.
- Add freshly loaded project Python tools with JSON parameters, source hashes and a compact project-tool index; expose observation, selection, brush and rendering primitives inside Python.
- Preserve local code/brush changes through method switches, save working recovery after mutations, and restore the preceding scene after Python exceptions.
- Reduce the default surface from eighteen tools to seven and condense the main skill. Keep file tools and upstream helpers behind explicit compatibility settings; return compact helper indexes by default.
- Scope a visual-3D persona to the modeler preset through the public system-prompt API. Keep independent reviewer and continuation components separate.

## 0.2.3-dev.9 - 2026-10-23

- Let modelers revise methods, work orders and component boundaries during exploration. Keep a single concise skill and free-form candidate notes.
- Remove the latest-sculpt-checkpoint lock on editing and review; retain final artifact/hash validation and workspace boundaries. Saved scenes remain inspectable and branchable during an isolated brush session.
- Add independent workspace checkpoints with resource packing, evidence snapshots, parent links, hashes and restore into a working scene.
- Return preview/render image attachments directly when supported by the host.
- Highlight sculpt targets and return projected bounds, confirmed surface samples, optional isolation and non-mutating coordinate probes. Expand the native geometry brushes from four to fourteen.

## 0.2.3-dev.8 - 2026-10-22

- Detect stalled automatic endings from successful new tool operations and saved scene bytes. Repeated prose, status calls and unchanged review evidence preserve the idle counter.
- Try one bounded context-policy recovery after repeated idle endings, then pause with the current checkpoint and incomplete acceptance. Productive work resets the stall window; a fresh human continuation resumes paused work.
- Keep recovery inside the plugin using public stop-boundary, scoped compaction and event APIs. Lower the modeler preset's automatic context-compaction threshold to 60%.
- Clarify native brush selection, built-in viewport feedback and reversible exploration. Move mesh preparation details to the sculpt reference and correct Multires/Shape Keys/Dynamic Topology prerequisites.
- Add unit and native DSH regressions for the repeated-budget-message failure, repeated status operations, successful continued revisions and approval.

## 0.2.3-dev.7 - 2026-10-22

- Add independent modeler/reviewer agent configurations and native DSH agent presets; keep modeling guidance as one compact skill.
- Share `inspect_image` between both roles, with normalized crop/zoom, original pixel coordinates, image attachments and evidence fingerprints.
- Run each assessment as a fresh native agent with frozen evidence, scoped observation/submission tools, archived events and deterministic teardown.
- Recover incomplete submissions and tool validation errors inside the review turn; keep confidence optional. Bound observation, transient retry and elapsed resources per assessment.
- Preserve unavailable assessments as awaiting review and allow a new attempt. Maintain strict acceptance of unchanged current scene and render evidence.

## 0.2.3-dev.6 - 2026-10-22

- Make the current editable scene the shared state for code and brush work, with independently editable components and explicit regeneration scope.
- Present persistent brush mode as a primary modeling method, with repeated strokes, intermediate commits and re-entry on other components.
- Align Python and sculpt tool descriptions with incremental editing of saved scenes and preserve the existing tool execution interfaces.

## 0.2.3-dev.5 - 2026-10-22

- Use low reasoning effort for the independent image reviewer when supported and record the effective effort in each review report.
- Verify that successive reviews each contain a fresh reference-and-render request with no accumulated review history.

## 0.2.3-dev.4 - 2026-10-22

- Continue registered reconstruction tasks through the public DSH stop-boundary hook until the current scene and image evidence receive independent approval.
- Add begin/status actions to the existing review tool, with conversation-local state, checkpoint recovery, cancellation handling and an optional explicit time budget.
- Carry native brush commits forward as the editable scene and protect their checkpoint chain during subsequent plugin edits.
- Keep one default skill, encourage direct mesh shaping when scripted edits stall, and preserve observed asymmetry through independent regional modeling.

## 0.2.3-dev.3 - 2026-10-22

- Register one concise modeling skill by default; retain the 29 upstream modules as an explicit legacy option and preserve their helper scripts and provenance.
- Put brush coordinates and session examples in a focused reference. Encourage native brushes when scripted changes stall, with free choice of modeling methods.
- Use positive instructions in the active skill and its tool references. Include optional web research and evidence-based project learning.
- Raise the independent critic's general quality standard and use high reasoning effort when supported, keeping the rubric applicable to new subjects.

## 0.2.3-dev.2 - 2026-10-22

- Add `review_reconstruction`: independent vision-model comparison of the reference and genuine renders, with explicit match/approval, concrete discrepancies and hashed audit reports.
- Require successful review of current final artifacts before reconstruction completion. Malformed, failed, truncated, text-only or inconsistent reviewer responses cannot approve a result.
- Treat native sculpting and other Blender methods as first-class choices. Simplify reconstruction guidance, remove code-reproducibility priorities and character primitive-only boundaries, and make inherited pipelines optional references.

## 0.2.3-dev.1 - 2026-10-21

- Add `blender_sculpt`: conversation-owned, persistent native Draw/Grab/Smooth/Inflate editing, stroke undo/redo, explicit commit/discard, periodic recovery and a journal.
- Add `blender_view`: live image attachments, standard views, orbit, zoom, pan, framing and projection; image-bound normalized stroke coordinates.
- Serialize scene operations, reject stale views and conflicting file operations, deduplicate retries, and clean up workers on cancellation and plugin unload.
- Update bundled modeling guidance and add native Blender and session lifecycle coverage. Preserve the original 13 tools, 30 skills and upstream provenance.

## 0.2.3 - 2026-10-12

- Declare exact compatibility with DSH `0.2.0-rc.2`, `0.2.1-alpha.1`, and `0.2.1-alpha.2`, with disposable-Profile install/start/uninstall evidence; rollback remains unverified.
- Accept the current DSH Tools and Schemastery prerelease peer versions while continuing to reuse the host runtime as optional peers.
- Align the Node.js requirement with the current DSH CLI (`>=22.12.0`) and update both installation guides.
- Add a reproducible DSH Profile smoke check covering real tool dispatch, skills, analysis setup, modeling, preview, export/re-import, workspace path guards, and uninstall cleanup.

## 0.2.2 - 2026-09-16

- Clean up temporary directories and partially written payloads when Blender call preparation fails, including JSON serialization and file write errors (#7, #8).
- Add regression coverage for payload serialization and partial-write failures.

## 0.2.1 - 2026-08-14

- Declare DeepSeek Harness runtime packages as peer dependencies so profile installs reuse the host runtime without duplicate dependency trees or peer warnings.
- Normalize the published `dsh-blender-setup` binary path and polish public package metadata.

## 0.2.0 - 2026-08-14

- Register the complete 30-skill Blender capability stack in DeepSeek Harness.
- Expand the runtime to 13 workspace-scoped Blender tools for inspection, import, Python execution, preview, rendering, export, and validation.
- Expose all 26 upstream deterministic helpers through a strict catalog and runner; 23 modeling helpers are enabled by default and 3 maintenance helpers remain opt-in.
- Add an isolated Python analysis environment with OpenCV, NumPy, Pillow, and SciPy plus the `dsh-blender-setup` command.
- Add real Blender, helper, package, and dsh session integration validation.

## 0.1.0 - 2026-08-14

- Initial DeepSeek Harness Blender plugin with the top-level modeling skill and basic status, scene inspection, Python, render, and export tools.
