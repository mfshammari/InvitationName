const { put, get } = require('@vercel/blob');
const fs = require('fs'), path = require('path');
const AR = '٠١٢٣٤٥٦٧٨٩';
function parseSeed() {
  const txt = fs.readFileSync(path.join(__dirname, '../data/seed.txt'), 'utf8');
  const out = []; let sec = '', br = '', i = 0;
  for (const raw of txt.split('\n')) {
    const ln = raw.trim(); if (!ln) continue;
    if (ln.startsWith('##')) { sec = ln.slice(2).trim(); br = ''; continue; }
    if (/^[-—]{2,}/.test(ln)) { br = ln.replace(/^[-—]{2,}\s*/, ''); continue; }
    const star = ln.endsWith('*'); const e = ln.replace(/[* ]+$/, '');
    const m = e.match(/^(.*?)\s*\(([٠-٩]+)\)$/);
    const cnt = m ? parseInt([...m[2]].map(c => AR.indexOf(c)).join(''), 10) : 0;
    out.push({ id: 's' + (++i), section: sec, branch: br, name: (m ? m[1] : e).trim(), count: cnt, note: star ? '★' : '' });
  }
  return out;
}
const seed = parseSeed();

const KEY = 'guests.json';
const LOG = 'log.json';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || Object.entries(process.env).find(([k]) => k.endsWith('BLOB_READ_WRITE_TOKEN'))?.[1];
const STORE_ID = process.env.BLOB_STORE_ID || Object.entries(process.env).find(([k]) => k.endsWith('BLOB_STORE_ID'))?.[1];
const HAS_STORE = !!(TOKEN || STORE_ID);
const AUTH = TOKEN ? { token: TOKEN } : (STORE_ID ? { storeId: STORE_ID } : {});
async function load() {
  if (!HAS_STORE) return { guests: seed, seeded: false };
  const res = await get(KEY, { access: 'private', useCache: false, ...AUTH });
  if (!res) return { guests: seed, seeded: true };
  const txt = await new Response(res.stream).text();
  return { guests: JSON.parse(txt), seeded: false };
}
async function save(guests) {
  await put(KEY, JSON.stringify(guests), {
    access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', ...AUTH,
  });
}
const clean = (s) => String(s || '').trim().slice(0, 80);
const cleanPhone = (s) => { let p = String(s || '').replace(/[^\d+]/g, ''); if (p.startsWith('+966')) p = '0' + p.slice(4); else if (p.startsWith('966')) p = '0' + p.slice(3); else if (/^5\d{8}$/.test(p)) p = '0' + p; return p.slice(0, 15); };
const norm = (s) => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[\u064B-\u0652]/g, '').replace(/\s+/g, ' ').trim();
function loadOps() { try { return JSON.parse(fs.readFileSync(path.join(__dirname, '../data/phones.json'), 'utf8')); } catch { return []; } }
async function readLog() {
  if (!HAS_STORE) return [];
  const r = await get(LOG, { access: 'private', useCache: false, ...AUTH });
  if (!r) return [];
  try { return JSON.parse(await new Response(r.stream).text()); } catch { return []; }
}
async function logEvent(ev) {
  const log = await readLog();
  log.unshift({ at: new Date().toISOString(), ...ev });
  await put(LOG, JSON.stringify(log.slice(0, 2000)), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json', ...AUTH });
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET' && req.query && req.query.log !== undefined) {
      return res.status(200).json({ log: await readLog() });
    }
    if (req.method === 'GET') {
      const { guests, seeded } = await load();
      if (seeded) await save(guests);
      return res.status(200).json({ guests, readonly: !HAS_STORE });
    }
    if (req.method !== 'POST') return res.status(405).end();
    if (!HAS_STORE) return res.status(503).json({ error: 'التخزين غير مفعّل بعد — اربط Blob بالمشروع' });
    const b = req.body || {};
    let { guests } = await load();
    const admin = b.pin && b.pin === process.env.ADMIN_PIN;

    if (b.action === 'add') {
      const section = clean(b.section), name = clean(b.name);
      const count = Math.max(0, Math.min(99, parseInt(b.count, 10) || 0));
      if (!section) return res.status(400).json({ error: 'اختر التقسيمة' });
      if (!name) return res.status(400).json({ error: 'اكتب الاسم' });
      const g = { id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        section, branch: clean(b.branch), name, count, note: clean(b.note), phone: cleanPhone(b.phone), by: clean(b.by), at: new Date().toISOString() };
      guests.push(g);
      await save(guests);
      await logEvent({ action: 'add', name: g.name, section: g.section, branch: g.branch, count: g.count, by: g.by });
      return res.status(200).json({ ok: true, guest: g });
    }
    if (b.action === 'update' || b.action === 'delete' || b.action === 'restore') {
      if (!admin) return res.status(403).json({ error: 'الرمز غير صحيح' });
      const i = guests.findIndex((g) => g.id === b.id);
      if (i < 0) return res.status(404).json({ error: 'غير موجود' });
      const before = guests[i];
      if (b.action === 'delete') guests[i] = { ...guests[i], removed: true };
      else if (b.action === 'restore') { const { removed, ...g } = guests[i]; guests[i] = g; }
      else guests[i] = { ...guests[i], section: clean(b.section) || guests[i].section, branch: clean(b.branch),
        name: clean(b.name) || guests[i].name, count: Math.max(0, Math.min(99, parseInt(b.count, 10) || 0)), note: clean(b.note), phone: b.phone === undefined ? guests[i].phone : cleanPhone(b.phone) };
      await save(guests);
      const after = guests[i]; const changes = [];
      if (b.action === 'update') for (const k of ['section', 'branch', 'name', 'count', 'phone']) if (String(before[k] ?? '') !== String(after[k] ?? '')) changes.push(`${k}: ${before[k] ?? '—'} ← ${after[k] ?? '—'}`);
      await logEvent({ action: b.action, name: after.name, section: after.section, branch: after.branch, count: after.count, by: clean(b.by), changes });
      return res.status(200).json({ ok: true });
    }
    if (b.action === 'import') {
      if (!admin) return res.status(403).json({ error: 'الرمز غير صحيح' });
      const ops = loadOps(); const out = { phones: 0, renamed: 0, added: 0, skipped: 0, missing: [] };
      for (const op of ops) {
        if (op.add) {
          const dup = guests.find((g) => norm(g.name) === norm(op.name) && g.section === op.section);
          if (dup) { if (op.phone && !dup.phone) { dup.phone = op.phone; out.phones++; } else out.skipped++; continue; }
          guests.push({ id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), section: op.section, branch: op.branch || '',
            name: op.name, count: op.count || 1, note: '', phone: op.phone || '', by: 'استيراد', at: new Date().toISOString() });
          out.added++; continue;
        }
        const g = guests.find((x) => !x.removed && x.section === op.section && (!op.branch || (x.branch || '') === op.branch) && norm(x.name) === norm(op.match))
               || guests.find((x) => !x.removed && norm(x.name) === norm(op.rename || op.match));
        if (!g) { out.missing.push(op.match); continue; }
        let ch = false;
        if (op.rename && g.name !== op.rename) { g.name = op.rename; out.renamed++; ch = true; }
        if (op.phone && g.phone !== op.phone) { g.phone = op.phone; out.phones++; ch = true; }
        if (!ch) out.skipped++;
      }
      await save(guests);
      await logEvent({ action: 'import', name: `استيراد الأرقام: ${out.phones} رقم، ${out.renamed} تعديل اسم، ${out.added} إضافة`, section: '', branch: '', count: 0, by: clean(b.by) });
      return res.status(200).json({ ok: true, ...out });
    }
    return res.status(400).json({ error: 'bad action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
