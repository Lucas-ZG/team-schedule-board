// Local-only fixtures for the display-name capitalization check. Requires a loopback Supabase and UI_TEST_PASSWORD in the process env.
import { createClient } from "@supabase/supabase-js";

const url = process.env.LOCAL_SUPABASE_URL, serviceKey = process.env.LOCAL_SUPABASE_SERVICE_KEY, password = process.env.UI_TEST_PASSWORD;
if (!url || !serviceKey || !password || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) throw new Error("Fixtures require a loopback Supabase and UI_TEST_PASSWORD.");
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

export const FIXTURES = [
  { email: "lucas.zg@local.test", name: "Lucas.ZG", role: "admin", sort: 1 },
  { email: "ian.hong@local.test", name: "ian.hong", role: "user", sort: 2 },
  { email: "office@local.test", name: "Office", role: "user", sort: 3 },
  { email: "test.user.one@local.test", name: "test_user.one", role: "viewer", sort: 4 },
  { email: "gone.person@local.test", name: "gone.person", role: "user", sort: 5 },
  { email: "ian.delete@local.test", name: "ian.delete", role: "user", sort: 6 },
  // Same sort_order on purpose: raw order is "ian-b" before "ian.a", formatted order ("Ian A" before "Ian-b") is the opposite.
  { email: "ian.b@local.test", name: "ian-b", role: "user", sort: 7 },
  { email: "ian.a@local.test", name: "ian.a", role: "user", sort: 7 },
];

async function ensure({ email, name, role, sort }) {
  const list = (await admin.auth.admin.listUsers()).data.users;
  const existing = list.find((entry) => entry.email === email);
  const user = existing || (await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } })).data.user;
  if (!user) throw new Error(`cannot create ${email}`);
  const update = await admin.from("profiles").update({ display_name: name, role, sort_order: sort }).eq("id", user.id);
  if (update.error) throw update.error;
  return user;
}

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shift = (days) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

const users = {};
for (const fixture of FIXTURES) users[fixture.name] = await ensure(fixture);
const workplaces = (await admin.from("workplaces").select("id,name,is_dayoff")).data;
const byName = Object.fromEntries(workplaces.map((w) => [w.name, w]));
const rows = [];
const add = (name, offset, workplaceName, ot = 0) => rows.push({
  user_id: users[name].id, work_date: shift(offset), workplace_id: byName[workplaceName].id, workplace_ids: [byName[workplaceName].id],
  overtime_enabled: ot > 0, overtime_hours: ot, leave_hours: 0,
});
add("Lucas.ZG", 0, "K3"); add("Lucas.ZG", 1, "Office", 1.5);
add("ian.hong", 0, "K3", 2); add("ian.hong", -1, "Office", 1); add("ian.hong", 1, "K5");
add("Office", 0, "Office"); add("Office", -1, "K3", 0.5);
add("test_user.one", 0, "K3");
add("gone.person", -1, "K3", 2); add("gone.person", 0, "Office", 1); add("gone.person", 1, "K5", 3);
add("ian.delete", 0, "K3"); add("ian.delete", 2, "K5");
add("ian-b", 0, "K3"); add("ian.a", 0, "K3");
// one leave day (Dayoff workplace, 8h) so the Monthly Leave Summary has a named row
const dayoff = workplaces.find((w) => w.is_dayoff);
// R3-M1: leave records for accounts that get DELETED in the UI check. Past leave must survive the deletion (shown in the Monthly Leave
// Summary as "Name（已刪除）"); future leave is removed by the deletion and must NOT be counted.
const addLeave = (name, offset, hours) => rows.push({ user_id: users[name].id, work_date: shift(offset), workplace_id: dayoff.id, workplace_ids: [dayoff.id], overtime_enabled: false, overtime_hours: 0, leave_hours: hours });
addLeave("gone.person", -2, 4); addLeave("gone.person", 2, 8); addLeave("ian.delete", -3, 8);
rows.push({ user_id: users["ian.hong"].id, work_date: shift(3), workplace_id: dayoff.id, workplace_ids: [dayoff.id], overtime_enabled: false, overtime_hours: 0, leave_hours: 8 });
const result = await admin.from("daily_status").upsert(rows, { onConflict: "user_id,work_date" });
if (result.error) throw result.error;
console.log(JSON.stringify({ loopback: true, users: FIXTURES.map((f) => ({ email: f.email, name: f.name, role: f.role })), rows: rows.length }));
