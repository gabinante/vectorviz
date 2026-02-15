/**
 * Reusable table component for displaying issues/items.
 */

import { CSSProperties, ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  width?: string | number;
  render: (item: T, index: number) => ReactNode;
}

interface IssueTableProps<T> {
  data: T[];
  columns: Column<T>[];
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  getId: (item: T) => string;
  emptyMessage?: string;
  maxHeight?: number;
}

const containerStyle: CSSProperties = {
  background: 'rgba(30, 30, 50, 0.9)',
  borderRadius: 8,
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '12px 16px',
  background: 'rgba(20, 20, 40, 0.9)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  gap: 12,
};

const headerCellStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const bodyStyle = (maxHeight: number): CSSProperties => ({
  maxHeight,
  overflowY: 'auto',
});

const rowStyle = (selected: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  padding: '10px 16px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  background: selected ? 'rgba(74, 144, 217, 0.2)' : 'transparent',
  transition: 'background 0.2s',
  gap: 12,
});

const cellStyle: CSSProperties = {
  fontSize: 13,
  color: '#ccc',
};

const checkboxStyle: CSSProperties = {
  width: 16,
  height: 16,
  accentColor: '#4a90d9',
  cursor: 'pointer',
};

const emptyStyle: CSSProperties = {
  padding: 32,
  textAlign: 'center',
  color: '#666',
  fontSize: 14,
};

const selectionBarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 16px',
  background: 'rgba(74, 144, 217, 0.1)',
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
};

const selectionButtonStyle: CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: 'none',
  background: 'rgba(74, 144, 217, 0.3)',
  color: '#4a90d9',
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
};

export function IssueTable<T>({
  data,
  columns,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  getId,
  emptyMessage = 'No items found',
  maxHeight = 400,
}: IssueTableProps<T>) {
  const hasSelection = selectedIds && onToggleSelect;
  const selectedCount = selectedIds?.size ?? 0;

  return (
    <div style={containerStyle}>
      {/* Selection bar */}
      {hasSelection && (
        <div style={selectionBarStyle}>
          <span style={{ fontSize: 12, color: '#888' }}>
            {selectedCount} of {data.length} selected
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {onSelectAll && (
              <button
                style={selectionButtonStyle}
                onClick={onSelectAll}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(74, 144, 217, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(74, 144, 217, 0.3)';
                }}
              >
                Select All
              </button>
            )}
            {onClearSelection && selectedCount > 0 && (
              <button
                style={selectionButtonStyle}
                onClick={onClearSelection}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(74, 144, 217, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(74, 144, 217, 0.3)';
                }}
              >
                Clear Selection
              </button>
            )}
          </div>
        </div>
      )}

      {/* Header */}
      <div style={headerStyle}>
        {hasSelection && <div style={{ width: 24 }} />}
        {columns.map((col) => (
          <div
            key={col.key}
            style={{ ...headerCellStyle, width: col.width ?? 'auto', flex: col.width ? 'none' : 1 }}
          >
            {col.header}
          </div>
        ))}
      </div>

      {/* Body */}
      <div style={bodyStyle(maxHeight)}>
        {data.length === 0 ? (
          <div style={emptyStyle}>{emptyMessage}</div>
        ) : (
          data.map((item, index) => {
            const id = getId(item);
            const isSelected = selectedIds?.has(id) ?? false;

            return (
              <div
                key={id}
                style={rowStyle(isSelected)}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                {hasSelection && (
                  <input
                    type="checkbox"
                    style={checkboxStyle}
                    checked={isSelected}
                    onChange={() => onToggleSelect(id)}
                  />
                )}
                {columns.map((col) => (
                  <div
                    key={col.key}
                    style={{ ...cellStyle, width: col.width ?? 'auto', flex: col.width ? 'none' : 1 }}
                  >
                    {col.render(item, index)}
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
