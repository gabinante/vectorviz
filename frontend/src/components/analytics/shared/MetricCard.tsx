/**
 * Metric card component for displaying individual statistics.
 */

import { CSSProperties, ReactNode } from 'react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  color?: string;
  onClick?: () => void;
}

const cardStyle = (color: string, clickable: boolean): CSSProperties => ({
  background: 'rgba(30, 30, 50, 0.9)',
  borderRadius: 8,
  padding: 16,
  borderLeft: `3px solid ${color}`,
  cursor: clickable ? 'pointer' : 'default',
  transition: 'transform 0.2s, box-shadow 0.2s',
});

const titleStyle: CSSProperties = {
  fontSize: 12,
  color: '#888',
  marginBottom: 8,
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const valueContainerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const valueStyle: CSSProperties = {
  fontSize: 28,
  fontWeight: 600,
  color: '#fff',
};

const subtitleStyle: CSSProperties = {
  fontSize: 11,
  color: '#666',
  marginTop: 8,
};

const trendStyle = (trend: 'up' | 'down' | 'neutral'): CSSProperties => ({
  fontSize: 12,
  fontWeight: 500,
  color: trend === 'up' ? '#51cf66' : trend === 'down' ? '#ff6b6b' : '#888',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
});

export function MetricCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendValue,
  color = '#4a90d9',
  onClick,
}: MetricCardProps) {
  return (
    <div
      style={cardStyle(color, !!onClick)}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (onClick) {
          e.currentTarget.style.transform = 'translateY(-2px)';
          e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'none';
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      <div style={titleStyle}>{title}</div>
      <div style={valueContainerStyle}>
        {icon && <span style={{ color }}>{icon}</span>}
        <span style={valueStyle}>{value}</span>
        {trend && trendValue && (
          <span style={trendStyle(trend)}>
            {trend === 'up' && '↑'}
            {trend === 'down' && '↓'}
            {trendValue}
          </span>
        )}
      </div>
      {subtitle && <div style={subtitleStyle}>{subtitle}</div>}
    </div>
  );
}
