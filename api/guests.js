const { put, list } = require('@vercel/blob');
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

async function load() {
  const { blobs } = await list({ prefix: KEY, limit: 1 });
  if (!blobs.length) return { guests: seed, seeded: true };
  const r = await fetch(blobs[0].url + '?t=' + Date.now(), { cache: 'no-store' });
  return { guests: await r.json(), seeded: false };
}
async function save(guests) {
  await put(KEY, JSON.stringify(guests), {
    access: 'public', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json',
  });
}
const clean = (s) => String(s || '').trim().slice(0, 80);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const { guests, seeded } = await load();
      if (seeded) await save(guests);
      return res.status(200).json({ guests });
    }
    if (req.method !== 'POST') return res.status(405).end();
    const b = req.body || {};
    let { guests } = await load();
    const admin = b.pin && b.pin === process.env.ADMIN_PIN;

    if (b.action === 'add') {
      const section = clean(b.section), name = clean(b.name);
      const count = Math.max(0, Math.min(99, parseInt(b.count, 10) || 0));
      if (!section) return res.status(400).json({ error: 'اختر التقسيمة' });
      if (!name) return res.status(400).json({ error: 'اكتب الاسم' });
      const g = { id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        section, branch: clean(b.branch), name, count, note: clean(b.note), by: clean(b.by), at: new Date().toISOString() };
      guests.push(g);
      await save(guests);
      return res.status(200).json({ ok: true, guest: g });
    }
    if (b.action === 'update' || b.action === 'delete') {
      if (!admin) return res.status(403).json({ error: 'الرمز غير صحيح' });
      const i = guests.findIndex((g) => g.id === b.id);
      if (i < 0) return res.status(404).json({ error: 'غير موجود' });
      if (b.action === 'delete') guests.splice(i, 1);
      else guests[i] = { ...guests[i], section: clean(b.section) || guests[i].section, branch: clean(b.branch),
        name: clean(b.name) || guests[i].name, count: Math.max(0, Math.min(99, parseInt(b.count, 10) || 0)), note: clean(b.note) };
      await save(guests);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: 'bad action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
