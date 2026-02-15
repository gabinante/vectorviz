//! UMAP (Uniform Manifold Approximation and Projection) implementation.
//!
//! Uses HNSW (Hierarchical Navigable Small World) for fast k-NN graph
//! construction: O(n log n) instead of O(n²) for brute-force.
//!
//! Performance improvement: ~10-100x faster for datasets > 1000 vectors.

use hnsw_rs::prelude::*;
use nalgebra::DMatrix;
use rand::prelude::*;
use rand::rngs::SmallRng;
use rayon::prelude::*;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use tracing::info;

use super::ProgressCallback;

/// Compute the UMAP curve parameters (a, b) from min_dist and spread.
fn find_ab_params(min_dist: f32, spread: f32) -> (f32, f32) {
    let n_points = 300;
    let x_max = 3.0 * spread;

    let xs: Vec<f32> = (0..n_points)
        .map(|i| (i as f32 + 0.5) * x_max / n_points as f32)
        .collect();
    let targets: Vec<f32> = xs
        .iter()
        .map(|&x| {
            if x <= min_dist {
                1.0
            } else {
                (-(x - min_dist) / spread).exp()
            }
        })
        .collect();

    let mut best_a = 1.577f32;
    let mut best_b = 0.895f32;
    let mut best_err = f32::INFINITY;

    // Coarse grid search
    for a_i in 1..=40 {
        let a = a_i as f32 * 0.2;
        for b_i in 1..=30 {
            let b = b_i as f32 * 0.1;
            let err: f32 = xs
                .iter()
                .zip(targets.iter())
                .map(|(&x, &t)| {
                    let y = 1.0 / (1.0 + a * x.powf(2.0 * b));
                    (y - t).powi(2)
                })
                .sum();
            if err < best_err {
                best_err = err;
                best_a = a;
                best_b = b;
            }
        }
    }

    // Fine refinement
    let a_lo = (best_a - 0.3).max(0.01);
    let a_hi = best_a + 0.3;
    let b_lo = (best_b - 0.15).max(0.01);
    let b_hi = best_b + 0.15;

    for a_i in 0..=30 {
        let a = a_lo + (a_hi - a_lo) * a_i as f32 / 30.0;
        for b_i in 0..=30 {
            let b = b_lo + (b_hi - b_lo) * b_i as f32 / 30.0;
            let err: f32 = xs
                .iter()
                .zip(targets.iter())
                .map(|(&x, &t)| {
                    let y = 1.0 / (1.0 + a * x.powf(2.0 * b));
                    (y - t).powi(2)
                })
                .sum();
            if err < best_err {
                best_err = err;
                best_a = a;
                best_b = b;
            }
        }
    }

    (best_a, best_b)
}

#[cfg(test)]
pub fn fit(
    data: &[f32],
    n_samples: usize,
    n_dims: usize,
    n_neighbors: usize,
    min_dist: f32,
    n_epochs: usize,
    hnsw_ef_construction: usize,
) -> Vec<f32> {
    fit_with_progress(data, n_samples, n_dims, n_neighbors, min_dist, n_epochs, hnsw_ef_construction, None, None)
}

