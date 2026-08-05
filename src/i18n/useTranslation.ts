/**
 * Hook para usar traducciones en componentes React.
 * Lee el idioma actual del store global y expone t() / tp() / lang.
 */
import { useAppStore } from '../store/useAppStore';
import { t as _t, tp as _tp, type Lang } from './translations';

export function useTranslation() {
  const lang = useAppStore((s) => s.uiLang);
  const setLang = useAppStore((s) => s.setUiLang);
  return {
    lang,
    setLang: (l: Lang) => setLang(l),
    t: (key: string, params?: Record<string, string | number>) => _t(lang, key, params),
    tp: (key: string, n: number, params?: Record<string, string | number>) => _tp(lang, key, n, params),
  };
}
