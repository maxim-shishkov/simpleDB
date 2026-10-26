import {
    Hash,
    Type,
    Calendar,
    Clock3,
    ToggleLeft,
    Fingerprint,
    Binary,
    ListTree,
    MapPin,
    CircleHelp,
} from "lucide-react";

type Props = {
    type: string;
};

function iconFor(type: string): JSX.Element {
    const t = type.toLowerCase().trim();

    // Массив — проверяем ПЕРВЫМ делом, до всех остальных проверок: иначе,
    // например, "int4[]" перехватывается более ранней проверкой на "int" и
    // до сюда просто не доходит. Показываем как [вложенная иконка типа].
    // Вложенный вызов идёт напрямую в iconFor (не через ColumnTypeIcon),
    // чтобы не плодить вложенные тултипы — подсказка одна, на всём блоке.
    if (t.endsWith("[]")) {
        const elementType = type.trim().slice(0, -2);
        return (
            <span className="type-array-icon">
                <span className="type-array-bracket">[</span>
                {iconFor(elementType)}
                <span className="type-array-bracket">]</span>
            </span>
        );
    }

    // json/jsonb — просто фигурные скобки, без отдельной иконки
    if (t.includes("json")) {
        return <span className="type-json-braces">{"{}"}</span>;
    }

    // числа
    if (
        t.includes("int") ||
        t.includes("serial") ||
        t.includes("numeric") ||
        t.includes("decimal") ||
        t.includes("float") ||
        t.includes("double") ||
        t.includes("real") ||
        t.includes("money")
    ) {
        return <Hash size={15} className="type-number" />;
    }

    // строки
    if (t.includes("char") || t.includes("varchar") || t.includes("text")) {
        return <Type size={15} className="type-text" />;
    }

    // UUID
    if (t.includes("uuid")) {
        return <Fingerprint size={15} className="type-uuid" />;
    }

    // boolean
    if (t.includes("bool")) {
        return <ToggleLeft size={15} className="type-bool" />;
    }

    // timestamp
    if (t.includes("timestamp")) {
        return <Clock3 size={15} className="type-time" />;
    }

    // date
    if (t === "date" || t.includes(" date")) {
        return <Calendar size={15} className="type-date" />;
    }

    // bytea
    if (t.includes("bytea")) {
        return <Binary size={15} className="type-binary" />;
    }

    // enum
    if (t.includes("enum")) {
        return <ListTree size={15} className="type-enum" />;
    }

    // geometry/postgis
    if (
        t.includes("geometry") ||
        t.includes("geography") ||
        t.includes("point") ||
        t.includes("polygon")
    ) {
        return <MapPin size={15} className="type-geo" />;
    }

    return <CircleHelp size={15} className="type-default" />;
}

/** Иконка типа колонки с красивой (не нативной) всплывающей подсказкой —
 * при наведении показывает полное имя типа Postgres. */
export function ColumnTypeIcon({ type }: Props) {
    return (
        <span className="type-icon-tooltip" data-tooltip={type}>
            {iconFor(type)}
        </span>
    );
}