/// Compute UMAP projection with progress reporting.
///
/// # Arguments
/// * `hnsw_ef_construction` - HNSW ef parameter (100-400). Higher = better quality, slower.
/// * `progress` - Optional callback for progress updates (0.0 to 1.0)
pub fn fit_with_progress(
    data: &[f32],
    n_samples: usize,
    n_dims: usize,
    n_neighbors: usize,
    min_dist: f32,
    n_epochs: usize,
    hnsw_ef_construction: usize,
    progress: Option<ProgressCallback>,
    cancelled: Option<Arc<AtomicBool>>,
) -> Vec<f32> {
    assert_eq!(data.len(), n_samples * n_dims);
    assert!(n_samples > n_neighbors);

    let n_components = 3;
    let n_neighbors = n_neighbors.min(n_samples - 1);

    info!(
        "UMAP: {} samples × {} dims, k={}, epochs={}, hnsw_ef={}",
        n_samples, n_dims, n_neighbors, n_epochs, hnsw_ef_construction
    );

    let umap_start = std::time::Instant::now();

    // k-NN graph construction is ~15% of total work
    if let Some(ref cb) = progress {
        cb(0.0);
    }

    // Build k-NN graph using HNSW (O(n log n) instead of O(n²))
    let knn_start = std::time::Instant::now();
    let (knn_indices, knn_distances) =
        find_k_nearest_neighbors_hnsw(data, n_samples, n_dims, n_neighbors, hnsw_ef_construction);

    info!("k-NN graph built in {:.2}s", knn_start.elapsed().as_secs_f64());
    if let Some(ref cb) = progress {
        cb(0.15);
    }

    // Compute fuzzy simplicial set (~5% of work)
    let graph = compute_membership_strengths(&knn_indices, &knn_distances, n_samples, n_neighbors);

    if let Some(ref cb) = progress {
        cb(0.20);
    }

    // Compute curve parameters
    let spread = 1.0f32;
    let (a, b) = find_ab_params(min_dist, spread);

    // Initialize embedding
    let mut embedding = initialize_embedding(n_samples, n_components, &graph);

    if let Some(ref cb) = progress {
        cb(0.25);
    }

    info!("Starting SGD optimization ({} epochs)", n_epochs);

    // SGD optimization is the bulk of the work (from 25% to 100%)
    let sgd_progress = progress.clone().map(|cb| -> ProgressCallback {
        Arc::new(move |p| cb(0.25 + p * 0.75))
    });

    // Optimize embedding
    let sgd_start = std::time::Instant::now();
    optimize_layout(
        &mut embedding,
        &graph,
        n_samples,
        n_components,
        n_epochs,
        a,
        b,
        sgd_progress,
        cancelled,
    );

    info!("UMAP complete: {} points → 3D in {:.2}s total (SGD: {:.2}s)",
        n_samples, umap_start.elapsed().as_secs_f64(), sgd_start.elapsed().as_secs_f64());
    embedding
}

/// Find k nearest neighbors using HNSW (Hierarchical Navigable Small World).
///
/// This is O(n log n) for construction + O(k log n) per query = O(n k log n) total.
/// Much faster than brute-force O(n² d) for high-dimensional data.
fn find_k_nearest_neighbors_hnsw(
    data: &[f32],
    n_samples: usize,
    n_dims: usize,
    k: usize,
    ef_construction: usize,
) -> (Vec<Vec<usize>>, Vec<Vec<f32>>) {
    // HNSW parameters tuned for quality/speed balance
    let max_nb_connection = 16; // M parameter: max edges per node
    let nb_layer = 16; // max layers

    // Create HNSW index
    let mut hnsw: Hnsw<f32, DistL2> = Hnsw::new(
        max_nb_connection,
        n_samples,
        nb_layer,
        ef_construction,
        DistL2 {},
    );

    // Convert flat data to Vecs for parallel_insert
    // Also detect zero/abnormal vectors
    let data_vecs: Vec<Vec<f32>> = (0..n_samples)
        .map(|i| {
            let vec = data[i * n_dims..(i + 1) * n_dims].to_vec();
            let magnitude_sq: f32 = vec.iter().map(|x| x * x).sum();
            if magnitude_sq < 1e-10 {
                tracing::warn!("Vector {} has near-zero magnitude ({:.2e}) - may cause outliers", i, magnitude_sq.sqrt());
            }
            vec
        })
        .collect();
    let data_with_ids: Vec<(&Vec<f32>, usize)> = data_vecs.iter().enumerate().map(|(i, v)| (v, i)).collect();

    hnsw.parallel_insert(&data_with_ids);

    // Set ef for search (higher = better recall, slower)
    hnsw.set_searching_mode(true);

    // Query k+1 neighbors for each point (first result is the point itself)
    let results: Vec<(Vec<usize>, Vec<f32>)> = (0..n_samples)
        .into_par_iter()
        .map(|i| {
            let query = &data[i * n_dims..(i + 1) * n_dims];
            let neighbors = hnsw.search(query, k + 1, ef_construction);

            let mut indices = Vec::with_capacity(k);
            let mut distances = Vec::with_capacity(k);

            for neighbor in neighbors {
                let idx = neighbor.d_id;
                if idx != i && indices.len() < k {
                    indices.push(idx);
                    distances.push(neighbor.distance.sqrt()); // hnsw returns squared distance
                }
            }

            // Pad if we didn't get enough neighbors
            // Use large distance to avoid corrupting membership strength calculations
            while indices.len() < k {
                // Point to a random valid neighbor to avoid always connecting to point 0
                let fallback_idx = if !indices.is_empty() { indices[0] } else { (i + 1) % n_samples };
                indices.push(fallback_idx);
                // Use a large distance so these fake edges have minimal weight
                distances.push(1e6);
            }

            (indices, distances)
        })
        .collect();

    let indices: Vec<Vec<usize>> = results.iter().map(|(i, _): &(Vec<usize>, Vec<f32>)| i.clone()).collect();
    let distances: Vec<Vec<f32>> = results.iter().map(|(_, d): &(Vec<usize>, Vec<f32>)| d.clone()).collect();

    (indices, distances)
}

