import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const [hostArg,pythonArg,evidenceArg]=process.argv.slice(2);
assert.ok(hostArg&&pythonArg,'Usage: node test-support/review-agent-smoke.js <dsh-host-directory> <python-with-Pillow> [evidence-directory]');
const source=resolve(import.meta.dirname,'..'),analysisPython=resolve(pythonArg);
const parentWorkspace=resolve(evidenceArg??await mkdtemp(join(tmpdir(),'dsh-review-agents-')));
Object.assign(process.env,{DSH_HOME:join(parentWorkspace,'home'),DSH_AGENTS_HOME:join(parentWorkspace,'agents'),DSH_TELEMETRY_DISABLED:'1'});
const require=createRequire(join(resolve(hostArg),'package.json'));
const load=n=>import(pathToFileURL(require.resolve(n)).href);
const {runProfile}=await load('@deepseek-ai/dsh/profile-boot');
const {createLaunchEnvironmentSnapshot}=await load('@deepseek-ai/dsh-launch-environment');
const {LlmAdapter,LlmError,createUserMessage,resolveRetryPolicy}=await load('@deepseek-ai/dsh-llm');
const {apply,internals}=await import(pathToFileURL(join(source,'index.js')));
const {createReviewTool}=await import(pathToFileURL(join(source,'lib/reconstruction-review.js')));
const {createInspectImageTool}=await import(pathToFileURL(join(source,'lib/inspect-image.js')));
const {apply:applyRole}=await import(pathToFileURL(join(source,'lib/agent-role.js')));
const workspace=join(parentWorkspace,'review-agents',new Date().toISOString().replaceAll(':','-'));
await mkdir(workspace,{recursive:true});
execFileSync(analysisPython,['-c',"from PIL import Image; Image.new('RGB',(100,80),'blue').save('reference.png'); Image.new('RGB',(100,80),'red').save('front.png')"],{cwd:workspace});
await writeFile(join(workspace,'scene.blend'),'native-agent-evidence');
const patch=join(workspace,'check.patch.yml');
await writeFile(patch,'- id: headless-startup\n  disabled: true\n- id: headless-runner\n  disabled: true\n- id: session-title-llm\n  disabled: true\n');
const environment=createLaunchEnvironmentSnapshot([{source:'process',values:{DSH_TELEMETRY_DISABLED:'1'}}]);
const {ctx}=await runProfile({environment,profile:'headless',patchFiles:[patch],args:[]});
const config={blenderExecutable:'blender',analysisPythonExecutable:analysisPython,timeoutMs:180000,helperTimeoutMs:120000,maxOutputChars:20000,restrictToWorkspace:true,enablePython:true,registerSkill:false,registerAgentPresets:false,reviewerAgent:{provider:'native-review-check',model:'critic',reasoningEffort:'low',timeoutMs:30000,maxSteps:10,maxRecoveries:1}};
const {default:PresetRegistry}=await load('@deepseek-ai/dsh-agent-preset-registry');
const {presetDefinitions,MODELER_PRESET}=await import(pathToFileURL(join(source,'lib/agent-config.js')));
const streams=new Map(),headers=[];
let mode='normal';
class Adapter extends LlmAdapter{
 providerRetryPolicy(){return resolveRetryPolicy({mode:'normal',maxRetries:0},'review-agent-check');}
 providerInfo(provider){return{id:provider,name:'Local review agent check'};}
 async resolveModel(provider,id){return{provider,id,name:id,inputModalities:mode==='text-only'?['text']:['text','image'],defaultMaxTokens:8192,reasoning:{efforts:[{id:'low',name:'Low'},{id:'high',name:'High'}]}};}
 async *stream(options){
  if(options.model==='builder'){
   assert.equal(options.reasoningEffort,'high');
   yield{type:'block-start',index:0,blockType:'text'};yield{type:'block-end',index:0,block:{type:'text',text:'Builder idle'}};yield{type:'finish',reason:{kind:'stop'}};return;
  }
  const id=options.sessionId,step=(streams.get(id)??0)+1;streams.set(id,step);headers.push(options);
  assert.equal(options.reasoningEffort,'low');
  assert.deepEqual(options.tools.map(t=>t.name).sort(),['inspect_image','submit_review']);
  assert.ok(!JSON.stringify(options.messages).includes('PARENT_PRIVATE_CONTEXT'));
  if(mode==='retry'&&step===1)throw new LlmError('Temporary transport failure','TRANSPORT');
  if(mode==='no-submit'){yield{type:'block-start',index:0,blockType:'text'};yield{type:'block-end',index:0,block:{type:'text',text:'Incomplete assessment'}};yield{type:'finish',reason:{kind:'stop'}};return;}
  if(mode==='timeout'){await new Promise((_,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});return;}
  if(step===2){yield{type:'block-start',index:0,blockType:'text'};yield{type:'block-end',index:0,block:{type:'text',text:'The shapes match.'}};yield{type:'finish',reason:{kind:'stop'}};return;}
  const name=step===1?'inspect_image':'submit_review';
  const args=step===1?{image:mode==='outside'?'../../outside.png':'reference',region:[0.1,0.2,0.6,0.8],zoom:2}:step===3?{verdict:'match',summary:'',differences:[]}:{verdict:'match',summary:'当前观察结果一致。',differences:[]};
  const call='call-'+randomUUID(),json=JSON.stringify(args);
  yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id:call,name,argumentsDelta:json};yield{type:'block-end',index:0,block:{type:'tool-call',id:call,name,arguments:json}};yield{type:'finish',reason:{kind:'tool-calls'}};
 }
}
let parent;
try{
 apply(ctx,config);
 const registryFiber=ctx.plugin(PresetRegistry,{default:MODELER_PRESET});
 await registryFiber.inertia;
 if(!ctx.get('agentPresets'))throw new Error('Native preset registry did not initialize: '+JSON.stringify({state:registryFiber.state,services:!!ctx.get('sessionProjections')}));
 for(const definition of presetDefinitions({...config,modelerAgent:{provider:'native-review-check',model:'builder',reasoningEffort:'high',maxTokens:8192}})){definition.plugins.at(-1).name=pathToFileURL(join(source,'lib/agent-role.js')).href;await ctx.agentPresets.register(definition);}
 console.log('Presets',JSON.stringify(await ctx.agentPresets.list()));
 ctx.llm.registerAdapter(['native-review-check'],new Adapter());
 parent=await ctx.agents.create({sessionId:randomUUID(),agentOptions:{provider:'native-review-check',model:'builder'},meta:{cwd:workspace},setup:agentCtx=>ctx.agentPresets.mount(agentCtx,MODELER_PRESET).then(()=>{})});
 parent.agent.followup(createUserMessage({content:[{type:'text',text:'PARENT_PRIVATE_CONTEXT'}],source:{kind:'user'}}));await parent.agent.whenIdle();
 const exec={agent:parent.agent,signal:new AbortController().signal};
 const paths={resolve:internals.resolveWorkspacePath,writable:async()=>{}};
 const crop=await createInspectImageTool(ctx,config,paths).execute({image:'reference.png',region:[0.1,0.2,0.6,0.8],zoom:2},exec);
 assert.deepEqual(crop.dimensions,[100,96]);assert.deepEqual(crop.pixel_region,[10,16,60,64]);
 const tool=createReviewTool(ctx,config,paths);
 const args={reference_path:'reference.png',render_paths:['front.png'],blend_path:'scene.blend'};
 const first=await tool.execute({...args,report_path:'first.json'},exec);
 assert.equal(first.status,'reviewed',JSON.stringify(first));assert.equal(first.approved,true);assert.equal(first.confidence,undefined);
 assert.equal(first.format_repairs,1);assert.equal(first.observations.length,1);assert.deepEqual(first.observations[0].dimensions,crop.dimensions);
 const archived=(await readFile(first.transcript_path,'utf8')).trim().split('\n').map(JSON.parse);
 assert.ok(archived.some(e=>e.type==='tool/result'&&e.data.message.isError));
 assert.equal(ctx.agents.get(first.agent_session_id),undefined);
 const second=await tool.execute({...args,report_path:'second.json'},exec);
 assert.equal(second.approved,true);assert.notEqual(first.agent_session_id,second.agent_session_id);assert.equal(streams.size,2);
 mode='retry';
 const recovered=await tool.execute({...args,report_path:'recovered.json'},exec);
 assert.equal(recovered.status,'reviewed',JSON.stringify(recovered));assert.equal(recovered.recoveries,1);
 mode='outside';
 const outside=await tool.execute({...args,report_path:'outside.json'},exec);
 assert.equal(outside.approved,true);assert.equal(outside.observations.length,0);
 assert.ok((await readFile(outside.transcript_path,'utf8')).includes('Choose an admitted image_id'));
 mode='no-submit';
 const exhausted=await createReviewTool(ctx,{...config,reviewerAgent:{...config.reviewerAgent,maxSteps:3}},paths).execute({...args,report_path:'exhausted.json'},exec);
 assert.equal(exhausted.status,'unavailable');assert.equal(exhausted.steps,3);assert.equal(exhausted.approved,false);
 mode='text-only';
 const textOnly=await tool.execute({...args,report_path:'text-only.json'},exec);
 assert.equal(textOnly.status,'unavailable');assert.match(textOnly.error,/image-capable/);
 mode='timeout';
 const unavailable=await createReviewTool(ctx,{...config,reviewerAgent:{...config.reviewerAgent,timeoutMs:150}},paths).execute({...args,report_path:'unavailable.json'},exec);
 assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.approved,false);assert.equal(ctx.agents.get(unavailable.agent_session_id),undefined);
 const cancelled=new AbortController();
 const cancellation=tool.execute({...args,report_path:'cancelled.json'},{...exec,signal:cancelled.signal});
 const timer=setTimeout(()=>cancelled.abort(new Error('Parent stopped')),150);
 await assert.rejects(cancellation,/Parent stopped/);clearTimeout(timer);
 const cancelledReport=JSON.parse(await readFile(join(workspace,'cancelled.json'),'utf8'));
 assert.equal(cancelledReport.approved,false);assert.equal(ctx.agents.get(cancelledReport.agent_session_id),undefined);
 const report={nativePresets:true,transientFailureRecovered:true,exhaustedBudgetRemainsPending:true,closedEvidenceScope:true,textOnlyReviewerRejected:true,parentCancellationReleasesAgent:true,passed:true,workspace,sharedCropDimensions:crop.dimensions,independentReviewSessions:[first.agent_session_id,second.agent_session_id],earlyStopRecovered:first.format_repairs,invalidSubmissionRecovered:true,optionalConfidence:true,reviewTools:['inspect_image','submit_review'],parentHistoryIsolated:true,disposedAfterSubmission:true,cancelledOnDeadline:true,modelApiCalls:0};
 await writeFile(join(workspace,'check-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{await parent?.dispose();await ctx.fiber.dispose();}
