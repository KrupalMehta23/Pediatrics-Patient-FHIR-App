require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Config (set these in backend/.env) ───────────────────────────────────────
const FHIR_URL = process.env.FHIR_URL;
const TOKEN    = process.env.FHIR_TOKEN;

if (!FHIR_URL || !TOKEN) {
  console.error('\n❌  Missing config. Create backend/.env with:\n');
  console.error('   FHIR_URL=https://your-fhir-server/fhir');
  console.error('   FHIR_TOKEN=your-bearer-token\n');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ type: ['application/json', 'application/fhir+json'] }));

// ── Generic FHIR proxy — forwards GET / POST / PUT / DELETE ──────────────────
app.all('/fhir/*path', async (req, res) => {
  const fhirPath  = req.path.replace(/^\/fhir/, '');
  const qs        = Object.keys(req.query).length
    ? '?' + new URLSearchParams(req.query).toString()
    : '';
  const targetUrl = `${FHIR_URL}${fhirPath}${qs}`;

  console.log(`[FHIR] ${req.method} ${targetUrl}`);

  const options = {
    method:  req.method,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type':  'application/fhir+json',
      'Accept':        'application/fhir+json',
    },
  };

  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
    options.body = JSON.stringify(req.body);
  }

  try {
    const fhirRes = await fetch(targetUrl, options);
    const text    = await fhirRes.text();
    res.status(fhirRes.status).set('Content-Type', 'application/fhir+json').send(text);
  } catch (err) {
    console.error('[FHIR Proxy Error]', err.message);
    res.status(502).json({ error: 'FHIR proxy error', detail: err.message });
  }
});

// ── Health / connectivity check ───────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    const r = await fetch(`${FHIR_URL}/metadata`, {
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/fhir+json' },
    });
    res.json({ ok: r.ok, status: r.status, fhirUrl: FHIR_URL });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅  FHIR Proxy  →  http://localhost:${PORT}`);
  console.log(`🎯  Target      →  ${FHIR_URL}`);
  console.log(`🔍  Health      →  http://localhost:${PORT}/health\n`);
});
