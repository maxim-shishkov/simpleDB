import type { AppTab, Theme } from "../types";
import { ThemeToggle } from "./ThemeToggle";

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  theme,
  onThemeChange,
}: {
  tabs: AppTab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}) {
  return (
    <div className="tabbar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={"tab" + (tab.id === activeId ? " active" : "")}
          onClick={() => onSelect(tab.id)}
          title={tab.title + (tab.connected ? " — подключено" : " — нет соединения")}
        >
          <span className={"dot" + (tab.connected ? " connected" : " disconnected")} />
          <span className="title">{tab.title}</span>
          <button
            className="close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" onClick={onNew} title="Новая вкладка">
        +
      </button>
      <div className="tabbar-spacer" data-tauri-drag-region />
      <ThemeToggle theme={theme} onChange={onThemeChange} />
    </div>
  );
}
