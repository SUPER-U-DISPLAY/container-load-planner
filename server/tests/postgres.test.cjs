'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {openStore}=require('../store.cjs');
test('PostgreSQL 两连接保存串行化、回滚及重开持久化',{skip:!process.env.PLANNER_TEST_DATABASE_URL},async()=>{
 const url=process.env.PLANNER_TEST_DATABASE_URL,a=await openStore({databaseUrl:url}),b=await openStore({databaseUrl:url}),id='pg-test:'+crypto.randomUUID();let aOpen=true;
 try{
  await a.transaction(tx=>tx.insert('integration_test',id,'test','tester',{value:0}));
  const results=await Promise.allSettled([a,b].map(db=>db.transaction(async tx=>{const row=await tx.get(id);assert.equal(typeof row._revision,'number');return tx.replace(id,1,{value:row.value+1});})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  await assert.rejects(a.transaction(async tx=>{await tx.replace(id,2,{value:99});throw Error('rollback');}),/rollback/);
  assert.equal((await b.transaction(tx=>tx.get(id))).value,1);
  await a.close();aOpen=false;const reopened=await openStore({databaseUrl:url});try{assert.equal((await reopened.transaction(tx=>tx.get(id)))._revision,2);}finally{await reopened.close();}
 }finally{await b.transaction(tx=>tx.query('DELETE FROM planner_records WHERE id = ?',[id]));await b.close();if(aOpen)await a.close();}
});
