import { useState } from "react";

/**
 * 自绘单选下拉（0.9.4 第七轮）：WebView 里原生 select 的弹层定位会被
 * backdrop-filter/合成层干扰而错位（食物柜入库与篮子条两次实机复现），
 * 少量选项的场合统一用本组件规避。选项多、需要搜索的场景不适用。
 */
export function MiniSelect({ value, options, onChange, ariaLabel }: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <span className="mini-select">
      <button type="button" className="mini-select-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => setOpen((state) => !state)}>
        {current?.label ?? value}
      </button>
      {open && (
        <>
          <span className="picker-overlay" onMouseDown={() => setOpen(false)} />
          <span className="mini-select-pop" role="listbox" aria-label={ariaLabel}>
            {options.map((option) => (
              <button type="button" key={option.value} role="option" aria-selected={option.value === value}
                className={option.value === value ? "active" : ""}
                onClick={() => { onChange(option.value); setOpen(false); }}>
                {option.label}
              </button>
            ))}
          </span>
        </>
      )}
    </span>
  );
}
