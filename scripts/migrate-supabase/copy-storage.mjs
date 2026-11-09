// Copies every file of every bucket from the old project to the new one through the Storage API.
// Buckets must already exist in the new project (02-restore.sh creates them). Safe to run twice (upsert).
const { OLD_SUPABASE_URL, OLD_SERVICE_KEY, NEW_SUPABASE_URL, NEW_SERVICE_KEY } = process.env;
for (const [k, v] of Object.entries({ OLD_SUPABASE_URL, OLD_SERVICE_KEY, NEW_SUPABASE_URL, NEW_SERVICE_KEY })) {
  if (!v) throw new Error(`${k} غير مضبوط في migrate.env`);
}
if (OLD_SUPABASE_URL === NEW_SUPABASE_URL) throw new Error("رابط القديم والجديد متطابقان");
const api = (base, key) => async (path, init = {}) => {
  const res = await fetch(`${base}/storage/v1${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, apikey: key, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
  return res;
};
const oldApi = api(OLD_SUPABASE_URL.replace(/\/$/, ""), OLD_SERVICE_KEY);
const newApi = api(NEW_SUPABASE_URL.replace(/\/$/, ""), NEW_SERVICE_KEY);
const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

async function listAll(bucket, prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await oldApi(`/object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const page = await res.json();
    for (const item of page) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) files.push(...(await listAll(bucket, path)));   // a folder
      else files.push({ path, type: item.metadata?.mimetype ?? "application/octet-stream" });
    }
    if (page.length < 1000) return files;
  }
}

const buckets = await (await oldApi("/bucket")).json();
let total = 0, failed = 0;
for (const b of buckets) {
  const files = await listAll(b.name);
  console.log(`bucket ${b.name}: ${files.length} ملف`);
  for (const f of files) {
    try {
      const down = await oldApi(`/object/${encodeURIComponent(b.name)}/${enc(f.path)}`);
      const data = Buffer.from(await down.arrayBuffer());
      await newApi(`/object/${encodeURIComponent(b.name)}/${enc(f.path)}`, { method: "POST", headers: { "Content-Type": f.type, "x-upsert": "true" }, body: data });
      total++;
    } catch (e) {
      failed++;
      console.error("فشل:", b.name, f.path, String(e).slice(0, 200));
    }
  }
}
console.log(`انتهى: نُسخ ${total} ملف، فشل ${failed}`);
process.exit(failed ? 1 : 0);
