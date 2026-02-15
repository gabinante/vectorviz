/**
 * Settings panel for database connection configuration.
 */

import { useState, useEffect } from 'react';
import { api, ConnectionConfig, ConnectionStatus, ConnectorType, SavedConnection } from '@/api';

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onConnectionChange: () => void;
}

const CONNECTOR_OPTIONS: { value: ConnectorType; label: string; available: boolean }[] = [
  { value: 'weaviate', label: 'Weaviate', available: true },
  { value: 'pinecone', label: 'Pinecone (Coming Soon)', available: false },
  { value: 'chromadb', label: 'ChromaDB (Coming Soon)', available: false },
  { value: 'pgvector', label: 'pgvector (Coming Soon)', available: false },
];

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  panel: {
    width: 400,
    background: 'rgba(26, 26, 46, 0.98)',
    borderRadius: 12,
    padding: 24,
    color: '#fff',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 14,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: '#4a90d9',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 4,
    border: 'none',
    background: 'transparent',
    color: '#888',
    fontSize: 20,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    marginBottom: 20,
  },
  label: {
    display: 'block',
    marginBottom: 6,
    fontSize: 12,
    fontWeight: 500,
    color: '#aaa',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid #333',
    background: '#2a2a4a',
    color: '#fff',
    fontSize: 14,
    cursor: 'pointer',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid #333',
    background: '#2a2a4a',
    color: '#fff',
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box' as const,
  },
  inputDisabled: {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 6,
    border: '1px solid #222',
    background: '#1a1a3a',
    color: '#666',
    fontSize: 14,
    boxSizing: 'border-box' as const,
  },
  row: {
    display: 'flex',
    gap: 12,
    marginBottom: 12,
  },
  field: {
    flex: 1,
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 16px',
    borderRadius: 6,
    marginBottom: 20,
  },
  statusConnected: {
    background: 'rgba(81, 207, 102, 0.15)',
    border: '1px solid rgba(81, 207, 102, 0.3)',
  },
  statusDisconnected: {
    background: 'rgba(255, 107, 107, 0.15)',
    border: '1px solid rgba(255, 107, 107, 0.3)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  buttonRow: {
    display: 'flex',
    gap: 12,
    marginTop: 24,
  },
  button: {
    flex: 1,
    padding: '12px 16px',
    borderRadius: 6,
    border: 'none',
    background: '#4a90d9',
    color: '#fff',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  buttonDisabled: {
    flex: 1,
    padding: '12px 16px',
    borderRadius: 6,
    border: 'none',
    background: '#333',
    color: '#666',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'not-allowed',
  },
  buttonSecondary: {
    flex: 1,
    padding: '12px 16px',
    borderRadius: 6,
    border: '1px solid #4a90d9',
    background: 'transparent',
    color: '#4a90d9',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  buttonDanger: {
    flex: 1,
    padding: '12px 16px',
    borderRadius: 6,
    border: '1px solid #ff6b6b',
    background: 'transparent',
    color: '#ff6b6b',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  error: {
    color: '#ff6b6b',
    fontSize: 12,
    marginTop: 8,
  },
  savedSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 12,
  },
  savedList: {
    border: '1px solid #333',
    borderRadius: 6,
    overflow: 'hidden',
  },
  savedItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 14px',
    borderBottom: '1px solid #333',
    background: '#2a2a4a',
  },
  savedItemLast: {
    borderBottom: 'none',
  },
  savedItemInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  savedItemName: {
    fontSize: 14,
    fontWeight: 500,
    color: '#fff',
  },
  savedItemHost: {
    fontSize: 12,
    color: '#888',
  },
  savedItemActions: {
    display: 'flex',
    gap: 8,
  },
  smallButton: {
    padding: '6px 12px',
    borderRadius: 4,
    border: 'none',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
  },
  smallButtonPrimary: {
    background: '#4a90d9',
    color: '#fff',
  },
  smallButtonDanger: {
    background: 'transparent',
    border: '1px solid #ff6b6b',
    color: '#ff6b6b',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    margin: '20px 0',
    color: '#666',
    fontSize: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: '#333',
  },
  emptyState: {
    textAlign: 'center' as const,
    padding: '16px',
    color: '#666',
    fontSize: 13,
  },
};

