import { useState } from "react";
import type { ConnectionConfig } from "../types";
import { api } from "../api";

export function ConnectionModal({
  initial,
  onClose,
  onSaved,
}: {
  initial?: ConnectionConfig;
  onClose: () => void;
  onSaved: (config: ConnectionConfig) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [host, setHost] = useState(initial?.host ?? "localhost");
  const [port, setPort] = useState(initial?.port ?? 5432);
  const [dbname, setDbname] = useState(initial?.dbname ?? "postgres");
  const [user, setUser] = useState(initial?.user ?? "postgres");
  const [password, setPassword] = useState("");
  const [sslMode, setSslMode] = useState(initial?.ssl_mode ?? false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);

  function buildConfig(): ConnectionConfig {
    return {
      id: initial?.id ?? crypto.randomUUID(),
      name: name.trim() || `${user}@${host}/${dbname}`,
      host: host.trim(),
      port: Number(port),
      dbname: dbname.trim(),
      user: user.trim(),
      ssl_mode: sslMode,
    };
  }

  async function handleTest() {
    setStatus(null);
    setTesting(true);
    try {
      // Поле пароля при редактировании специально пустое (чтобы не светить
      // сохранённый пароль в интерфейсе) — если пользователь его не менял,
      // подтягиваем реальный сохранённый пароль перед проверкой, иначе
      // проверка всегда будет пытаться подключиться с пустым паролем.
      let pwd = password;
      if (!pwd && initial) {
        pwd = await api.getConnectionPassword(initial.id);
      }
      await api.testConnection(buildConfig(), pwd);
      setStatus({ type: "success", text: "✅ Подключение успешно" });
    } catch (e) {
      setStatus({ type: "error", text: String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setStatus(null);
    setSaving(true);
    try {
      const cfg = buildConfig();
      await api.saveConnection(cfg, password);
      onSaved(cfg);
    } catch (e) {
      setStatus({ type: "error", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{initial ? "Редактировать подключение" : "Новое подключение"}</h2>

        <div className="field">
          <label>Название</label>
          <input
            type="text"
            value={name}
            placeholder="Например: Local dev"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field-row">
          <div className="field" style={{ flex: 3 }}>
            <label>Хост</label>
            <input type="text" value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Порт</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
            />
          </div>
        </div>

        <div className="field">
          <label>База данных</label>
          <input type="text" value={dbname} onChange={(e) => setDbname(e.target.value)} />
        </div>

        <div className="field-row">
          <div className="field">
            <label>Пользователь</label>
            <input type="text" value={user} onChange={(e) => setUser(e.target.value)} />
          </div>
          <div className="field">
            <label>Пароль</label>
            <input
              type="password"
              value={password}
              placeholder={initial ? "оставить прежний" : ""}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        <div className="checkbox-field">
          <input
            type="checkbox"
            id="ssl"
            checked={sslMode}
            onChange={(e) => setSslMode(e.target.checked)}
          />
          <label htmlFor="ssl">Использовать SSL</label>
        </div>

        {status && (
          <div className={status.type === "success" ? "modal-success" : "modal-error"}>
            {status.text}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={handleTest} disabled={testing}>
              {testing ? "Проверка..." : "Проверить"}
            </button>
            <button className="btn primary" onClick={handleSave} disabled={saving}>
              {saving ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