/// Compute fuzzy simplicial set membership strengths.
fn compute_membership_strengths(
    knn_indices: &[Vec<usize>],
    knn_distances: &[Vec<f32>],
    n_samples: usize,
    n_neighbors: usize,
) -> Vec<(usize, usize, f32)> {
    info!("Computing fuzzy simplicial set for {} samples...", n_samples);
    let mut graph = Vec::new();

    // Compute rho and sigma for each point
    let mut rhos = vec![0.0f32; n_samples];
    let mut sigmas = vec![1.0f32; n_samples];

    for i in 0..n_samples {
        // rho = distance to nearest neighbor (excluding zeros from duplicates/padding)
        rhos[i] = knn_distances[i]
            .iter()
            .cloned()
            .filter(|&d| d > 1e-8) // Skip zero distances (duplicates or padding)
            .fold(f32::INFINITY, f32::min);

        // If all distances are zero (rare: all duplicates), use small positive value
        if !rhos[i].is_finite() || rhos[i] > 1e5 {
            rhos[i] = 1e-4;
        }

        // Binary search for sigma
        let target = (n_neighbors as f32).ln();
        let mut lo = 1e-20f32;
        let mut hi = 1e20f32;

        for _ in 0..64 {
            let mid = (lo + hi) / 2.0;
            let sum: f32 = knn_distances[i]
                .iter()
                .map(|&d| (-(d - rhos[i]).max(0.0) / mid).exp())
                .sum();

            if (sum.ln() - target).abs() < 1e-5 {
                sigmas[i] = mid;
                break;
            } else if sum.ln() > target {
                hi = mid;
            } else {
                lo = mid;
            }
            sigmas[i] = mid;
        }
    }

    // Compute membership strengths
    for i in 0..n_samples {
        for (idx, &j) in knn_indices[i].iter().enumerate() {
            let d = knn_distances[i][idx];
            let strength = (-(d - rhos[i]).max(0.0) / sigmas[i]).exp();
            graph.push((i, j, strength));
        }
    }

    // Symmetrize using HashMap for O(1) reverse edge lookup
    // (Previously O(n²) due to linear scan for each edge)
    info!("Symmetrizing graph ({} edges)...", graph.len());
    let symmetrize_start = std::time::Instant::now();

    // Build lookup map for fast reverse edge access: O(n)
    let edge_map: std::collections::HashMap<(usize, usize), f32> = graph
        .iter()
        .map(|&(i, j, w)| ((i, j), w))
        .collect();

    let mut symmetric_graph = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for &(i, j, w_ij) in &graph {
        let key = (i.min(j), i.max(j));
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);

        // O(1) lookup instead of O(n) scan
        let w_ji = edge_map.get(&(j, i)).copied().unwrap_or(0.0);

        let combined = w_ij + w_ji - w_ij * w_ji;
        if combined > 0.0 {
            symmetric_graph.push((i, j, combined));
        }
    }

    info!("Fuzzy simplicial set complete: {} edges in {:.2}s",
        symmetric_graph.len(), symmetrize_start.elapsed().as_secs_f64());
    symmetric_graph
}

