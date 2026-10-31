
# Elnicko Space - VPS Manager Dashboard

Dashboard untuk manage banyak website di 1 VPS tanpa SSH.

## Tech Stack
- Next.js 14.2.35
- React 18.3.1
- Tailwind CSS 3.4.1
- System fonts only (no Google Fonts to avoid hydration errors)

## Local Dev
```bash
npm install
npm run dev
# http://localhost:3000
```

## Deploy to Vercel
```bash
vercel --prod
```
Set env vars in Vercel dashboard:
- VPS_API_URL = https://your-tunnel.trycloudflare.com
- VPS_TOKEN = your-secret-token

## VPS Agent
On VPS:
```bash
npm install
node agent.js
cloudflared tunnel --url http://localhost:4000
```

## Important - Avoid Hydration Bug
DO NOT use:
- @import url('https://fonts.googleapis.com/...') inside <style>{`...`}
- <link rel="stylesheet" href="https://fonts.googleapis.com..."> inside next/head
These cause "Text content does not match server-rendered HTML" and "Do not add stylesheets using next/head" errors in Next.js 14.

Use system fonts: font-family: ui-sans-serif, system-ui, -apple-system, etc.
Or if need Google Fonts, use next/font/google properly.
