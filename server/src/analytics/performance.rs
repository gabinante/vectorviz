//! Performance metrics computation.

use super::types::*;
use crate::db::CollectionInfo;

/// Compute performance metrics for all collections.
pub fn compute_performance_metrics(collections: &[CollectionInfo]) -> PerformanceMetrics {
    let mut collection_metrics = Vec::new();
    let mut recommendations = Vec::new();

    let mut total_memory: u64 = 0;
    let mut total_vectors: u64 = 0;
    let mut high_dim_collections = Vec::new();
    let mut large_collections = Vec::new();

    for coll in collections {
        let dims = coll.vector_dimensions.unwrap_or(0);

        // Memory estimation:
        // - Vector data: 4 bytes * dimensions * count
        // - Index overhead: ~50% of vector data for HNSW
        // - Metadata: estimate 200 bytes per vector
        let vector_bytes = coll.count * dims as u64 * 4;
        let index_overhead = vector_bytes / 2;
        let metadata_overhead = coll.count * 200;
        let estimated_memory = vector_bytes + index_overhead + metadata_overhead;

        // Storage is similar but includes additional overhead
        let estimated_storage = estimated_memory + (estimated_memory / 10); // 10% additional

        let bytes_per_vector = if coll.count > 0 {
            estimated_memory / coll.count
        } else {
            0
        };

        collection_metrics.push(CollectionPerformance {
            name: coll.name.clone(),
            vector_count: coll.count,
            dimensions: coll.vector_dimensions,
            estimated_memory_bytes: estimated_memory,
            estimated_storage_bytes: estimated_storage,
            bytes_per_vector,
        });

        total_memory += estimated_memory;
        total_vectors += coll.count;

        // Track high dimension collections
        if dims > 768 {
            high_dim_collections.push((coll.name.clone(), dims));
        }

        // Track large collections
        if coll.count > 100_000 {
            large_collections.push((coll.name.clone(), coll.count));
        }
    }

    // Generate recommendations

    // High dimension recommendations
    for (name, dims) in &high_dim_collections {
        let reduction_factor = if *dims > 1536 { 4 } else { 2 };
        let savings = format!(
            "Reducing dimensions by {}x could save ~{} memory",
            reduction_factor,
            format_bytes(total_memory / reduction_factor as u64)
        );

        recommendations.push(PerformanceRecommendation {
            category: "dimensionality".to_string(),
            priority: if *dims > 1536 {
                RecommendationPriority::High
            } else {
                RecommendationPriority::Medium
            },
            message: format!(
                "Collection '{}' uses {}-dimensional vectors. Consider dimensionality reduction if query performance is slow.",
                name, dims
            ),
            potential_savings: Some(savings),
        });
    }

    // Large collection recommendations
    for (name, count) in &large_collections {
        recommendations.push(PerformanceRecommendation {
            category: "scaling".to_string(),
            priority: if *count > 1_000_000 {
                RecommendationPriority::High
            } else {
                RecommendationPriority::Medium
            },
            message: format!(
                "Collection '{}' has {} vectors. Consider sharding or horizontal scaling for better performance.",
                name, format_number(*count)
            ),
            potential_savings: None,
        });
    }

    // Memory pressure recommendations
    if total_memory > 8 * 1024 * 1024 * 1024 {
        // > 8GB
        recommendations.push(PerformanceRecommendation {
            category: "memory".to_string(),
            priority: RecommendationPriority::High,
            message: format!(
                "Total estimated memory usage is {}. Ensure your system has adequate RAM to avoid disk spillover.",
                format_bytes(total_memory)
            ),
            potential_savings: None,
        });
    }

    // Index optimization recommendations
    if total_vectors > 10_000 {
        recommendations.push(PerformanceRecommendation {
            category: "indexing".to_string(),
            priority: RecommendationPriority::Low,
            message: "Consider tuning HNSW index parameters (ef, efConstruction, maxConnections) for optimal query/build time tradeoff.".to_string(),
            potential_savings: None,
        });
    }

    PerformanceMetrics {
        collections: collection_metrics,
        recommendations,
    }
}

/// Format bytes as human-readable string.
fn format_bytes(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;

    if bytes >= GB {
        format!("{:.1} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.1} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.1} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} bytes", bytes)
    }
}

/// Format large numbers with commas.
fn format_number(n: u64) -> String {
    let s = n.to_string();
    let mut result = String::new();
    let chars: Vec<char> = s.chars().collect();

    for (i, c) in chars.iter().enumerate() {
        if i > 0 && (chars.len() - i) % 3 == 0 {
            result.push(',');
        }
        result.push(*c);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_bytes() {
        assert_eq!(format_bytes(500), "500 bytes");
        assert_eq!(format_bytes(1024), "1.0 KB");
        assert_eq!(format_bytes(1536), "1.5 KB");
        assert_eq!(format_bytes(1024 * 1024), "1.0 MB");
        assert_eq!(format_bytes(1024 * 1024 * 1024), "1.0 GB");
    }

    #[test]
    fn test_format_number() {
        assert_eq!(format_number(100), "100");
        assert_eq!(format_number(1000), "1,000");
        assert_eq!(format_number(1000000), "1,000,000");
    }

    #[test]
    fn test_compute_metrics() {
        let collections = vec![
            CollectionInfo {
                name: "test".to_string(),
                count: 1000,
                vector_dimensions: Some(768),
                properties: vec!["text".to_string()],
            },
        ];

        let metrics = compute_performance_metrics(&collections);
        assert_eq!(metrics.collections.len(), 1);
        assert_eq!(metrics.collections[0].vector_count, 1000);
        assert!(metrics.collections[0].estimated_memory_bytes > 0);
    }
}
