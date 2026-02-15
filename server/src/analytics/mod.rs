//! Analytics module for VectorViz.
//!
//! Provides comprehensive vector database analysis including:
//! - Health metrics and statistics
//! - Orphan/stale vector detection
//! - Duplicate detection (exact and near-duplicates)
//! - Distribution analysis (clusters, outliers, density)
//! - Performance metrics
//! - Export functionality
//! - Embedding model fingerprinting
//! - Enhanced staleness analysis
//! - Contradiction detection
//! - Chunk quality analysis
//! - Anomaly/poisoning detection
//! - Distance distribution health

pub mod types;
pub mod health;
pub mod orphans;
pub mod duplicates;
pub mod distribution;
pub mod performance;
pub mod export;
pub mod fingerprint;
pub mod staleness;
pub mod contradictions;
pub mod chunk_quality;
pub mod anomaly;
pub mod distance_health;

pub use types::*;
pub use health::*;
pub use orphans::*;
pub use duplicates::*;
pub use distribution::*;
pub use performance::*;
pub use export::*;
pub use fingerprint::*;
pub use staleness::*;
pub use contradictions::*;
pub use chunk_quality::*;
pub use anomaly::*;
pub use distance_health::*;
