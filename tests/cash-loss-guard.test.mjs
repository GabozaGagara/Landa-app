import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const localBackups=readFileSync(new URL('../js/landa-local-backups.js',import.meta.url),'utf8');

function extract(start,end){
 const a=html.indexOf(start),b=html.indexOf(end,a);
 assert.ok(a>=0&&b>a,'cash guard source must exist');
 return html.slice(a,b);
}
const guards=runInNewContext(
 extract(' function unexplainedCashLoss(',' function synced(r)')+
 '\n({unexplainedCashLoss,unexpectedOpeningChange})');
const doc=(cash,openings={RUB:100,USD:0},auditTrail=[])=>({
 operations:{cash,openings,auditTrail}
});
const r={id:'cash-R',kind:'exchangeRUB',amount:-1000};
const u={id:'cash-U',kind:'exchangeUSD',amount:10};

test('identical cash versions never report lost records',()=>{
 assert.equal(guards.unexplainedCashLoss(doc([r,u]),doc([r,u])).length,0);
});
test('auto cloud refresh rejects disappearing dollar leg',()=>{
 assert.deepEqual(Array.from(guards.unexplainedCashLoss(doc([r,u]),doc([r])),x=>x.id),['cash-U']);
});
test('auto upload rejects dropping an existing cloud cash record',()=>{
 assert.deepEqual(Array.from(guards.unexplainedCashLoss(doc([r,u]),doc([])),x=>x.id),['cash-R','cash-U']);
});
test('audited intentional cash deletion is allowed',()=>{
 const audit=[{id:'event-1',type:'removed',recordId:'cash-U',summary:'Касса удалена'}];
 assert.equal(guards.unexplainedCashLoss(doc([r,u]),doc([r],{RUB:100,USD:0},audit)).length,0);
});
test('unrelated deletion audit cannot silently authorize cash loss',()=>{
 const audit=[{id:'event-1',type:'removed',recordId:'cash-X',summary:'Касса удалена'}];
 assert.equal(guards.unexplainedCashLoss(doc([r,u]),doc([r],{RUB:100,USD:0},audit)).length,1);
});
test('opening balance changes need a newly recorded audit event',()=>{
 const original=doc([r],{RUB:100,USD:0});
 const changed=doc([r],{RUB:200,USD:0});
 assert.equal(guards.unexpectedOpeningChange(original,changed),true);
 changed.operations.auditTrail=[{id:'event-new',type:'opening',recordId:'accounts'}];
 assert.equal(guards.unexpectedOpeningChange(original,changed),false);
 original.operations.auditTrail=changed.operations.auditTrail;
 assert.equal(guards.unexpectedOpeningChange(original,changed),true);
});
test('cash snapshots have an independent downloadable local archive',()=>{
 assert.match(html,/CASH_RESCUE_KEY='landa_cash_rescue_v1'/);
 assert.match(html,/id="cashRescueSide"/);
 assert.match(html,/function downloadCashRescue\(\)/);
 assert.match(html,/storeCashMirror\(ops\)/);
});
test('urgent cash saves bypass backup throttling in IndexedDB',()=>{
 assert.match(localBackups,/maxStored=80/);
 assert.match(localBackups,/if\(!manual&&!urgent&&last.length\)/);
 assert.match(localBackups,/event\?\.detail\?\.urgent/);
 assert.match(localBackups,/void createBackup\(false,true\)/);
});

test('cash rescue button listener is declared in the same script as its function',()=>{
 const scripts=[...html.matchAll(/<script\\b[^>]*>([\\s\\S]*?)<\\/script>/g)].map(x=>x[1]);
 const fn=scripts.findIndex(x=>x.includes('function downloadCashRescue(){'));
 const handler=scripts.findIndex(x=>x.includes("addEventListener('click',downloadCashRescue)"));
 assert.ok(fn>=0,'cash rescue function missing');
 assert.equal(handler,fn,'cross-script binding can stop the financial dashboard startup');
});
