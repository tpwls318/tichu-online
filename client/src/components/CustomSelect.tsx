import React, { useState, useCallback, useRef, useEffect, memo } from 'react';
import './CustomSelect.css';

interface Option {
  value: number;
  label: string;
}

interface CustomSelectProps {
  options: Option[];
  defaultValue: number;
  onChangeRef?: React.MutableRefObject<number>;
}

export const CustomSelect = memo<CustomSelectProps>(({ options, defaultValue, onChangeRef }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState(defaultValue);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ref에 현재 값 동기화
  useEffect(() => {
    if (onChangeRef) onChangeRef.current = selected;
  }, [selected, onChangeRef]);

  const handleSelect = useCallback((value: number) => {
    setSelected(value);
    setIsOpen(false);
  }, []);

  const toggleOpen = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  // 드롭다운 열릴 때 선택된 항목을 중앙으로 스크롤
  useEffect(() => {
    if (isOpen && optionsRef.current) {
      const selectedEl = optionsRef.current.querySelector('.selected') as HTMLElement;
      if (selectedEl) {
        const container = optionsRef.current;
        const scrollTop = selectedEl.offsetTop - container.clientHeight / 2 + selectedEl.clientHeight / 2;
        container.scrollTop = Math.max(0, scrollTop);
      }
    }
  }, [isOpen]);

  const selectedLabel = options.find(o => o.value === selected)?.label ?? '';

  return (
    <div className="custom-select" ref={containerRef}>
      <div className="custom-select-trigger" onClick={toggleOpen}>
        <span>{selectedLabel}</span>
        <span className={`custom-select-arrow ${isOpen ? 'open' : ''}`}>▼</span>
      </div>
      {isOpen && (
        <div className="custom-select-options" ref={optionsRef}>
          {options.map(opt => (
            <div
              key={opt.value}
              className={`custom-select-option ${opt.value === selected ? 'selected' : ''}`}
              onClick={() => handleSelect(opt.value)}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
