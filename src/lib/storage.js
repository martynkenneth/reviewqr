// Where logos are kept: the "logos" bucket in Supabase Storage in production,
// a local folder otherwise. Logos are always served from /u/<file>; on Netlify
// that path is passed straight through to Supabase (see scripts/netlify-build.js).
const fs = require('fs');
const path = require('path');
const config = require('../config');

const BUCKET = 'logos';
const safe = (name) => path.basename(String(name));

const supabaseStore = {
  async put(name, buf) {
    const { admin } = require('./supabase');
    const { error } = await admin()
      .storage.from(BUCKET)
      .upload(safe(name), buf, { contentType: 'image/png', cacheControl: '31536000', upsert: false });
    if (error) throw new Error(`Logo upload failed: ${error.message}`);
  },
  async get(name) {
    const { admin } = require('./supabase');
    const { data, error } = await admin().storage.from(BUCKET).download(safe(name));
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  },
  async remove(name) {
    const { admin } = require('./supabase');
    await admin().storage.from(BUCKET).remove([safe(name)]);
  },
  publicUrl: (name) => `${config.supabase.url}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(safe(name))}`,
};

const localStore = {
  async put(name, buf) {
    fs.mkdirSync(config.uploadDir, { recursive: true });
    fs.writeFileSync(path.join(config.uploadDir, safe(name)), buf);
  },
  async get(name) {
    const file = path.join(config.uploadDir, safe(name));
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  },
  async remove(name) {
    fs.rmSync(path.join(config.uploadDir, safe(name)), { force: true });
  },
  publicUrl: null,
};

module.exports = config.useSupabase ? supabaseStore : localStore;
