import { createClient } from "@supabase/supabase-js";

const url=process.env.LOCAL_SUPABASE_URL, serviceKey=process.env.LOCAL_SUPABASE_SERVICE_KEY;
if(!url||!serviceKey||!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error("UI fixtures require loopback Supabase.");
const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const password="LocalUi123!";
async function ensure(email,name,role){
  const existing=(await admin.auth.admin.listUsers()).data.users.find((entry)=>entry.email===email);
  const user=existing || (await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:name}})).data.user;
  if(!user) throw new Error(`cannot create ${role} fixture`);
  const update=await admin.from("profiles").update({display_name:name,role}).eq("id",user.id); if(update.error) throw update.error;
  return user;
}
const actor=await ensure("ui-admin@local.test","UI Admin","admin");
await ensure("ui-user@local.test","UI User","user");
await ensure("ui-viewer@local.test","UI Viewer","viewer");
const target=await ensure("ui-delete@local.test","UI Delete Target","user");
const workplace=(await admin.from("workplaces").select("id").eq("name","K3").single()).data;
const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const add=(days)=>{const d=new Date(`${today}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)};
await admin.from("daily_status").upsert([-1,0,1].map((offset)=>({user_id:target.id,work_date:add(offset),workplace_id:workplace.id,workplace_ids:[workplace.id],overtime_enabled:offset===0,overtime_hours:offset===0?2:0})),{onConflict:"user_id,work_date"});
console.log(JSON.stringify({loopback:true,adminEmail:"ui-admin@local.test",userEmail:"ui-user@local.test",viewerEmail:"ui-viewer@local.test",targetName:"UI Delete Target",password,actorId:actor.id}));
