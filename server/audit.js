import crypto from 'node:crypto';
export function appendAudit(db,{actor=null,event,entity_type='system',entity_id='',details={}}){
 const previous=db.prepare('SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1').get()?.hash||'GENESIS';
 const created_at=new Date().toISOString(),payload=JSON.stringify({actor,event,entity_type,entity_id:String(entity_id),details,previous,created_at}),hash=crypto.createHash('sha256').update(payload).digest('hex');
 db.prepare('INSERT INTO audit_events(actor_id,event,entity_type,entity_id,details,previous_hash,hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run(actor,event,entity_type,String(entity_id),JSON.stringify(details),previous,hash,created_at);return hash;
}
export function verifyAudit(db){let previous='GENESIS';for(const row of db.prepare('SELECT * FROM audit_events ORDER BY id').all()){if(row.previous_hash!==previous)return false;const payload=JSON.stringify({actor:row.actor_id,event:row.event,entity_type:row.entity_type,entity_id:row.entity_id,details:JSON.parse(row.details),previous,created_at:row.created_at});if(crypto.createHash('sha256').update(payload).digest('hex')!==row.hash)return false;previous=row.hash;}return true;}
