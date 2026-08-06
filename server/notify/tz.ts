/* Conversão de horário local do usuário (timezone IANA) → UTC, sem libs.
   As datas/horas do app são "locais do usuário"; o servidor roda em UTC. */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

function partsInTz(ms: number, tz: string) {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(ms)) p[x.type] = x.value;
  const h = +p.hour;
  return { y: +p.year, mo: +p.month, d: +p.day, h: h === 24 ? 0 : h, mi: +p.minute };
}

/* duas passadas convergem mesmo sobre transições de horário de verão */
export function localToUtc(dateYMD: string, timeHM: string, tz: string): Date {
  const [y, mo, d] = dateYMD.split('-').map(Number);
  const [h, mi] = timeHM.split(':').map(Number);
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let guess = want;
  for (let i = 0; i < 2; i++) {
    const p = partsInTz(guess, tz);
    guess += want - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  }
  return new Date(guess);
}

export function userTodayYMD(tz: string): string {
  const p = partsInTz(Date.now(), tz);
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function isValidTz(tz: string): boolean {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
