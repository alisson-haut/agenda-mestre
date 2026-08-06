import { useEffect, useRef, useState } from 'react';

/* negação de (min-width:900px) para casar EXATAMENTE com o breakpoint do CSS —
   com (max-width:899px) haveria uma zona morta em larguras fracionárias (899–900px) */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => !window.matchMedia('(min-width:900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width:900px)');
    const fn = () => setNarrow(!mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return narrow;
}

/* mouse/trackpad de verdade — telas touch grandes (tablet paisagem) ficam de fora */
export function useHoverable(): boolean {
  const [hoverable, setHoverable] = useState(() => window.matchMedia('(hover:hover) and (pointer:fine)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(hover:hover) and (pointer:fine)');
    const fn = () => setHoverable(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return hoverable;
}

export interface ToastState {
  msg: string;
  label: string;
  visible: boolean;
  hasAction: boolean;
}
export interface ToastApi {
  state: ToastState;
  show(msg: string, fn?: (() => void) | null, label?: string): void;
  hide(): void;
  act(): void;
}

export function useToast(): ToastApi {
  const [state, setState] = useState<ToastState>({ msg: '', label: 'Desfazer', visible: false, hasAction: false });
  const fnRef = useRef<(() => void) | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const hide = () => {
    window.clearTimeout(timer.current);
    fnRef.current = null;
    setState((s) => ({ ...s, visible: false }));
  };
  const show = (msg: string, fn: (() => void) | null = null, label = 'Desfazer') => {
    window.clearTimeout(timer.current);
    fnRef.current = fn;
    setState({ msg, label, visible: true, hasAction: !!fn });
    timer.current = window.setTimeout(hide, fn ? 6500 : 2400);
  };
  const act = () => {
    const f = fnRef.current;
    hide();
    if (f) f();
  };
  return { state, show, hide, act };
}
