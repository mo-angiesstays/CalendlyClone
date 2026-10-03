'use strict';
const path = require('path');
const express = require('express');
const cfg = require('./src/config');
const store = require('./src/store');
const auth = require('./src/auth');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.urlencoded({ extended: true, limit: '200kb' }));
app.use(express.json({ limit: '200kb' }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// Things every template can use
app.use((req, res, next) => {
  res.locals.appName = cfg.appName;
  res.locals.publicUrl = cfg.publicUrl;
  res.locals.signedIn = auth.isSignedIn(req);
  res.locals.ok = typeof req.query.ok === 'string' ? req.query.ok : '';
  res.locals.err = typeof req.query.err === 'string' ? req.query.err : '';
  res.locals.path = req.path;
  next();
});

// If .env isn't filled in yet, show a friendly setup page instead of errors.
app.use((req, res, next) => {
  const missing = cfg.missing();
  if (!missing.length || req.path.startsWith('/static')) return next();
  res.status(503).render('setup', { missing });
});

app.use('/', require('./src/routes/auth'));
app.use('/admin', auth.requireAdmin, require('./src/routes/admin'));
app.use('/', require('./src/routes/public'));

app.use((req, res) => {
  res.status(404).render('error', { title: 'Page not found', message: 'That page doesn\'t exist.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (!err.expose) console.error(err);
  const message = err.expose ? err.message : 'Something went wrong. Please try again.';
  if (req.path.startsWith('/api/')) return res.status(err.status || 500).json({ error: message });
  res.status(err.status || 500).render('error', { title: 'Something went wrong', message });
});

store.get();

if (require.main === module) {
  app.listen(cfg.port, () => {
    console.log(`\n  ${cfg.appName} is running.`);
    console.log(`  Open ${cfg.publicUrl}  (admin: ${cfg.publicUrl}/admin)\n`);
    const missing = cfg.missing();
    if (missing.length) console.log(`  Setup needed: missing ${missing.join(', ')} in .env\n`);
  });
}

module.exports = app;
