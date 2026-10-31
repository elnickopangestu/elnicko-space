
const http = require('http');
const { exec } = require('child_process');

const PORT = process.env.AGENT_PORT || 4000;
const TOKEN = process.env.VPS_TOKEN || 'dev-token';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${TOKEN}`) {
    res.writeHead(401);
    return res.end(JSON.stringify({ error: 'Unauthorized' }));
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const domain = url.pathname.split('/').pop();

  console.log(`[AGENT] ${req.method} ${url.pathname}`);

  // Simulate deploy
  exec(`echo "Deploying ${domain}..."`, (err, stdout) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, domain, output: stdout }));
  });
});

server.listen(PORT, () => console.log(`[ELNICKO SPACE AGENT] Running on :${PORT}`));