export function SettingsPanel({ isOpen, onClose, onConnectionChange }: SettingsPanelProps) {
  const [connectorType, setConnectorType] = useState<ConnectorType>('weaviate');
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Saved connections
  const [savedConnections, setSavedConnections] = useState<SavedConnection[]>([]);
  const [connectionName, setConnectionName] = useState('');

  // Weaviate config
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('8080');
  const [grpcPort, setGrpcPort] = useState('50051');
  const [apiKey, setApiKey] = useState('');

  // Fetch current status and saved connections on open
  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      fetchSavedConnections();
    }
  }, [isOpen]);

  const fetchStatus = async () => {
    try {
      const currentStatus = await api.getConnectionStatus();
      setStatus(currentStatus);

      // Update form with current config if connected
      if (currentStatus.connected && currentStatus.connector_type) {
        setConnectorType(currentStatus.connector_type);
        if (currentStatus.host) setHost(currentStatus.host);
        if (currentStatus.port) setPort(String(currentStatus.port));
      }
    } catch (e) {
      // Connection status endpoint might not be available yet
      setStatus({ connected: false, connector_type: null, host: null, port: null, error: null });
    }
  };

  const fetchSavedConnections = async () => {
    try {
      const connections = await api.listSavedConnections();
      // Sort by last_used (most recent first), then by created_at
      connections.sort((a, b) => {
        const aTime = a.last_used ?? a.created_at;
        const bTime = b.last_used ?? b.created_at;
        return bTime - aTime;
      });
      setSavedConnections(connections);
    } catch (e) {
      // Saved connections might not be available yet
      setSavedConnections([]);
    }
  };

  const handleConnect = async (saveAfter = false) => {
    setIsLoading(true);
    setError(null);

    try {
      const config: ConnectionConfig = {
        type: connectorType,
        host,
        port: parseInt(port, 10),
        grpc_port: parseInt(grpcPort, 10),
        api_key: apiKey || undefined,
      };

      const result = await api.configureConnection(config);
      setStatus(result);

      if (result.connected) {
        onConnectionChange();

        // Save connection if requested
        if (saveAfter && connectionName.trim()) {
          try {
            await api.saveConnection({
              name: connectionName.trim(),
              db_type: connectorType,
              host,
              port: parseInt(port, 10),
              api_key: apiKey || undefined,
            });
            setConnectionName('');
            fetchSavedConnections();
          } catch (saveErr) {
            // Connection succeeded but save failed - don't block
            console.error('Failed to save connection:', saveErr);
          }
        }
      } else if (result.error) {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnectSaved = async (conn: SavedConnection) => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await api.connectSaved(conn.id);
      setStatus(result);

      if (result.connected) {
        // Update form fields to match the saved connection
        setConnectorType(conn.db_type as ConnectorType);
        setHost(conn.host);
        setPort(String(conn.port));
        setApiKey(''); // Don't show API key in form
        onConnectionChange();
        fetchSavedConnections(); // Refresh to update last_used
      } else if (result.error) {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSaved = async (conn: SavedConnection) => {
    if (!confirm(`Delete saved connection "${conn.name}"?`)) {
      return;
    }

    try {
      await api.deleteSavedConnection(conn.id);
      fetchSavedConnections();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete connection');
    }
  };

  const handleDisconnect = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await api.disconnect();
      setStatus(result);
      onConnectionChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Disconnect failed');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const isConnectorAvailable = CONNECTOR_OPTIONS.find(c => c.value === connectorType)?.available ?? false;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <h2 style={styles.title}>Database Connection</h2>
          <button style={styles.closeButton} onClick={onClose}>
            x
          </button>
        </div>

        {/* Connection Status */}
        <div
          style={{
            ...styles.statusBar,
            ...(status?.connected ? styles.statusConnected : styles.statusDisconnected),
          }}
        >
          <div
            style={{
              ...styles.statusDot,
              background: status?.connected ? '#51cf66' : '#ff6b6b',
            }}
          />
          <span>
            {status?.connected
              ? `Connected to ${status.connector_type} (${status.host}:${status.port})`
              : 'Not connected'}
          </span>
        </div>

        {/* Saved Connections */}
        {savedConnections.length > 0 && (
          <div style={styles.savedSection}>
            <div style={styles.sectionTitle}>Saved Connections</div>
            <div style={styles.savedList}>
              {savedConnections.map((conn, idx) => (
                <div
                  key={conn.id}
                  style={{
                    ...styles.savedItem,
                    ...(idx === savedConnections.length - 1 ? styles.savedItemLast : {}),
                  }}
                >
                  <div style={styles.savedItemInfo}>
                    <div style={styles.savedItemName}>{conn.name}</div>
                    <div style={styles.savedItemHost}>
                      {conn.host}:{conn.port}
                      {conn.has_api_key && ' (with API key)'}
                    </div>
                  </div>
                  <div style={styles.savedItemActions}>
                    <button
                      style={{ ...styles.smallButton, ...styles.smallButtonPrimary }}
                      onClick={() => handleConnectSaved(conn)}
                      disabled={isLoading}
                    >
                      Connect
                    </button>
                    <button
                      style={{ ...styles.smallButton, ...styles.smallButtonDanger }}
                      onClick={() => handleDeleteSaved(conn)}
                      disabled={isLoading}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div style={styles.divider}>
              <div style={styles.dividerLine} />
              <span>OR</span>
              <div style={styles.dividerLine} />
            </div>
          </div>
        )}

        {/* Section title for new connection */}
        <div style={styles.sectionTitle}>
          {savedConnections.length > 0 ? 'New Connection' : 'Connect to Database'}
        </div>

        {/* Connector Type */}
        <div style={styles.section}>
          <label style={styles.label}>Connector</label>
          <select
            style={styles.select}
            value={connectorType}
            onChange={(e) => setConnectorType(e.target.value as ConnectorType)}
            disabled={isLoading}
          >
            {CONNECTOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={!opt.available}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Weaviate Config */}
        {connectorType === 'weaviate' && (
          <>
            <div style={styles.row}>
              <div style={styles.field}>
                <label style={styles.label}>Host</label>
                <input
                  type="text"
                  style={styles.input}
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="localhost"
                  disabled={isLoading}
                />
              </div>
              <div style={{ width: 100 }}>
                <label style={styles.label}>Port</label>
                <input
                  type="text"
                  style={styles.input}
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="8080"
                  disabled={isLoading}
                />
              </div>
            </div>

            <div style={styles.row}>
              <div style={{ width: 100 }}>
                <label style={styles.label}>gRPC Port</label>
                <input
                  type="text"
                  style={styles.input}
                  value={grpcPort}
                  onChange={(e) => setGrpcPort(e.target.value)}
                  placeholder="50051"
                  disabled={isLoading}
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>API Key (optional)</label>
                <input
                  type="password"
                  style={styles.input}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter API key..."
                  disabled={isLoading}
                />
              </div>
            </div>
          </>
        )}

        {/* Coming soon placeholder for other connectors */}
        {!isConnectorAvailable && (
          <div style={{ ...styles.section, textAlign: 'center', color: '#666', padding: '20px 0' }}>
            Support for {connectorType} is coming soon.
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}

        {/* Save connection name (only show when not connected) */}
        {!status?.connected && isConnectorAvailable && (
          <div style={styles.section}>
            <label style={styles.label}>Connection Name (to save)</label>
            <input
              type="text"
              style={styles.input}
              value={connectionName}
              onChange={(e) => setConnectionName(e.target.value)}
              placeholder="e.g., Local Weaviate"
              disabled={isLoading}
            />
          </div>
        )}

        {/* Action Buttons */}
        <div style={styles.buttonRow}>
          {status?.connected ? (
            <>
              <button
                style={isLoading ? styles.buttonDisabled : styles.buttonDanger}
                onClick={handleDisconnect}
                disabled={isLoading}
              >
                {isLoading ? 'Disconnecting...' : 'Disconnect'}
              </button>
              <button
                style={isLoading || !isConnectorAvailable ? styles.buttonDisabled : styles.button}
                onClick={() => handleConnect(false)}
                disabled={isLoading || !isConnectorAvailable}
              >
                {isLoading ? 'Connecting...' : 'Reconnect'}
              </button>
            </>
          ) : (
            <>
              <button
                style={isLoading || !isConnectorAvailable ? styles.buttonDisabled : styles.buttonSecondary}
                onClick={() => handleConnect(false)}
                disabled={isLoading || !isConnectorAvailable}
              >
                {isLoading ? 'Connecting...' : 'Connect'}
              </button>
              <button
                style={isLoading || !isConnectorAvailable || !connectionName.trim() ? styles.buttonDisabled : styles.button}
                onClick={() => handleConnect(true)}
                disabled={isLoading || !isConnectorAvailable || !connectionName.trim()}
                title={!connectionName.trim() ? 'Enter a connection name to save' : ''}
              >
                {isLoading ? 'Connecting...' : 'Save & Connect'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