/// Initialize embedding using spectral layout or random fallback.
/// For large datasets, skip spectral (O(n³)) and use random directly.
fn initialize_embedding(
    n_samples: usize,
    n_components: usize,
    graph: &[(usize, usize, f32)],
) -> Vec<f32> {
    // Skip spectral for large datasets - O(n³) eigendecomposition is too slow
    // For 15k samples, eigendecomposition takes 8+ minutes
    // Random init works well, just needs slightly more SGD epochs
    if n_samples > 2000 {
        info!("Skipping spectral initialization for {} samples (using random)", n_samples);
        return initialize_embedding_random(n_samples, n_components);
    }

    if let Some(embedding) = initialize_embedding_spectral(n_samples, n_components, graph) {
        embedding
    } else {
        initialize_embedding_random(n_samples, n_components)
    }
}

/// Spectral initialization.
fn initialize_embedding_spectral(
    n_samples: usize,
    n_components: usize,
    graph: &[(usize, usize, f32)],
) -> Option<Vec<f32>> {
    if n_samples < n_components + 1 || graph.is_empty() {
        return None;
    }

    let mut adj = DMatrix::<f64>::zeros(n_samples, n_samples);
    for &(i, j, w) in graph {
        if i < n_samples && j < n_samples {
            adj[(i, j)] = w as f64;
            adj[(j, i)] = w as f64;
        }
    }

    let mut degrees = vec![0.0f64; n_samples];
    for i in 0..n_samples {
        degrees[i] = adj.row(i).sum();
    }

    if degrees.iter().any(|&d| d < 1e-10) {
        return None;
    }

    let mut laplacian = DMatrix::<f64>::identity(n_samples, n_samples);
    for i in 0..n_samples {
        for j in 0..n_samples {
            let d_i_inv_sqrt = 1.0 / degrees[i].sqrt();
            let d_j_inv_sqrt = 1.0 / degrees[j].sqrt();
            laplacian[(i, j)] -= d_i_inv_sqrt * adj[(i, j)] * d_j_inv_sqrt;
        }
    }

    let eigen = laplacian.symmetric_eigen();

    let mut eigen_pairs: Vec<(f64, usize)> = eigen
        .eigenvalues
        .iter()
        .enumerate()
        .map(|(i, &v)| (v, i))
        .collect();
    eigen_pairs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());

    if eigen_pairs.len() < n_components + 1 {
        return None;
    }

    let mut embedding = vec![0.0f32; n_samples * n_components];
    for c in 0..n_components {
        let eigvec_idx = eigen_pairs[c + 1].1;
        let eigvec = eigen.eigenvectors.column(eigvec_idx);

        let max_abs = eigvec
            .iter()
            .map(|v| v.abs())
            .fold(0.0f64, f64::max)
            .max(1e-10);

        let scale = 10.0 / max_abs;
        for i in 0..n_samples {
            embedding[i * n_components + c] = (eigvec[i] * scale) as f32;
        }
    }

    if embedding.iter().any(|v| !v.is_finite()) {
        return None;
    }

    Some(embedding)
}

/// Random initialization fallback.
fn initialize_embedding_random(n_samples: usize, n_components: usize) -> Vec<f32> {
    let mut rng = SmallRng::seed_from_u64(42);
    (0..n_samples * n_components)
        .map(|_| rng.gen::<f32>() * 10.0 - 5.0)
        .collect()
}

