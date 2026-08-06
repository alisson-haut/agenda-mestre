/* Carrega .env.local e .env (nesta ordem) para process.env no start do servidor.
   Variáveis já definidas no ambiente têm prioridade. Sem dependências. */
import { readFileSync } from 'node:fs';

for (const file of ['.env.local', '.env']) {
  try {
    const raw = readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      if (!(m[1] in process.env) && v !== '') process.env[m[1]] = v;
    }
  } catch {
    /* arquivo não existe — tudo bem */
  }
}
