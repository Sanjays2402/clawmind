import { useEffect, useState } from 'react';
export function useDebounced<T>(value: T, ms = 250): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return out;
}
