import { Languages } from "lucide-react";
import { useI18n } from "../i18n";

export function LanguageSelector() {
  const { language, setLanguage, tr } = useI18n();
  return (
    <label className="language-selector" title={tr("Язык интерфейса", "Interface language")}>
      <Languages aria-hidden="true" size={14} />
      <select
        aria-label={tr("Язык интерфейса", "Interface language")}
        onChange={(event) => setLanguage(event.target.value as "ru" | "en")}
        value={language}
      >
        <option value="ru">Русский</option>
        <option value="en">English</option>
      </select>
    </label>
  );
}
