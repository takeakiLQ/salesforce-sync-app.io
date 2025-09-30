
import React, { useEffect, useMemo, useState } from "react";
import "./LocationSelectorModal.css";

const noop = () => {};

const normalizeOptions = (options = []) => {
  const result = [];
  const seen = new Set();
  options.forEach((option) => {
    if (!option && option !== 0) return;
    const value = String(option);
    if (seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });
  return result;
};

const LocationSelectorModal = ({
  isOpen,
  title,
  options,
  selectedValues,
  onClose = noop,
  onApply = noop,
  searchPlaceholder = "キーワード検索",
  allowSelectAll = true,
}) => {
  const normalizedOptions = useMemo(() => normalizeOptions(options), [options]);
  const [search, setSearch] = useState("");
  const [tempSelection, setTempSelection] = useState([]);

  useEffect(() => {
    if (!isOpen) return;
    const initial = (selectedValues || []).filter((value) =>
      normalizedOptions.includes(String(value))
    );
    setTempSelection(initial);
    setSearch("");
  }, [isOpen, selectedValues, normalizedOptions]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const filteredOptions = useMemo(() => {
    if (!search.trim()) return normalizedOptions;
    const keyword = search.trim();
    return normalizedOptions.filter((option) => option.includes(keyword));
  }, [normalizedOptions, search]);

  const updateSelection = (value, checked) => {
    setTempSelection((prev) => {
      const next = new Set(prev.map(String));
      const normalizedValue = String(value);
      if (checked) {
        next.add(normalizedValue);
      } else {
        next.delete(normalizedValue);
      }
      return Array.from(next);
    });
  };

  const handleSelectAll = () => {
    if (!allowSelectAll) return;
    setTempSelection(filteredOptions.slice());
  };

  const handleClear = () => {
    setTempSelection([]);
  };

  const handleApply = () => {
    onApply(tempSelection);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="location-modal__backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="location-modal__container">
        <div className="location-modal__header">
          <h3 className="location-modal__title">{title}</h3>
          <button
            type="button"
            className="clear-btn location-modal__close"
            onClick={onClose}
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        <div className="location-modal__controls">
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder}
            className="keyword-input location-modal__search"
          />
          {allowSelectAll && (
            <>
              <button type="button" className="clear-btn" onClick={handleSelectAll}>
                全選択
              </button>
              <button type="button" className="clear-btn" onClick={handleClear}>
                クリア
              </button>
            </>
          )}
        </div>

        <div className="location-modal__body">
          {filteredOptions.length ? (
            <div className="location-modal__option-list">
              {filteredOptions.map((option) => {
                const checked = tempSelection.includes(option);
                return (
                  <label key={option} className="location-modal__chip">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => updateSelection(option, event.target.checked)}
                    />
                    <span>{option}</span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="location-modal__empty">該当する選択肢はありません。</p>
          )}
        </div>

        <div className="location-modal__footer">
          <span className="location-modal__count">選択中：{tempSelection.length} 件</span>
          <div className="location-modal__actions">
            <button type="button" className="clear-btn" onClick={onClose}>
              キャンセル
            </button>
            <button type="button" className="search" onClick={handleApply}>
              決定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LocationSelectorModal;
