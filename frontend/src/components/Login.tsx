import React, { useState } from "react";
import { useAuth } from "../auth";
import { useI18n } from "../i18n";

export function Login() {
  const { setApiKey } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const [value, setValue] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) setApiKey(value.trim());
  };

  return (
    <div className="flex h-screen items-center justify-center bg-slate-950 text-slate-100">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-slate-700 bg-slate-900 p-8 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-cyan-300">{t("app.title")}</h1>
          <button
            type="button"
            onClick={() => setLocale(locale === "th" ? "en" : "th")}
            className="text-xs text-slate-400 hover:text-cyan-300"
          >
            {locale === "th" ? "EN" : "TH"}
          </button>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-300">{t("auth.apiKey")}</span>
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm focus:border-cyan-400 focus:outline-none"
            placeholder="nexus_xxxxxxxx"
          />
        </label>
        <button
          type="submit"
          disabled={!value.trim()}
          className="w-full rounded bg-cyan-500/20 px-3 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-40"
        >
          {t("auth.signIn")}
        </button>
      </form>
    </div>
  );
}

export default Login;
