import { runTaskReport } from '../lib/task-report.js';

export const config = {
  maxDuration: 60
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const report = await runTaskReport();

    return res.status(200).json({
      ok: true,
      mode: req.method === 'POST' ? 'manual' : 'auto',
      ...report
    });
  } catch (error) {
    console.error('task-report error', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unexpected task report error'
    });
  }
}
