// Picks the login provider: Supabase Auth in production, the local stand-in
// otherwise. Both expose exactly the same functions.
const config = require('../../config');

module.exports = config.useSupabase ? require('./supabase') : require('./local');
