'use client';
import { useEffect, useState } from 'react';

/** The value once it has stayed the same for `ms` — so the ticket asks the Margin API once per settled input, not per keystroke. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
