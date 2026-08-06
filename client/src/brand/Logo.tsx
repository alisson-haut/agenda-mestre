/* Identidade visual do AgendaMestre — isotipo "[·]" e wordmark.
   Geometria: quadrado arredondado em contorno com três aberturas (topo,
   base e lateral direita) + ponto central. Paleta: Verde Mestre #00E09A →
   Verde Profundo #0A7F64. */
import { useId } from 'react';

/* três subpaths explícitos (determinístico entre renderizadores) */
const MARK_PATH = [
  'M39 6 L42 6 A16 16 0 0 1 58 22 L58 25',
  'M58 39 L58 42 A16 16 0 0 1 42 58 L39 58',
  'M25 58 L22 58 A16 16 0 0 1 6 42 L6 22 A16 16 0 0 1 22 6 L25 6',
].join(' ');

export function LogoMark({
  size = 28,
  tone = 'mono',
  title,
}: {
  size?: number;
  tone?: 'mono' | 'gradient';
  title?: string;
}) {
  const gid = useId();
  const stroke = tone === 'gradient' ? `url(#${gid})` : 'currentColor';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      {...(title ? { role: 'img' } : { 'aria-hidden': true })}
    >
      {title && <title>{title}</title>}
      {tone === 'gradient' && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#00E09A" />
            <stop offset="1" stopColor="#0A7F64" />
          </linearGradient>
        </defs>
      )}
      <path d={MARK_PATH} stroke={stroke} strokeWidth="7" strokeLinecap="round" />
      <circle cx="32" cy="32" r="4.5" fill={stroke} />
    </svg>
  );
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={`brand-name ${className || ''}`}>
      AgendaMestre<i className="brand-dot">·</i>
    </span>
  );
}
