//! Duplicate detection (exact and near-duplicates).

use super::types::*;
use crate::db::{DatabaseBackend, VectorRecord};
use rayon::prelude::*;
use std::collections::{HashMap, HashSet};

/// Detect duplicates in a collection.
pub async fn detect_duplicates(
    backend: &dyn DatabaseBackend,
    collection: &str,
    query: &DuplicateQuery,
) -> Result<DuplicateDetectionResult, String> {
    // Fetch vectors for analysis
    let response = backend.get_vectors(collection, query.scan_limit, 0).await?;

    let mut groups: Vec<DuplicateGroup> = Vec::new();
    let mut breakdown = DuplicateBreakdown::default();

    // Track which vectors have been assigned to groups
    let mut assigned: HashSet<String> = HashSet::new();

    // 1. Detect exact duplicates (hash-based)
    if query.detect_exact {
        let exact_groups = detect_exact_duplicates(&response.vectors);
        for group in exact_groups {
            let count = group.vector_ids.len() as u64;
            if count > 1 {
                breakdown.exact += count - 1; // Don't count the "original"
                for id in &group.vector_ids {
                    assigned.insert(id.clone());
                }
                groups.push(group);
            }
        }
    }

    // 2. Detect near-duplicates (cosine similarity)
    if query.detect_near {
        let near_groups = detect_near_duplicates(
            &response.vectors,
            query.similarity_threshold,
            &assigned,
        );
        for group in near_groups {
            let count = group.vector_ids.len() as u64;
            if count > 1 {
                breakdown.near_duplicate += count - 1;
                for id in &group.vector_ids {
                    assigned.insert(id.clone());
                }
                groups.push(group);
            }
        }
    }

    // 3. Detect text-hash duplicates if text field is specified
    if let Some(text_field) = &query.text_field {
        let text_groups = detect_text_hash_duplicates(&response.vectors, text_field, &assigned);
        for group in text_groups {
            let count = group.vector_ids.len() as u64;
            if count > 1 {
                breakdown.text_hash += count - 1;
                groups.push(group);
            }
        }
    }

    let duplicate_count = breakdown.exact + breakdown.near_duplicate + breakdown.text_hash;

    Ok(DuplicateDetectionResult {
        collection: collection.to_string(),
        groups,
        total_scanned: response.vectors.len() as u64,
        duplicate_count,
        by_type: breakdown,
    })
}

/// Detect exact duplicates using vector hash.
fn detect_exact_duplicates(vectors: &[VectorRecord]) -> Vec<DuplicateGroup> {
    // Group vectors by their hash
    let mut hash_groups: HashMap<String, Vec<&VectorRecord>> = HashMap::new();

    for vector in vectors {
        if let Some(ref v) = vector.vector {
            let hash = compute_vector_hash(v);
            hash_groups.entry(hash).or_default().push(vector);
        }
    }

    // Convert groups with more than one vector to DuplicateGroup
    let mut groups = Vec::new();
    let mut group_id = 0;

    for (_, vecs) in hash_groups {
        if vecs.len() > 1 {
            let vector_ids: Vec<String> = vecs.iter().map(|v| v.id.clone()).collect();
            let sample_metadata = vecs[0].metadata.clone();

            groups.push(DuplicateGroup {
                group_id: format!("exact_{}", group_id),
                duplicate_type: DuplicateType::Exact,
                vector_ids,
                similarity: 1.0,
                sample_metadata,
            });
            group_id += 1;
        }
    }

    groups
}

/// Compute a hash string for a vector (for exact duplicate detection).
fn compute_vector_hash(vector: &[f32]) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    // Hash the bit representation of each float
    for v in vector {
        v.to_bits().hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

/// Detect near-duplicates using cosine similarity.
fn detect_near_duplicates(
    vectors: &[VectorRecord],
    threshold: f32,
    already_assigned: &HashSet<String>,
) -> Vec<DuplicateGroup> {
    // Filter to vectors with embeddings that aren't already assigned
    let eligible: Vec<&VectorRecord> = vectors
        .iter()
        .filter(|v| v.vector.is_some() && !already_assigned.contains(&v.id))
        .collect();

    if eligible.len() < 2 {
        return Vec::new();
    }

    // Build a list of vector data for parallel processing
    let vec_data: Vec<(&str, &[f32])> = eligible
        .iter()
        .map(|v| (v.id.as_str(), v.vector.as_ref().unwrap().as_slice()))
        .collect();

    // Compute pairwise similarities in parallel
    let n = vec_data.len();
    let pairs: Vec<(usize, usize, f32)> = (0..n)
        .into_par_iter()
        .flat_map(|i| {
            let mut local_pairs = Vec::new();
            for j in (i + 1)..n {
                let sim = cosine_similarity(vec_data[i].1, vec_data[j].1);
                if sim >= threshold {
                    local_pairs.push((i, j, sim));
                }
            }
            local_pairs
        })
        .collect();

    // Union-find to group similar vectors
    let mut uf = UnionFind::new(n);
    for (i, j, _) in &pairs {
        uf.union(*i, *j);
    }

    // Group vectors by their root
    let mut root_groups: HashMap<usize, Vec<usize>> = HashMap::new();
    for i in 0..n {
        let root = uf.find(i);
        root_groups.entry(root).or_default().push(i);
    }

    // Convert to DuplicateGroup
    let mut groups = Vec::new();
    let mut group_id = 0;

    for (_, indices) in root_groups {
        if indices.len() > 1 {
            let vector_ids: Vec<String> = indices
                .iter()
                .map(|&i| vec_data[i].0.to_string())
                .collect();

            // Compute average similarity within the group
            let mut total_sim = 0.0;
            let mut count = 0;
            for i in 0..indices.len() {
                for j in (i + 1)..indices.len() {
                    total_sim += cosine_similarity(
                        vec_data[indices[i]].1,
                        vec_data[indices[j]].1,
                    );
                    count += 1;
                }
            }
            let avg_similarity = if count > 0 {
                total_sim / count as f32
            } else {
                threshold
            };

            let sample_metadata = eligible[indices[0]].metadata.clone();

            groups.push(DuplicateGroup {
                group_id: format!("near_{}", group_id),
                duplicate_type: DuplicateType::NearDuplicate,
                vector_ids,
                similarity: avg_similarity,
                sample_metadata,
            });
            group_id += 1;
        }
    }

    groups
}

/// Compute cosine similarity between two vectors.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;

    for i in 0..a.len() {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }

    let denom = (norm_a * norm_b).sqrt();
    if denom > 0.0 {
        dot / denom
    } else {
        0.0
    }
}

