// Express 4 doesn't catch errors from async handlers; this passes them on to
// the error page instead of leaving the request hanging.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
