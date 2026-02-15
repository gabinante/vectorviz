//! Weaviate REST API client using reqwest.

use super::{CollectionInfo, DatabaseBackend, VectorRecord, VectorsResponse};
use reqwest::Client;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::RwLock;
use std::time::Duration;

pub struct WeaviateClient {
    client: Client,
    base_url: String,
    /// Cache for collection properties (schema) to avoid repeated fetches
    properties_cache: RwLock<HashMap<String, Vec<String>>>,
}

impl WeaviateClient {
    /// Connect to a Weaviate instance and verify connectivity.
    pub async fn connect(url: &str, api_key: Option<&str>) -> Result<Self, String> {
        let mut headers = reqwest::header::HeaderMap::new();
        if let Some(key) = api_key {
            headers.insert(
                "Authorization",
                format!("Bearer {}", key)
                    .parse()
                    .map_err(|e| format!("Invalid API key: {}", e))?,
            );
        }

        let client = Client::builder()
            .default_headers(headers)
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        let base_url = url.trim_end_matches('/').to_string();

        // Test connectivity
        let resp = client
            .get(format!("{}/v1/.well-known/ready", base_url))
            .send()
            .await
            .map_err(|e| format!("Failed to connect to Weaviate at {}: {}", base_url, e))?;

        if !resp.status().is_success() {
            return Err(format!(
                "Weaviate not ready (status {})",
                resp.status()
            ));
        }

        Ok(Self {
            client,
            base_url,
            properties_cache: RwLock::new(HashMap::new()),
        })
    }

    /// Make a GraphQL query to Weaviate.
    async fn graphql(&self, query: &str) -> Result<Value, String> {
        let body = serde_json::json!({ "query": query });
        let resp = self
            .client
            .post(format!("{}/v1/graphql", self.base_url))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("GraphQL request failed: {}", e))?;

        let json: Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse GraphQL response: {}", e))?;

        if let Some(errors) = json.get("errors") {
            return Err(format!("GraphQL errors: {}", errors));
        }