/// Detect text-hash duplicates (same text content).
fn detect_text_hash_duplicates(
    vectors: &[VectorRecord],
    text_field: &str,
    already_assigned: &HashSet<String>,
) -> Vec<DuplicateGroup> {
    let mut text_groups: HashMap<String, Vec<&VectorRecord>> = HashMap::new();

    for vector in vectors {
        if already_assigned.contains(&vector.id) {
            continue;
        }

        if let Some(text_value) = vector.metadata.get(text_field) {
            if let Some(text) = text_value.as_str() {
                // Normalize text and compute hash
                let normalized = text.trim().to_lowercase();
                if !normalized.is_empty() {
                    let hash = compute_text_hash(&normalized);
                    text_groups.entry(hash).or_default().push(vector);
                }
            }
        }
    }

    // Convert to DuplicateGroup
    let mut groups = Vec::new();
    let mut group_id = 0;

    for (_, vecs) in text_groups {
        if vecs.len() > 1 {
            let vector_ids: Vec<String> = vecs.iter().map(|v| v.id.clone()).collect();
            let sample_metadata = vecs[0].metadata.clone();

            groups.push(DuplicateGroup {
                group_id: format!("text_{}", group_id),
                duplicate_type: DuplicateType::TextHash,
                vector_ids,
                similarity: 1.0, // Text is identical
                sample_metadata,
            });
            group_id += 1;
        }
    }

    groups
}

/// Compute a hash for text content.
fn compute_text_hash(text: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

/// Simple Union-Find data structure for grouping.
struct UnionFind {
    parent: Vec<usize>,
    rank: Vec<usize>,
}

impl UnionFind {
    fn new(n: usize) -> Self {
        Self {
            parent: (0..n).collect(),
            rank: vec![0; n],
        }
    }

    fn find(&mut self, x: usize) -> usize {
        if self.parent[x] != x {
            self.parent[x] = self.find(self.parent[x]);
        }
        self.parent[x]
    }

    fn union(&mut self, x: usize, y: usize) {
        let rx = self.find(x);
        let ry = self.find(y);
        if rx != ry {
            if self.rank[rx] < self.rank[ry] {
                self.parent[rx] = ry;
            } else if self.rank[rx] > self.rank[ry] {
                self.parent[ry] = rx;
            } else {
                self.parent[ry] = rx;
                self.rank[rx] += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_cosine_similarity_identical() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!((sim - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 0.001);
    }

    #[test]
    fn test_vector_hash() {
        let v1 = vec![1.0, 2.0, 3.0];
        let v2 = vec![1.0, 2.0, 3.0];
        let v3 = vec![1.0, 2.0, 3.1];

        assert_eq!(compute_vector_hash(&v1), compute_vector_hash(&v2));
        assert_ne!(compute_vector_hash(&v1), compute_vector_hash(&v3));
    }

    #[test]
    fn test_detect_exact_duplicates() {
        let vectors = vec![
            VectorRecord {
                id: "1".to_string(),
                vector: Some(vec![1.0, 2.0, 3.0]),
                metadata: json!({}),
                projection: None,
                distance: None,
            },
            VectorRecord {
                id: "2".to_string(),
                vector: Some(vec![1.0, 2.0, 3.0]),
                metadata: json!({}),
                projection: None,
                distance: None,
            },
            VectorRecord {
                id: "3".to_string(),
                vector: Some(vec![4.0, 5.0, 6.0]),
                metadata: json!({}),
                projection: None,
                distance: None,
            },
        ];

        let groups = detect_exact_duplicates(&vectors);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].vector_ids.len(), 2);
        assert!(groups[0].vector_ids.contains(&"1".to_string()));
        assert!(groups[0].vector_ids.contains(&"2".to_string()));
    }
}
