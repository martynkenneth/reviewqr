// Netlify runs the whole app as this one function. Static files in public/
// are served by Netlify's CDN; every other request is passed here
// (see the _redirects file written by scripts/netlify-build.js).
const serverless = require('serverless-http');
const { createApp } = require('../../src/server');

exports.handler = serverless(createApp(), {
  // Send images and PDFs back as binary, not text.
  binary: ['image/*', 'application/pdf', 'application/octet-stream'],
  // In case a request arrives at the function's own address.
  basePath: '/.netlify/functions/app',
});