        Ok(json)
    }

    /// Get the list of property names for a collection from the schema.
    /// Results are cached to avoid repeated schema fetches during bulk operations.
    async fn get_collection_properties(&self, collection: &str) -> Result<Vec<String>, String> {
        // Check cache first
        if let Ok(cache) = self.properties_cache.read() {
            if let Some(props) = cache.get(collection) {
                return Ok(props.clone());
            }
        }

        // Fetch from Weaviate
        let resp = self
            .client
            .get(format!("{}/v1/schema/{}", self.base_url, collection))
            .send()
            .await
            .map_err(|e| format!("Failed to get schema for {}: {}", collection, e))?;

        let schema: Value = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse schema: {}", e))?;

        let properties: Vec<String> = schema
            .get("properties")
            .and_then(|p| p.as_array())
            .map(|props| {
                props
                    .iter()
                    .filter_map(|p| p.get("name").and_then(|n| n.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        // Cache the result
        if let Ok(mut cache) = self.properties_cache.write() {
            cache.insert(collection.to_string(), properties.clone());
        }

        Ok(properties)
    }
}

impl DatabaseBackend for WeaviateClient {
    fn list_collections(
        &self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<CollectionInfo>, String>> + Send + '_>>
    {
        Box::pin(async move {
            let resp = self
                .client
                .get(format!("{}/v1/schema", self.base_url))
                .send()
                .await
                .map_err(|e| format!("Failed to get schema: {}", e))?;

            let schema: Value = resp
                .json()
                .await
                .map_err(|e| format!("Failed to parse schema: {}", e))?;

            let classes = schema
                .get("classes")
                .and_then(|c| c.as_array())
                .cloned()
                .unwrap_or_default();

            let mut collections = Vec::new();
            for class in &classes {
                let name = class
                    .get("class")
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();

                let properties: Vec<String> = class
                    .get("properties")
                    .and_then(|p| p.as_array())
                    .map(|props| {
                        props
                            .iter()
                            .filter_map(|p| p.get("name").and_then(|n| n.as_str()).map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();

                // Get count via aggregate query
                let count_query = format!(
                    r#"{{ Aggregate {{ {} {{ meta {{ count }} }} }} }}"#,
                    name
                );
                let count = match self.graphql(&count_query).await {
                    Ok(resp) => resp
                        .pointer(&format!("/data/Aggregate/{}/0/meta/count", name))
                        .and_then(|c| c.as_u64())
                        .unwrap_or(0),
                    Err(_) => 0,
                };

                // Detect vector dimensions from vectorizer config
                let vector_dimensions = class
                    .get("vectorIndexConfig")
                    .and_then(|v| v.get("dimensions"))
                    .and_then(|d| d.as_u64())
                    .map(|d| d as usize);

                collections.push(CollectionInfo {
                    name,
                    count,
                    vector_dimensions,
                    properties,
                });
            }

            Ok(collections)
        })
    }

    fn get_collection_info(
        &self,
        name: &str,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<CollectionInfo, String>> + Send + '_>>
    {
        let name = name.to_string();
        Box::pin(async move {
            let collections = self.list_collections().await?;
            collections
                .into_iter()
                .find(|c| c.name == name)
                .ok_or_else(|| format!("Collection '{}' not found", name))
        })
    }

    fn get_vectors(
        &self,
        collection: &str,
        limit: usize,
        offset: usize,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<VectorsResponse, String>> + Send + '_>>
    {
        let collection = collection.to_string();
        Box::pin(async move {
            // First, get the collection schema to know what properties to request
            let properties = self.get_collection_properties(&collection).await?;
            let properties_str = properties.join("\n                            ");

            // Use GraphQL to fetch objects with vectors and all properties
            let query = format!(
                r#"{{
                    Get {{
                        {} (
                            limit: {}
                            offset: {}
                        ) {{
                            {}
                            _additional {{
                                id
                                vector
                            }}
                        }}
                    }}
                }}"#,
                collection, limit, offset, properties_str
            );

            let resp = self.graphql(&query).await?;

            let objects = resp
                .pointer(&format!("/data/Get/{}", collection))
                .and_then(|o| o.as_array())
                .cloned()
                .unwrap_or_default();

            let mut vectors = Vec::new();
            for obj in &objects {
                let additional = obj.get("_additional").unwrap_or(&Value::Null);
                let id = additional
                    .get("id")
                    .and_then(|i| i.as_str())
                    .unwrap_or("")
                    .to_string();

                let vector: Option<Vec<f32>> = additional
                    .get("vector")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_f64().map(|f| f as f32))
                            .collect()
                    });

                // Build metadata from all non-_additional fields
                let mut metadata = serde_json::Map::new();
                if let Some(obj_map) = obj.as_object() {
                    for (key, value) in obj_map {
                        if key != "_additional" {
                            metadata.insert(key.clone(), value.clone());
                        }
                    }
                }

                vectors.push(VectorRecord {
                    id,
                    vector,
                    metadata: Value::Object(metadata),
                    projection: None,
                    distance: None,
                });
            }

            // Also get total count
            let count_query = format!(
                r#"{{ Aggregate {{ {} {{ meta {{ count }} }} }} }}"#,
                collection
            );
            let total = match self.graphql(&count_query).await {
                Ok(resp) => resp
                    .pointer(&format!("/data/Aggregate/{}/0/meta/count", collection))
                    .and_then(|c| c.as_u64())
                    .unwrap_or(vectors.len() as u64) as usize,
                Err(_) => vectors.len(),
            };

            // For offset-based pagination, we don't have a cursor
            Ok(VectorsResponse { vectors, total, next_cursor: None })
        })
    }

    fn get_vectors_cursor(
        &self,
        collection: &str,
        limit: usize,
        cursor: Option<&str>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<VectorsResponse, String>> + Send + '_>>
    {
        let collection = collection.to_string();
        let cursor = cursor.map(|s| s.to_string());
        Box::pin(async move {
            // Get the collection schema to know what properties to request
            let properties = self.get_collection_properties(&collection).await?;
            let properties_str = properties.join("\n                            ");

            // Build the query with cursor-based pagination using 'after'
            let after_clause = match &cursor {
                Some(c) => format!(r#"after: "{}""#, c),
                None => String::new(),
            };

            let query = format!(
                r#"{{
                    Get {{
                        {} (
                            limit: {}
                            {}
                        ) {{
                            {}
                            _additional {{
                                id
                                vector
                            }}
                        }}
                    }}
                }}"#,
                collection, limit, after_clause, properties_str
            );

            let resp = self.graphql(&query).await?;

            let objects = resp
                .pointer(&format!("/data/Get/{}", collection))
                .and_then(|o| o.as_array())
                .cloned()
                .unwrap_or_default();

            let mut vectors = Vec::new();
            let mut last_id: Option<String> = None;

            for obj in &objects {
                let additional = obj.get("_additional").unwrap_or(&serde_json::Value::Null);
                let id = additional
                    .get("id")
                    .and_then(|i| i.as_str())
                    .unwrap_or("")
                    .to_string();

                last_id = Some(id.clone());

                let vector: Option<Vec<f32>> = additional
                    .get("vector")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_f64().map(|f| f as f32))
                            .collect()
                    });

                // Build metadata from all non-_additional fields
                let mut metadata = serde_json::Map::new();
                if let Some(obj_map) = obj.as_object() {
                    for (key, value) in obj_map {
                        if key != "_additional" {
                            metadata.insert(key.clone(), value.clone());
                        }
                    }
                }

                vectors.push(VectorRecord {
                    id,
                    vector,
                    metadata: serde_json::Value::Object(metadata),
                    projection: None,
                    distance: None,
                });
            }

            // Skip count query - caller already has total from collection info
            // This saves one HTTP request per chunk during bulk fetches

            // Return the last ID as the cursor for the next page
            // Only set cursor if we got a full page (more results likely)
            let next_cursor = if vectors.len() == limit {
                last_id
            } else {
                None
            };

            // Return 0 for total - caller should use collection info for accurate count
            Ok(VectorsResponse { vectors, total: 0, next_cursor })
        })
    }

    fn search(
        &self,
        collection: &str,
        query: &str,
        limit: usize,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<VectorRecord>, String>> + Send + '_>>
    {
        let collection = collection.to_string();
        let query_text = query.to_string();
        Box::pin(async move {
            // First, get the collection schema to know what properties to request
            let properties = self.get_collection_properties(&collection).await?;
            let properties_str = properties.join("\n                            ");

            let gql = format!(
                r#"{{
                    Get {{
                        {} (
                            limit: {}
                            nearText: {{
                                concepts: ["{}"]
                            }}
                        ) {{
                            {}
                            _additional {{
                                id
                                vector
                                distance
                            }}
                        }}
                    }}
                }}"#,
                collection,
                limit,
                query_text.replace('"', "\\\""),
                properties_str
            );

            let resp = self.graphql(&gql).await?;

            let objects = resp
                .pointer(&format!("/data/Get/{}", collection))
                .and_then(|o| o.as_array())
                .cloned()
                .unwrap_or_default();

            let mut results = Vec::new();
            for obj in &objects {
                let additional = obj.get("_additional").unwrap_or(&Value::Null);
                let id = additional
                    .get("id")
                    .and_then(|i| i.as_str())
                    .unwrap_or("")
                    .to_string();

                let vector: Option<Vec<f32>> = additional
                    .get("vector")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_f64().map(|f| f as f32))
                            .collect()
                    });

                let distance = additional
                    .get("distance")
                    .and_then(|d| d.as_f64())
                    .map(|d| d as f32);

                let mut metadata = serde_json::Map::new();
                if let Some(obj_map) = obj.as_object() {
                    for (key, value) in obj_map {
                        if key != "_additional" {
                            metadata.insert(key.clone(), value.clone());
                        }
                    }
                }

                results.push(VectorRecord {
                    id,
                    vector,
                    metadata: Value::Object(metadata),
                    projection: None,
                    distance,
                });
            }

            Ok(results)
        })
    }

    fn get_neighbors(
        &self,
        collection: &str,
        vector_id: &str,
        k: usize,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<VectorRecord>, String>> + Send + '_>>
    {
        let collection = collection.to_string();
        let vector_id = vector_id.to_string();
        Box::pin(async move {
            let vector_id = vector_id.replace('"', "\\\"");
            // First get the vector for the given ID
            let gql = format!(
                r#"{{
                    Get {{
                        {} (
                            where: {{
                                path: ["id"]
                                operator: Equal
                                valueText: "{}"
                            }}
                        ) {{
                            _additional {{
                                id
                                vector
                            }}
                        }}
                    }}
                }}"#,
                collection, vector_id
            );

            let resp = self.graphql(&gql).await?;

            let objects = resp
                .pointer(&format!("/data/Get/{}", collection))
                .and_then(|o| o.as_array())
                .cloned()
                .unwrap_or_default();

            if objects.is_empty() {
                return Err(format!("Vector '{}' not found", vector_id));
            }

            // Get the vector value
            let source_vector = objects[0]
                .pointer("/_additional/vector")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_f64().map(|f| f as f32))
                        .collect::<Vec<f32>>()
                });

            let source_vector = match source_vector {
                Some(v) if !v.is_empty() => v,
                _ => return Err("Source vector has no embedding".to_string()),
            };

            // Find neighbors using nearVector
            let vector_str: Vec<String> = source_vector.iter().map(|v| v.to_string()).collect();
            let gql = format!(
                r#"{{
                    Get {{
                        {} (
                            limit: {}
                            nearVector: {{
                                vector: [{}]
                            }}
                        ) {{
                            _additional {{
                                id
                                vector
                                distance
                            }}
                        }}
                    }}
                }}"#,
                collection,
                k + 1, // +1 to exclude the source vector itself
                vector_str.join(", ")
            );

            let resp = self.graphql(&gql).await?;

            let neighbor_objects = resp
                .pointer(&format!("/data/Get/{}", collection))
                .and_then(|o| o.as_array())
                .cloned()
                .unwrap_or_default();

            let mut neighbors = Vec::new();
            for obj in &neighbor_objects {
                let additional = obj.get("_additional").unwrap_or(&Value::Null);
                let id = additional
                    .get("id")
                    .and_then(|i| i.as_str())
                    .unwrap_or("")
                    .to_string();

                // Skip the source vector itself
                if id == vector_id {
                    continue;
                }

                let vector: Option<Vec<f32>> = additional
                    .get("vector")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_f64().map(|f| f as f32))
                            .collect()
                    });

                let distance = additional
                    .get("distance")
                    .and_then(|d| d.as_f64())
                    .map(|d| d as f32);

                let mut metadata = serde_json::Map::new();
                if let Some(obj_map) = obj.as_object() {
                    for (key, value) in obj_map {
                        if key != "_additional" {
                            metadata.insert(key.clone(), value.clone());
                        }
                    }
                }

                neighbors.push(VectorRecord {
                    id,
                    vector,
                    metadata: Value::Object(metadata),
                    projection: None,
                    distance,
                });

                if neighbors.len() >= k {
                    break;
                }
            }

            Ok(neighbors)
        })
    }
}
