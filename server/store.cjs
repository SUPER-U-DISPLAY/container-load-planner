'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const schema=`CREATE TABLE IF NOT EXISTS planner_records (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, project_id TEXT, owner_id TEXT NOT NULL,
 revision INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS planner_records_kind ON planner_records(kind, project_id);
CREATE TABLE IF NOT EXISTS planner_operations (
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, request_hash TEXT NOT NULL,
 response TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS planner_schema_versions (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`;
function decoded(row){return row?{...JSON.parse(row.payload),_revision:row.revision,_ownerId:row.owner_id,_createdAt:row.created_at}:null;}
class Tx{
 constructor(query){this.query=query;}
 async get(id){const r=await this.query('SELECT * FROM planner_records WHERE id = ?',[id]);return decoded(r.rows[0]);}
 async list(kind){const r=await this.query('SELECT * FROM planner_records WHERE kind = ? ORDER BY created_at DESC',[kind]);return r.rows.map(decoded);}
 async insert(kind,id,projectId,ownerId,payload){const now=new Date().toISOString();await this.query('INSERT INTO planner_records (id,kind,project_id,owner_id,revision,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',[id,kind,projectId,ownerId,1,JSON.stringify(payload),now,now]);return {...payload,_revision:1,_ownerId:ownerId,_createdAt:now};}
 async replace(id,expected,payload){const r=await this.query('UPDATE planner_records SET payload = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?',[JSON.stringify(payload),new Date().toISOString(),id,expected]);if(r.rowCount!==1){const e=Error('方案已被其他人修改，请重新载入或另存方案');e.status=409;throw e;}return this.get(id);}
 async operation(id){const r=await this.query('SELECT * FROM planner_operations WHERE id = ?',[id]);return r.rows[0];}
 async remember(id,actor,hash,response){await this.query('INSERT INTO planner_operations (id,actor_id,request_hash,response,created_at) VALUES (?,?,?,?,?)',[id,actor,hash,JSON.stringify(response),new Date().toISOString()]);}
}
async function openStore({databaseUrl,sqlitePath=path.resolve('data/planner.sqlite')}={}){
 if(databaseUrl){
  const {Pool}=require('pg'),pool=new Pool({connectionString:databaseUrl,max:4,connectionTimeoutMillis:5000,query_timeout:15000,application_name:'superu-load-planner'});
  await pool.query(schema);await pool.query('INSERT INTO planner_schema_versions (version,applied_at) VALUES (1,$1) ON CONFLICT(version) DO NOTHING',[new Date().toISOString()]);
  return {backend:'postgresql',async transaction(fn){const client=await pool.connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(71924153)');let n;const tx=new Tx((sql,params=[])=>{n=0;return client.query(sql.replace(/\?/g,()=>'$'+(++n)),params);});const value=await fn(tx);await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}},close:()=>pool.end()};
 }
 const {DatabaseSync}=require('node:sqlite');if(sqlitePath!==':memory:')await fs.mkdir(path.dirname(sqlitePath),{recursive:true});
 const db=new DatabaseSync(sqlitePath);db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');db.exec(schema);
 db.prepare('INSERT INTO planner_schema_versions (version,applied_at) VALUES (?,?) ON CONFLICT(version) DO NOTHING').run(1,new Date().toISOString());
 let tail=Promise.resolve();
 const query=async(sql,params=[])=>{const stmt=db.prepare(sql);if(/^\s*SELECT/i.test(sql))return {rows:stmt.all(...params),rowCount:0};const r=stmt.run(...params);return {rows:[],rowCount:r.changes};};
 return {backend:'sqlite',transaction(fn){const task=tail.then(async()=>{db.exec('BEGIN IMMEDIATE');try{const r=await fn(new Tx(query));db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}});tail=task.catch(()=>{});return task;},async close(){await tail;db.close();}};
}
module.exports={openStore};
