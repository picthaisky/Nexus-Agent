import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type Locale = "en" | "th";

type Dictionary = Record<string, string>;

const en: Dictionary = {
  "app.title": "Cyber-Thai Command Center",
  "nav.dashboard": "Dashboard",
  "nav.skills": "Skills",
  "nav.inference": "Inference",
  "auth.signIn": "Sign in",
  "auth.signOut": "Sign out",
  "auth.apiKey": "API Key",
  "auth.required": "Authentication required",
  "common.loading": "Loading…",
  "common.error": "Something went wrong",
  "common.retry": "Retry",
  "common.connected": "Connected",
  "common.disconnected": "Disconnected",
};

const th: Dictionary = {
  "app.title": "ศูนย์บัญชาการไซเบอร์ไทย",
  "nav.dashboard": "แดชบอร์ด",
  "nav.skills": "ทักษะ",
  "nav.inference": "ประมวลผล AI",
  "auth.signIn": "เข้าสู่ระบบ",
  "auth.signOut": "ออกจากระบบ",
  "auth.apiKey": "คีย์ API",
  "auth.required": "ต้องยืนยันตัวตน",
  "common.loading": "กำลังโหลด…",
  "common.error": "เกิดข้อผิดพลาด",
  "common.retry": "ลองใหม่",
  "common.connected": "เชื่อมต่อแล้ว",
  "common.disconnected": "ตัดการเชื่อมต่อ",
};

const DICTS: Record<Locale, Dictionary> = { en, th };

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const LOCAL_KEY = "nexus.locale";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = typeof window !== "undefined" ? window.localStorage.getItem(LOCAL_KEY) : null;
    return stored === "th" || stored === "en" ? stored : "th";
  });

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(LOCAL_KEY, next);
    } catch {
      /* ignore quota errors */
    }
  }, []);

  const t = useCallback(
    (key: string) => DICTS[locale][key] ?? DICTS.en[key] ?? key,
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
