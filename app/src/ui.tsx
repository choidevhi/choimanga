import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { Icon } from "./icons";

export function Switch({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return <button type="button" className={on ? "switch on" : "switch"} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export type SegmentOption<T extends string> = { value: T; label: string; icon?: ReactNode };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  small = false,
  disabled = false,
  name,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  small?: boolean;
  disabled?: boolean;
  name: string;
}) {
  return (
    <div className={small ? "segmented small" : "segmented"} role="tablist" aria-label={name} data-seg={name}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          className={option.value === value ? "on" : ""}
          data-value={option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export type PickOption = { value: string; label: string; sub?: string; style?: CSSProperties };

/** `<select>` 대신 쓰는 TDS 고르기: 누르면 가운데 시트에 목록이 뜨고, 고른 줄은 옅은 파랑 채움과 체크. */
export function Picker({
  title,
  options,
  value,
  onChange,
  name,
  empty = "고를 것이 없어요",
}: {
  title: string;
  options: readonly PickOption[];
  value: string;
  onChange: (next: string) => void;
  name: string;
  empty?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("keydown", close);
    listRef.current?.querySelector(".pick-row.on")?.scrollIntoView({ block: "center" });

    return () => window.removeEventListener("keydown", close);
  }, [open]);

  return (
    <>
      <button type="button" className="picker" data-picker={name} onClick={() => setOpen(true)}>
        <span className="clip">{current?.label ?? value}</span>
        <Icon.ChevronDown />
      </button>
      {open ? (
        <div className="scrim" data-sheet={name} onClick={() => setOpen(false)}>
          <div className="sheet" role="dialog" aria-label={title} onClick={(event) => event.stopPropagation()}>
            <div className="sheet-title">{title}</div>
            <div className="sheet-list" ref={listRef}>
              {options.length === 0 ? <div className="muted sheet-empty">{empty}</div> : null}
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={option.value === value ? "pick-row on" : "pick-row"}
                  data-option={option.value}
                  onClick={() => {
                    setOpen(false);
                    onChange(option.value);
                  }}
                >
                  <span className="grow">
                    <span className="clip" style={option.style}>
                      {option.label}
                    </span>
                    {option.sub !== undefined ? <span className="pick-sub clip">{option.sub}</span> : null}
                  </span>
                  <span className="tick">
                    <Icon.Check />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** 한 줄 높이로 시작해 내용에 따라 늘어나는 입력란. */
export function GrowText({
  value,
  onChange,
  onFocus,
  label,
  index,
}: {
  value: string;
  onChange: (next: string) => void;
  onFocus: () => void;
  label: string;
  index: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const area = ref.current;

    if (area === null) {
      return;
    }

    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className="grow-text"
      rows={1}
      value={value}
      spellCheck={false}
      aria-label={label}
      data-ko={index}
      onFocus={onFocus}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

type Toast = { text: string; ok: boolean };

export function useToast(): [ReactNode, (text: string, ok?: boolean) => void] {
  const [toast, setToast] = useState<Toast | null>(null);
  const [key, setKey] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback((text: string, ok = true) => {
    window.clearTimeout(timer.current);
    setToast({ text, ok });
    setKey((value) => value + 1);
    timer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const node =
    toast === null ? null : (
      <div className={toast.ok ? "hud" : "hud bad"} key={key} role="status">
        {toast.ok ? <Icon.Check /> : <Icon.Alert />}
        {toast.text}
      </div>
    );

  return [node, show];
}