/// Optimize embedding using Hogwild!-style parallel SGD.
///
/// Processes edges in parallel batches with lock-free updates.
///
/// # Why Race Conditions Are Acceptable
///
/// This uses the Hogwild! approach (Recht et al., 2011) where race conditions are
/// deliberately tolerated for performance. This works because:
///
/// 1. **Sparse updates**: Most updates affect different embedding vectors. With N points
///    and 3D embeddings, conflicts require two threads to update the same 3 floats
///    simultaneously - rare when N is large.
///
/// 2. **Averaging effect**: Small conflicts (lost updates, stale reads) average out
///    over many epochs. The SGD noise already includes random negative sampling,
///    so minor inconsistencies are absorbed into the stochastic process.
///
/// 3. **Robust convergence**: UMAP's optimization is empirically robust to gradient
///    noise. The algorithm seeks low-energy configurations rather than exact solutions,
///    tolerating perturbations that preserve the overall structure.
///
/// Expected speedup: 3-10x on multi-core systems for large datasets.
///
/// References:
/// - Hogwild!: A Lock-Free Approach to Parallelizing Stochastic Gradient Descent
///   https://arxiv.org/abs/1106.5730
fn optimize_layout(
    embedding: &mut [f32],
    graph: &[(usize, usize, f32)],
    n_samples: usize,
    n_components: usize,
    n_epochs: usize,
    a: f32,
    b: f32,
    progress: Option<ProgressCallback>,
    cancelled: Option<Arc<AtomicBool>>,
) {
    use std::sync::atomic::{AtomicU32, Ordering};

    let negative_sample_rate = 15;

    let max_weight = graph.iter().map(|&(_, _, w)| w).fold(0.0f32, f32::max);
    let epochs_per_sample: Vec<f32> = graph
        .iter()
        .map(|&(_, _, w)| {
            if w > 1e-10 {
                max_weight / w
            } else {
                f32::INFINITY
            }
        })
        .collect();

    // Convert embedding to atomic f32s for lock-free updates
    // We use AtomicU32 and transmute because AtomicF32 doesn't exist in stable Rust
    let atomic_embedding: Vec<AtomicU32> = embedding
        .iter()
        .map(|&v| AtomicU32::new(v.to_bits()))
        .collect();

    // Helper to read f32 from atomic
    let read_f32 = |idx: usize| -> f32 {
        f32::from_bits(atomic_embedding[idx].load(Ordering::Relaxed))
    };

    // Helper to add to f32 atomically (non-blocking, may have small races)
    let add_f32 = |idx: usize, delta: f32| {
        let mut current = atomic_embedding[idx].load(Ordering::Relaxed);
        loop {
            let current_f32 = f32::from_bits(current);
            let new_f32 = current_f32 + delta;
            match atomic_embedding[idx].compare_exchange_weak(
                current,
                new_f32.to_bits(),
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(x) => current = x,
            }
        }
    };

    // Use thread-local RNG for negative sampling (seeded from thread-local entropy)
    use std::cell::RefCell;
    thread_local! {
        static RNG: RefCell<SmallRng> = RefCell::new(SmallRng::from_entropy());
    }

    // Batch size for parallel processing - tune based on cache line size and conflict rate
    let batch_size = 256.max(graph.len() / rayon::current_num_threads());

    // Report progress frequently enough for smooth bar updates (every ~5% of epochs)
    let progress_interval = (n_epochs / 50).max(1);

    for epoch in 0..n_epochs {
        // Check for cancellation
        if let Some(ref c) = cancelled {
            if c.load(Ordering::Relaxed) {
                info!("UMAP cancelled at epoch {}/{}", epoch, n_epochs);
                break;
            }
        }

        let alpha = 1.0 - (epoch as f32 / n_epochs as f32);
        let epoch_f32 = epoch as f32;

        // Report progress periodically
        if let Some(ref cb) = progress {
            if epoch % progress_interval == 0 {
                cb(epoch as f32 / n_epochs as f32);
            }
        }

        // Collect edges to process this epoch
        let edges_this_epoch: Vec<(usize, usize, usize)> = graph
            .iter()
            .enumerate()
            .filter(|(edge_idx, _)| {
                let sample_at = epochs_per_sample[*edge_idx] * (epoch as f32 / epochs_per_sample[*edge_idx]).floor();
                sample_at <= epoch_f32 && sample_at + epochs_per_sample[*edge_idx] > epoch_f32
            })
            .map(|(_, &(i, j, _))| (i, j, 0))
            .collect();

        // Process edges in parallel batches (Hogwild! style)
        edges_this_epoch
            .par_chunks(batch_size)
            .for_each(|batch| {
                for &(i, j, _) in batch {
                    // Attractive force
                    let mut dist_sq = 0.0f32;
                    for d in 0..n_components {
                        let diff = read_f32(i * n_components + d) - read_f32(j * n_components + d);
                        dist_sq += diff * diff;
                    }
                    dist_sq = dist_sq.max(1e-10);

                    let grad_coeff = -2.0 * a * b * dist_sq.powf(b - 1.0) / (1.0 + a * dist_sq.powf(b));

                    for d in 0..n_components {
                        let diff = read_f32(i * n_components + d) - read_f32(j * n_components + d);
                        let grad = (grad_coeff * diff * alpha).clamp(-4.0, 4.0);
                        add_f32(i * n_components + d, grad);
                        add_f32(j * n_components + d, -grad);
                    }

                    // Repulsive forces (negative sampling)
                    RNG.with(|rng| {
                        let mut rng = rng.borrow_mut();
                        for _ in 0..negative_sample_rate {
                            let k = rng.gen_range(0..n_samples);
                            if k == i || k == j {
                                continue;
                            }

                            let mut dist_sq = 0.0f32;
                            for d in 0..n_components {
                                let diff = read_f32(i * n_components + d) - read_f32(k * n_components + d);
                                dist_sq += diff * diff;
                            }
                            dist_sq = dist_sq.max(1e-10);

                            let grad_coeff = 2.0 * b / (dist_sq.max(0.001) * (1.0 + a * dist_sq.powf(b)));

                            for d in 0..n_components {
                                let diff = read_f32(i * n_components + d) - read_f32(k * n_components + d);
                                let grad = (grad_coeff * diff * alpha).clamp(-4.0, 4.0);
                                add_f32(i * n_components + d, grad);
                            }
                        }
                    });
                }
            });
    }

    // Copy results back to embedding
    for (i, atomic) in atomic_embedding.iter().enumerate() {
        embedding[i] = f32::from_bits(atomic.load(Ordering::Relaxed));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_umap_output_shape() {
        let data: Vec<f32> = (0..50).map(|i| (i as f32 * 0.1).sin()).collect();

        let result = fit(&data, 10, 5, 3, 0.1, 50, 200);
        assert_eq!(result.len(), 30);
    }

    #[test]
    fn test_umap_preserves_structure() {
        let mut rng = SmallRng::seed_from_u64(123);
        let mut data = Vec::new();

        // Cluster 1
        for _ in 0..10 {
            data.push(rng.gen::<f32>() * 0.5);
            data.push(rng.gen::<f32>() * 0.5);
            data.push(rng.gen::<f32>() * 0.5);
        }

        // Cluster 2
        for _ in 0..10 {
            data.push(100.0 + rng.gen::<f32>() * 0.5);
            data.push(100.0 + rng.gen::<f32>() * 0.5);
            data.push(100.0 + rng.gen::<f32>() * 0.5);
        }

        let result = fit(&data, 20, 3, 5, 0.1, 100, 200);

        let cluster1_center: Vec<f32> = (0..3)
            .map(|d| (0..10).map(|i| result[i * 3 + d]).sum::<f32>() / 10.0)
            .collect();
        let cluster2_center: Vec<f32> = (0..3)
            .map(|d| (10..20).map(|i| result[i * 3 + d]).sum::<f32>() / 10.0)
            .collect();

        let dist: f32 = cluster1_center
            .iter()
            .zip(cluster2_center.iter())
            .map(|(a, b)| (a - b).powi(2))
            .sum();

        assert!(
            dist > 0.1,
            "UMAP should preserve cluster separation, got dist={}",
            dist
        );
    }

    #[test]
    fn test_find_ab_params() {
        let (a, b) = find_ab_params(0.1, 1.0);
        assert!(a > 1.0 && a < 3.0, "a={} should be ~1.58", a);
        assert!(b > 0.5 && b < 1.5, "b={} should be ~0.90", b);
    }

    #[test]
    fn test_hnsw_knn() {
        let data = vec![
            0.0, 0.0, 0.0, // point 0
            1.0, 0.0, 0.0, // point 1
            0.0, 1.0, 0.0, // point 2
            0.0, 0.0, 1.0, // point 3
            1.0, 1.0, 1.0, // point 4
        ];

        let (indices, distances) = find_k_nearest_neighbors_hnsw(&data, 5, 3, 2, 200);

        assert_eq!(indices.len(), 5);
        assert_eq!(distances.len(), 5);

        // Point 0 should have nearby points as neighbors
        assert!(distances[0][0] > 0.0);
        assert!(distances[0][0] <= 2.0); // max distance in unit cube is sqrt(3) ≈ 1.73
    }
}
