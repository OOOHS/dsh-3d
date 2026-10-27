import { readFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
const seeds = JSON.parse(await readFile(new URL('./modeling-notes.json', import.meta.url), 'utf8'))
export function createModelingNotesTools(resolve, config) {
  let queue = Promise.resolve()
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next }
  async function load(exec) {
    const id = exec.agent.session.header.id
    if (!id) throw Error('Session ID required.')
    const path = await resolve(`.dsh-blender/notes/${createHash('sha256').update(id).digest('hex')}.json`, exec, config)
    let data
    try { data = JSON.parse(await readFile(path, 'utf8')) } catch (e) { if(e.code !== 'ENOENT') throw e; data = { revision:0, entries:[], receipts:[] } }
    return { path, data }
  }
  const output = { schema:{type:'object',additionalProperties:true}, render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}] }
  return [defineTool({ name:'modeling_notes_read', description:'Read modeling operation knowledge and this session’s own experience. Default returns a compact index; query searches titles and content; id returns full text. Foundation entries are read-only. Session notes persist when this session resumes and are isolated from other sessions. Notes are observations with applicability limits.',
    parameters:{id:{type:'string'},query:{type:'string'},offset:{type:'integer'},limit:{type:'integer'}}, output,
    execute:(args,exec)=>serial(async()=>{
      const {data}=await load(exec)
      let entries=[...seeds.map(e=>({...e,source:'foundation'})),...data.entries.map(e=>({...e,source:'session'}))]
      if(args.id) entries=entries.filter(e=>e.id===args.id)
      let fallback = false
      if(args.query) {
        const terms=[...new Set(args.query.toLowerCase().match(/[\p{L}\p{N}_]+/gu)??[])]
        const ranked=entries.map(e=>({...e,score:terms.reduce((n,t)=>n+(e.title.toLowerCase().includes(t)?3:0)+(e.content.toLowerCase().includes(t)?1:0),0)})).filter(e=>e.score>0).sort((a,b)=>b.score-a.score)
        if(ranked.length) entries=ranked; else fallback=true
      }
      const offset=Math.max(0,Math.floor(args.offset||0)),limit=Math.max(1,Math.min(20,Math.floor(args.limit||8)))
      return {revision:data.revision,fallback_to_index:fallback,total:entries.length,offset,entries:entries.slice(offset,offset+limit).map(e=>args.id?e:{id:e.id,title:e.title,source:e.source,...(args.query?{excerpt:(()=>{const terms=args.query.toLowerCase().split(/\s+/);const at=terms.map(t=>e.content.toLowerCase().indexOf(t)).filter(i=>i>=0).sort((a,b)=>a-b)[0]??0;return e.content.slice(Math.max(0,at-80),Math.max(0,at-80)+350)})()}:{})})}
    })
  }),defineTool({name:'modeling_notes_write',description:'Maintain this session’s modeling experience. put creates an entry or replaces an existing session entry; delete removes it. Record useful methods, outcomes, evidence and limits in free-form content. expected_revision from read/write protects against overwriting newer notes. Choose when experience is worth recording or revising.',
    parameters:{action:{type:'string',enum:['put','delete'],required:true},id:{type:'string',description:'Existing session entry ID for update/delete; omit to create.'},title:{type:'string'},content:{type:'string',description:'Method, conditions, observed outcome, evidence paths or tool calls, and uncertainty as useful.'},expected_revision:{type:'integer',required:true}},output,
    execute:(args,exec)=>serial(async()=>{
      const {path,data}=await load(exec)
      const request=exec.callId, digest=createHash('sha256').update(JSON.stringify(args)).digest('hex')
      const old=data.receipts.find(r=>r.request===request && request)
      if(old){if(old.digest!==digest)throw Error('Retry arguments changed.');return old.result}
      if(args.expected_revision!==data.revision)throw Error(`Notes revision is ${data.revision}; read current notes and retry.`)
      const index=data.entries.findIndex(e=>e.id===args.id)
      if(args.id && index<0)throw Error('Choose an existing session entry; foundation entries are read-only.')
      let id=args.id
      if(args.action==='delete'){if(index<0)throw Error('Entry ID required.');data.entries.splice(index,1)}
      else if(args.action==='put'){
        if(typeof args.title!=='string'||!args.title.trim()||args.title.length>180||typeof args.content!=='string'||!args.content.trim()||args.content.length>8000)throw Error('Provide title (1–180 characters) and content (1–8000 characters).')
        id ??= 'session:'+randomUUID();const entry={id,title:args.title,content:args.content,updated_at:new Date().toISOString()}
        if(index<0)data.entries.push(entry);else data.entries[index]=entry
      }else throw Error('Action must be put or delete.')
      data.revision++;const result={id,revision:data.revision,action:args.action}
      data.receipts.push({request,digest,result});data.receipts=data.receipts.slice(-64)
      await mkdir(join(path,'..'),{recursive:true});const temp=path+'.'+randomUUID()+'.tmp'
      await writeFile(temp,JSON.stringify(data),{mode:0o600});await rename(temp,path)
      return result
    })
  })]
}
