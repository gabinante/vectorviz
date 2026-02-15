/**
 * Main Analytics Dashboard component.
 * Provides navigation between different analytics panels.
 */

import { CSSProperties } from 'react';
import { useAnalyticsStore, AnalyticsPanel } from '@/store/useAnalyticsStore';
import { HealthOverview } from './HealthOverview';
import { DataQualityPanel } from './DataQualityPanel';
import { DistributionPanel } from './DistributionPanel';
import { DuplicatesPanel } from './DuplicatesPanel';
import { PerformancePanel } from './PerformancePanel';
import { ExportPanel } from './ExportPanel';
import { FingerprintPanel } from './FingerprintPanel';
import { StalenessPanel } from './StalenessPanel';
import { ContradictionsPanel } from './ContradictionsPanel';
import { ChunkQualityPanel } from './ChunkQualityPanel';
import { AnomalyPanel } from './AnomalyPanel';
import { DistanceHealthPanel } from './DistanceHealthPanel';

const containerStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
  display: 'flex',
  overflow: 'hidden',
};

const sidebarStyle: CSSProperties = {
  width: 220,
  background: 'rgba(20, 20, 40, 0.95)',
  borderRight: '1px solid rgba(255, 255, 255, 0.1)',
  display: 'flex',
  flexDirection: 'column',
  padding: '16px 0',
};

const logoStyle: CSSProperties = {
  padding: '8px 16px 24px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
  marginBottom: 16,
};

const logoTextStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: '#fff',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const navStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '0 8px',
  overflowY: 'auto',
};

const navItemStyle = (isActive: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  borderRadius: 6,
  background: isActive ? 'rgba(74, 144, 217, 0.2)' : 'transparent',
  color: isActive ? '#4a90d9' : '#888',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.2s',
  border: 'none',
  width: '100%',
  textAlign: 'left',
});

const sectionLabelStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: '#555',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  padding: '12px 12px 4px',
};

const contentStyle: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  fontFamily: 'system-ui, -apple-system, sans-serif',
};

interface NavItem {
  id: AnalyticsPanel;
  label: string;
  icon: JSX.Element;
}

const coreNavItems: NavItem[] = [
  {
    id: 'health',
    label: 'Health Overview',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </svg>
    ),
  },
  {
    id: 'data-quality',
    label: 'Data Quality',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="18" x2="12" y2="12" />
        <line x1="9" y1="15" x2="15" y2="15" />
      </svg>
    ),
  },
  {
    id: 'distribution',
    label: 'Distribution',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="4" />
        <line x1="4.93" y1="4.93" x2="9.17" y2="9.17" />
        <line x1="14.83" y1="14.83" x2="19.07" y2="19.07" />
        <line x1="14.83" y1="9.17" x2="19.07" y2="4.93" />
        <line x1="4.93" y1="19.07" x2="9.17" y2="14.83" />
      </svg>
    ),
  },
  {
    id: 'duplicates',
    label: 'Duplicates',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
    ),
  },
];

const inspectorNavItems: NavItem[] = [
  {
    id: 'fingerprint',
    label: 'Fingerprint',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 10a4 4 0 0 0-4 4c0 2.5 2 4.5 4 6" />
        <path d="M12 10a4 4 0 0 1 4 4c0 2.5-2 4.5-4 6" />
        <path d="M12 6a8 8 0 0 0-8 8c0 3 1.5 5.5 4 7.5" />
        <path d="M12 6a8 8 0 0 1 8 8c0 3-1.5 5.5-4 7.5" />
        <circle cx="12" cy="14" r="1" />
      </svg>
    ),
  },
  {
    id: 'staleness',
    label: 'Staleness',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    id: 'contradictions',
    label: 'Contradictions',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  {
    id: 'chunk-quality',
    label: 'Chunk Quality',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    id: 'anomalies',
    label: 'Anomalies',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  {
    id: 'distance-health',
    label: 'Distance Health',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="12" y1="20" x2="12" y2="10" />
        <line x1="18" y1="20" x2="18" y2="4" />
        <line x1="6" y1="20" x2="6" y2="16" />
      </svg>
    ),
  },
];

const toolNavItems: NavItem[] = [
  {
    id: 'performance',
    label: 'Performance',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    id: 'export',
    label: 'Export',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    ),
  },
];

function renderPanel(panel: AnalyticsPanel) {
  switch (panel) {
    case 'health':
      return <HealthOverview />;
    case 'data-quality':
      return <DataQualityPanel />;
    case 'distribution':
      return <DistributionPanel />;
    case 'duplicates':
      return <DuplicatesPanel />;
    case 'fingerprint':
      return <FingerprintPanel />;
    case 'staleness':
      return <StalenessPanel />;
    case 'contradictions':
      return <ContradictionsPanel />;
    case 'chunk-quality':
      return <ChunkQualityPanel />;
    case 'anomalies':
      return <AnomalyPanel />;
    case 'distance-health':
      return <DistanceHealthPanel />;
    case 'performance':
      return <PerformancePanel />;
    case 'export':
      return <ExportPanel />;
    default:
      return <HealthOverview />;
  }
}

function NavButton({ item, isActive, onClick }: { item: NavItem; isActive: boolean; onClick: () => void }) {
  return (
    <button
      style={navItemStyle(isActive)}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
          e.currentTarget.style.color = '#ccc';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = '#888';
        }
      }}
    >
      {item.icon}
      {item.label}
    </button>
  );
}

export function AnalyticsDashboard() {
  const { currentPanel, setCurrentPanel } = useAnalyticsStore();

  return (
    <div style={containerStyle}>
      {/* Sidebar Navigation */}
      <div style={sidebarStyle}>
        <div style={logoStyle}>
          <div style={logoTextStyle}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4a90d9" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
            </svg>
            Analytics
          </div>
        </div>

        <nav style={navStyle}>
          {coreNavItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              isActive={currentPanel === item.id}
              onClick={() => setCurrentPanel(item.id)}
            />
          ))}

          <div style={sectionLabelStyle}>Inspector</div>
          {inspectorNavItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              isActive={currentPanel === item.id}
              onClick={() => setCurrentPanel(item.id)}
            />
          ))}

          <div style={sectionLabelStyle}>Tools</div>
          {toolNavItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              isActive={currentPanel === item.id}
              onClick={() => setCurrentPanel(item.id)}
            />
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <div style={{ fontSize: 11, color: '#666', textAlign: 'center' }}>
            VectorViz Analytics
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div style={contentStyle}>{renderPanel(currentPanel)}</div>
    </div>
  );
}
