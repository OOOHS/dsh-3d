import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createModelingNotesTools} from '../lib/modeling-notes.js'
test('notes isolate sessions, resume, search, update, delete and safely retry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'notes-'));const factory=()=>createModelingNotesTools(async p=>join(root,p),{})
 let [read,write]=factory();const exec=(id,callId)=>({agent:{session:{header:{id}}},callId})
 const a=exec('a','one');assert.equal((await read.execute({},a)).total,7)
 const args={action:'put',title:'抓取测试',content:'半径影响弯曲，实测效果',expected_revision:0}
 const saved=await write.execute(args,a);assert.deepEqual(await write.execute(args,a),saved)
 assert.equal((await read.execute({},exec('b'))).total,7)
 ;[read,write]=factory();assert.equal((await read.execute({query:'抓取'},a)).total,1)
 await assert.rejects(write.execute({...args,id:saved.id},exec('a','two')),/revision/)
 await write.execute({...args,id:saved.id,content:'修正经验',expected_revision:1},exec('a','three'))
 assert.equal((await read.execute({id:saved.id},a)).entries[0].content,'修正经验')
 await assert.rejects(write.execute({action:'delete',id:'foundation:aim',expected_revision:2},exec('a','four')),/read-only/)
 await write.execute({action:'delete',id:saved.id,expected_revision:2},exec('a','five'))
 assert.equal((await read.execute({},a)).total,7)
})
test('natural-language queries find partial matches and unknown queries return an index',async()=>{
 const root=await mkdtemp(join(tmpdir(),'notes-search-'))
 const [read]=createModelingNotesTools(async p=>join(root,p),{})
 const exec={agent:{session:{header:{id:'search'}}}}
 const hit=await read.execute({query:'sculpt seat shallow concave dish edit mode proportional mesh transform'},exec)
 assert.ok(hit.total>0);assert.equal(hit.fallback_to_index,false)
 const miss=await read.execute({query:'xyzunknown123'},exec)
 assert.equal(miss.fallback_to_index,true);assert.equal(miss.total,7)
})
