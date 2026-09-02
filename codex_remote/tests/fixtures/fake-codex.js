#!/usr/bin/env node
const readline = require('node:readline');
function resultFor(method) {
  if (method === 'initialize') return { codexHome: process.env.CODEX_HOME || '/data/codex', platformOs: 'linux' };
  if (method === 'model/list') return { data: [] };
  if (method === 'thread/list') return { data: [], nextCursor: null };
  return {};
}
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  try {
    const message = JSON.parse(line);
    if (message.id !== undefined) process.stdout.write(`${JSON.stringify({ id: message.id, result: resultFor(message.method) })}\n`);
  } catch { /* Ignore malformed fixture input. */ }
});
