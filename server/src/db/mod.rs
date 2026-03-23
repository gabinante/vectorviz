pub mod weaviate;

use serde::{Deserialize, Serialize};
use std::fs;
use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Deserialize)]
pub struct ConnectRequest {
    #[serde(rename = "type")]
    pub db_type: String,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConnectionStatus {
    pub connected: bool,
    pub connector_type: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectionInfo {
    pub name: String,
    pub count: u64,
    pub vector_dimensions: Option<usize>,
    pub properties: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VectorRecord {
    pub id: String,
    pub vector: Option<Vec<f32>>,
    pub metadata: serde_json::Value,
    pub projection: Option<[f32; 3]>,
    pub distance: Option<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VectorsResponse {
    pub vectors: Vec<VectorRecord>,
    pub total: usize,
    /// Cursor for fetching the next page (Weaviate uses the last object's ID)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SearchRequest {
    pub query: String,
    pub limit: Option<usize>,
}

/// Trait for database backends (dyn-compatible using Pin<Box<Future>>).
pub trait DatabaseBackend: Send + Sync {
    fn list_collections(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<CollectionInfo>, String>> + Send + '_>>;

    fn get_collection_info(
        &self,
        name: &str,
    ) -> Pin<Box<dyn Future<Output = Result<CollectionInfo, String>> + Send + '_>>;

    /// Get vectors with offset-based pagination (limited to ~10k vectors).
    fn get_vectors(
        &self,
        collection: &str,
        limit: usize,
        offset: usize,
    ) -> Pin<Box<dyn Future<Output = Result<VectorsResponse, String>> + Send + '_>>;

    /// Get vectors with cursor-based pagination (supports unlimited vectors).
    /// Pass None for cursor to start from the beginning.
    fn get_vectors_cursor(
        &self,
        collection: &str,
        limit: usize,
        cursor: Option<&str>,
    ) -> Pin<Box<dyn Future<Output = Result<VectorsResponse, String>> + Send + '_>>;

    fn search(
        &self,
        collection: &str,
        query: &str,
        limit: usize,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<VectorRecord>, String>> + Send + '_>>;

    fn get_neighbors(
        &self,
        collection: &str,
        vector_id: &str,
        k: usize,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<VectorRecord>, String>> + Send + '_>>;
}

/// Manages the active database connection.
pub struct ConnectionManager {
    pub backend: Option<Box<dyn DatabaseBackend>>,
    pub status: ConnectionStatus,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            backend: None,
            status: ConnectionStatus {
                connected: false,
                connector_type: None,
                host: None,
                port: None,
                error: None,
            },
        }
    }

    pub async fn connect(&mut self, req: &ConnectRequest) -> ConnectionStatus {
        match req.db_type.as_str() {
            "weaviate" => {
                let host = req.host.clone().unwrap_or_else(|| "localhost".to_string());
                let port = req.port.unwrap_or(8080);

                // If the host is already a full URL, use it directly.
                // Auto-detect Weaviate Cloud hostnames and use HTTPS.
                let url = if host.starts_with("http://") || host.starts_with("https://") {
                    host.trim_end_matches('/').to_string()
                } else if host.contains(".weaviate.cloud") || host.contains(".weaviate.network") {
                    format!("https://{}", host.trim_end_matches('/'))
                } else {
                    format!("http://{}:{}", host, port)
                };

                match weaviate::WeaviateClient::connect(&url, req.api_key.as_deref()).await {
                    Ok(client) => {
                        self.backend = Some(Box::new(client));
                        self.status = ConnectionStatus {
                            connected: true,
                            connector_type: Some("weaviate".to_string()),
                            host: Some(host),
                            port: Some(port),
                            error: None,
                        };
                    }
                    Err(e) => {
                        self.backend = None;
                        self.status = ConnectionStatus {
                            connected: false,
                            connector_type: None,
                            host: None,
                            port: None,
                            error: Some(e),
                        };
                    }
                }
            }
            other => {
                self.status = ConnectionStatus {
                    connected: false,
                    connector_type: None,
                    host: None,
                    port: None,
                    error: Some(format!("Unsupported database type: {}", other)),
                };
            }
        }

        self.status.clone()
    }

    pub fn disconnect(&mut self) -> ConnectionStatus {
        self.backend = None;
        self.status = ConnectionStatus {
            connected: false,
            connector_type: None,
            host: None,
            port: None,
            error: None,
        };
        self.status.clone()
    }
}

pub type SharedConnectionManager = Arc<RwLock<ConnectionManager>>;

// ============================================================================
// Saved Connections (persistent storage)
// ============================================================================

const KEYCHAIN_SERVICE: &str = "com.vectorviz.connections";

/// A saved database connection (metadata stored in JSON, API key in system keychain)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    pub name: String,
    pub db_type: String,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub has_api_key: bool,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used: Option<i64>,
}

/// Request to save a new connection
#[derive(Debug, Clone, Deserialize)]
pub struct SaveConnectionRequest {
    pub name: String,
    pub db_type: String,
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
}

/// List of all saved connections
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SavedConnections {
    pub connections: Vec<SavedConnection>,
}

impl SavedConnections {
    /// Get the path to the config file: ~/.vectorviz/connections.json
    fn config_path() -> PathBuf {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".vectorviz")
            .join("connections.json")
    }

    /// Load saved connections from disk
    pub fn load() -> Self {
        let path = Self::config_path();
        if !path.exists() {
            return Self::default();
        }

        match fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
            Err(_) => Self::default(),
        }
    }

    /// Save connections to disk
    pub fn save(&self) -> Result<(), String> {
        let path = Self::config_path();

        // Create parent directory if needed
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Failed to create config dir: {}", e))?;
        }

        let content =
            serde_json::to_string_pretty(self).map_err(|e| format!("Failed to serialize: {}", e))?;

        fs::write(&path, content).map_err(|e| format!("Failed to write config: {}", e))
    }

    /// Add a new connection
    pub fn add(&mut self, conn: SavedConnection) {
        // Remove any existing connection with the same ID
        self.connections.retain(|c| c.id != conn.id);
        self.connections.push(conn);
    }

    /// Remove a connection by ID
    pub fn remove(&mut self, id: &str) -> bool {
        let len_before = self.connections.len();
        self.connections.retain(|c| c.id != id);
        self.connections.len() < len_before
    }

    /// Find a connection by ID
    pub fn find(&self, id: &str) -> Option<&SavedConnection> {
        self.connections.iter().find(|c| c.id == id)
    }

    /// Update last_used timestamp for a connection
    pub fn touch(&mut self, id: &str) {
        if let Some(conn) = self.connections.iter_mut().find(|c| c.id == id) {
            conn.last_used = Some(chrono::Utc::now().timestamp());
        }
    }

    /// Store API key in system keychain
    pub fn store_api_key(connection_id: &str, api_key: &str) -> Result<(), String> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, connection_id)
            .map_err(|e| format!("Keyring error: {}", e))?;
        entry
            .set_password(api_key)
            .map_err(|e| format!("Failed to store API key: {}", e))
    }

    /// Retrieve API key from system keychain
    pub fn get_api_key(connection_id: &str) -> Option<String> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, connection_id).ok()?;
        entry.get_password().ok()
    }

    /// Delete API key from system keychain
    pub fn delete_api_key(connection_id: &str) {
        if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, connection_id) {
            let _ = entry.delete_credential();
        }
    }
}
