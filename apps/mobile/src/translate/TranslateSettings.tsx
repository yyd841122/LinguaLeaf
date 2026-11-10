import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  DEFAULT_TRANSLATE_SETTINGS,
  isConfigured,
  type TranslateSettings,
  type TranslateSettingsStore,
} from "../store/translate-settings-store";

// The translation settings page (mobile-app ticket 04, ADR-0008): the
// DeepSeek key, base URL and model are filled in at runtime and stored
// app-local — never compiled into the APK. Rendered as an overlay above
// whatever face opened it (landing or reading), the NoteEditor overlay
// precedent; a saved confirmation answers in place, and the /anthropic
// warning sits at the address field because that misconfiguration has
// already cost a debugging session once (server-side排障).

export function TranslateSettings({
  store,
  onClose,
}: {
  store: TranslateSettingsStore;
  onClose: () => void;
}) {
  const close = onClose;
  const [values, setValues] = useState<TranslateSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = () => {
    setLoadFailed(false);
    void store
      .load()
      .then((settings) => {
        setValues(settings);
      })
      .catch(() => {
        // A dead read must not freeze the veil on 「读取设置中…」 — the
        // notes-read precedent: a readable failure with the retry in it.
        setLoadFailed(true);
      });
  };

  useEffect(load, [store]);

  if (!values) {
    return (
      <div className="settings-veil" role="dialog" aria-label="翻译设置">
        {loadFailed ? (
          <p className="reader-error" role="alert">
            设置读取失败，无法确认已保存的配置。
            <button type="button" onClick={load}>
              重试读取设置
            </button>
          </p>
        ) : (
          <p className="reader-status">读取设置中…</p>
        )}
      </div>
    );
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const baseUrl = values.baseUrl.trim();
    if (baseUrl.length > 0 && !/^https?:\/\//.test(baseUrl)) {
      setError("接口地址需以 http:// 或 https:// 开头。");
      setSaved(false);
      return;
    }
    setError(null);
    void store
      .save({
        // An emptied field falls back to its default at save time — the
        // stored record always carries explicit, usable values.
        apiKey: values.apiKey.trim(),
        baseUrl:
          baseUrl.length > 0 ? baseUrl : DEFAULT_TRANSLATE_SETTINGS.baseUrl,
        model:
          values.model.trim().length > 0
            ? values.model.trim()
            : DEFAULT_TRANSLATE_SETTINGS.model,
      })
      .then(() => {
        setSaved(true);
        setError(null);
      });
  };

  return (
    <div className="settings-veil" role="dialog" aria-label="翻译设置">
      <form className="settings-card" onSubmit={submit}>
        <h2 className="settings-title">翻译设置</h2>
        <label className="settings-field">
          <span className="settings-label">API Key</span>
          <input
            type="password"
            autoComplete="off"
            aria-label="API Key"
            value={values.apiKey}
            onChange={(e) => setValues({ ...values, apiKey: e.target.value })}
          />
        </label>
        {!isConfigured(values) ? (
          <p className="settings-hint" aria-label="密钥未配置提示">
            尚未填写 Key，翻译按钮暂不可用。
          </p>
        ) : null}
        <label className="settings-field">
          <span className="settings-label">接口地址（BASE_URL）</span>
          <input
            type="text"
            spellCheck={false}
            autoCapitalize="off"
            aria-label="接口地址（BASE_URL）"
            placeholder={DEFAULT_TRANSLATE_SETTINGS.baseUrl}
            value={values.baseUrl}
            onChange={(e) => setValues({ ...values, baseUrl: e.target.value })}
          />
          <span className="settings-hint">
            填 OpenAI 兼容根地址（默认 {DEFAULT_TRANSLATE_SETTINGS.baseUrl}
            ，程序自动拼接 /chat/completions）；勿带 /anthropic 等后缀——那是给
            Claude 类客户端的端点。
          </span>
        </label>
        <label className="settings-field">
          <span className="settings-label">模型（MODEL）</span>
          <input
            type="text"
            spellCheck={false}
            autoCapitalize="off"
            aria-label="模型（MODEL）"
            placeholder={DEFAULT_TRANSLATE_SETTINGS.model}
            value={values.model}
            onChange={(e) => setValues({ ...values, model: e.target.value })}
          />
          <span className="settings-hint">
            留空用默认 {DEFAULT_TRANSLATE_SETTINGS.model}。
          </span>
        </label>
        {error ? (
          <p className="settings-error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="settings-saved" role="status">
            已保存
          </p>
        ) : null}
        <div className="settings-actions">
          <button type="submit" className="settings-save">
            保存
          </button>
          <button
            type="button"
            className="settings-close"
            onClick={() => {
              close();
            }}
          >
            关闭
          </button>
        </div>
      </form>
    </div>
  );
}
