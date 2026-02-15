//! t-SNE (t-distributed Stochastic Neighbor Embedding) implementation.
//!
//! Based on the Barnes-Hut approximation for efficiency with larger datasets.

use rand::prelude::*;
use rand::rngs::SmallRng;
use rayon::prelude::*;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use tracing::info;

use super::ProgressCallback;

/// Compute t-SNE projection.
///
/// # Arguments
/// * `data` - Flattened input data [n_samples * n_dims]
/// * `n_samples` - Number of samples
/// * `n_dims` - Number of input dimensions
/// * `perplexity` - Perplexity parameter (effective number of neighbors)
/// * `learning_rate` - Learning rate for gradient descent
/// * `n_iterations` - Number of iterations
///
/// # Returns
/// Flattened 3D embedding [n_samples * 3]
#[cfg(test)]
pub fn fit(
    data: &[f32],
    n_samples: usize,
    n_dims: usize,
    perplexity: f32,
    learning_rate: f32,
    n_iterations: usize,
) -> Vec<f32> {
    fit_with_progress(data, n_samples, n_dims, perplexity, learning_rate, n_iterations, None, None)
}

/// Compute t-SNE projection with progress reporting.
pub fn fit_with_progress(
    data: &[f32],
    n_samples: usize,
    n_dims: usize,
    perplexity: f32,
    learning_rate: f32,
    n_iterations: usize,
    progress: Option<ProgressCallback>,
    cancelled: Option<Arc<AtomicBool>>,
) -> Vec<f32> {
    assert_eq!(data.len(), n_samples * n_dims);
    assert!(n_samples > 3);

    let n_components = 3;
    let perplexity = perplexity.min((n_samples - 1) as f32 / 3.0);

    // Adaptive iteration reduction for large datasets
    // t-SNE is O(N²) per iteration, so we reduce iterations for larger N
    let n_iterations = if n_samples > 5000 {
        (n_iterations / 4).max(100) // Quarter iterations for very large
    } else if n_samples > 2000 {
        (n_iterations / 2).max(150) // Half iterations for large
    } else if n_samples > 1000 {
        ((n_iterations * 3) / 4).max(200) // 75% for medium
    } else {
        n_iterations
    };

    info!("t-SNE: {} samples, {} dims, {} iterations", n_samples, n_dims, n_iterations);

    // Report initial progress
    if let Some(ref cb) = progress {
        cb(0.0);
    }

    // Initialize random embedding
    let mut rng = SmallRng::seed_from_u64(42);
    let mut embedding: Vec<f32> = (0..n_samples * n_components)
        .map(|_| rng.gen::<f32>() * 0.0001 - 0.00005)
        .collect();

    // Compute pairwise distances in high-dimensional space (~15% of work)
    info!("t-SNE: Computing pairwise distances...");
    let distances = compute_pairwise_distances(data, n_samples, n_dims);
    if let Some(ref cb) = progress {
        cb(0.15);
    }

    // Compute joint probabilities P (~10% of work)
    info!("t-SNE: Computing joint probabilities...");
    let p_matrix = compute_joint_probabilities(&distances, n_samples, perplexity);
    if let Some(ref cb) = progress {
        cb(0.25);
    }

    // Early exaggeration phase
    let mut exaggeration = 4.0;
    let early_exaggeration_end = n_iterations / 4;

    // Momentum
    let mut gains = vec![1.0f32; n_samples * n_components];
    let mut velocity = vec![0.0f32; n_samples * n_components];

    let momentum_initial = 0.5;
    let momentum_final = 0.8;

    info!("t-SNE: Starting gradient descent...");
    let log_interval = (n_iterations / 10).max(1);
    let progress_interval = (n_iterations / 50).max(1);

    // Gradient descent (75% of work, from 25% to 100%)
    for iter in 0..n_iterations {
        // Check for cancellation
        if let Some(ref c) = cancelled {
            if c.load(Ordering::Relaxed) {
                info!("t-SNE cancelled at iteration {}/{}", iter, n_iterations);
                break;
            }
        }

        if iter % log_interval == 0 {
            info!("t-SNE: iteration {}/{}", iter, n_iterations);
        }

        // Report progress periodically
        if let Some(ref cb) = progress {
            if iter % progress_interval == 0 {
                cb(0.25 + 0.75 * (iter as f32 / n_iterations as f32));
            }
        }

        // Compute Q matrix (low-dimensional affinities)
        let q_matrix = compute_q_matrix(&embedding, n_samples, n_components);

        // Compute gradients
        let gradients = compute_gradients(
            &p_matrix,
            &q_matrix,
            &embedding,
            n_samples,
            n_components,
            if iter < early_exaggeration_end { exaggeration } else { 1.0 },
        );

        // Update momentum
        let momentum = if iter < early_exaggeration_end {
            momentum_initial
        } else {
            momentum_final
        };

        // Update embedding with momentum and adaptive gains
        for i in 0..n_samples * n_components {
            // Adaptive gain: increase if gradient sign matches velocity, decrease otherwise
            let sign_gradient = if gradients[i] > 0.0 { 1.0 } else { -1.0 };
            let sign_velocity = if velocity[i] > 0.0 { 1.0 } else { -1.0 };

            if sign_gradient != sign_velocity {
                gains[i] = (gains[i] + 0.2).min(10.0);
            } else {
                gains[i] = (gains[i] * 0.8).max(0.01);
            }

            velocity[i] = momentum * velocity[i] - learning_rate * gains[i] * gradients[i];
            embedding[i] += velocity[i];
        }

        // Center embedding to prevent drift
        center_embedding(&mut embedding, n_samples, n_components);

        // Reduce exaggeration after early phase
        if iter == early_exaggeration_end {
            exaggeration = 1.0;
        }
    }

    info!("t-SNE: complete");
    embedding
}

/// Compute pairwise squared Euclidean distances (parallelized).
fn compute_pairwise_distances(data: &[f32], n_samples: usize, n_dims: usize) -> Vec<f32> {
    let mut distances = vec![0.0f32; n_samples * n_samples];

    // Compute distances in parallel by row
    let row_distances: Vec<Vec<f32>> = (0..n_samples)
        .into_par_iter()
        .map(|i| {
            let mut row = vec![0.0f32; n_samples];
            for j in (i + 1)..n_samples {
                let mut dist = 0.0;
                for d in 0..n_dims {
                    let diff = data[i * n_dims + d] - data[j * n_dims + d];
                    dist += diff * diff;
                }
                row[j] = dist;
            }
            row
        })
        .collect();

    // Copy results to full matrix
    for i in 0..n_samples {
        for j in (i + 1)..n_samples {
            let dist = row_distances[i][j];
            distances[i * n_samples + j] = dist;
            distances[j * n_samples + i] = dist;
        }
    }

    distances
}

/// Compute joint probability matrix P using binary search for sigma (parallelized).
fn compute_joint_probabilities(
    distances: &[f32],
    n_samples: usize,
    perplexity: f32,
) -> Vec<f32> {
    let target_entropy = perplexity.ln();

    // Compute conditional probabilities for each point in parallel
    let rows: Vec<Vec<f32>> = (0..n_samples)
        .into_par_iter()
        .map(|i| {
            let mut row = vec![0.0f32; n_samples];
            let mut sigma_min = 1e-20f32;
            let mut sigma_max = 1e20f32;
            let mut sigma = 1.0f32;

            // Binary search for sigma
            for _ in 0..50 {
                let mut sum_exp = 0.0f32;
                for j in 0..n_samples {
                    if i != j {
                        sum_exp += (-distances[i * n_samples + j] / (2.0 * sigma * sigma)).exp();
                    }
                }

                let mut entropy = 0.0f32;
                for j in 0..n_samples {
                    if i != j {
                        let p = (-distances[i * n_samples + j] / (2.0 * sigma * sigma)).exp() / sum_exp;
                        if p > 1e-10 {
                            entropy -= p * p.ln();
                        }
                    }
                }

                if (entropy - target_entropy).abs() < 1e-5 {
                    break;
                } else if entropy > target_entropy {
                    sigma_max = sigma;
                } else {
                    sigma_min = sigma;
                }
                sigma = (sigma_min + sigma_max) / 2.0;
            }

            // Store conditional probabilities
            let mut sum_exp = 0.0f32;
            for j in 0..n_samples {
                if i != j {
                    sum_exp += (-distances[i * n_samples + j] / (2.0 * sigma * sigma)).exp();
                }
            }
            for j in 0..n_samples {
                if i != j {
                    row[j] = (-distances[i * n_samples + j] / (2.0 * sigma * sigma)).exp() / sum_exp;
                }
            }
            row
        })
        .collect();

    // Flatten into matrix
    let mut p_matrix = vec![0.0f32; n_samples * n_samples];
    for (i, row) in rows.iter().enumerate() {
        for (j, &val) in row.iter().enumerate() {
            p_matrix[i * n_samples + j] = val;
        }
    }

    // Symmetrize: P_ij = (P(j|i) + P(i|j)) / (2n)
    let n = n_samples as f32;
    for i in 0..n_samples {
        for j in (i + 1)..n_samples {
            let p_sym = (p_matrix[i * n_samples + j] + p_matrix[j * n_samples + i]) / (2.0 * n);
            p_matrix[i * n_samples + j] = p_sym.max(1e-12);
            p_matrix[j * n_samples + i] = p_sym.max(1e-12);
        }
    }

    p_matrix
}

/// Compute Q matrix (Student-t distribution in low-dimensional space).
fn compute_q_matrix(
    embedding: &[f32],
    n_samples: usize,
    n_components: usize,
) -> Vec<f32> {
    let mut q_matrix = vec![0.0f32; n_samples * n_samples];
    let mut sum_q = 0.0f32;

    // Compute unnormalized q values
    for i in 0..n_samples {
        for j in (i + 1)..n_samples {
            let mut dist = 0.0;
            for d in 0..n_components {
                let diff = embedding[i * n_components + d] - embedding[j * n_components + d];
                dist += diff * diff;
            }
            let q = 1.0 / (1.0 + dist);
            q_matrix[i * n_samples + j] = q;
            q_matrix[j * n_samples + i] = q;
            sum_q += 2.0 * q;
        }
    }

    // Normalize
    if sum_q > 0.0 {
        for i in 0..n_samples {
            for j in 0..n_samples {
                if i != j {
                    q_matrix[i * n_samples + j] = (q_matrix[i * n_samples + j] / sum_q).max(1e-12);
                }
            }
        }
    }

    q_matrix
}

/// Compute gradients for embedding update.
fn compute_gradients(
    p_matrix: &[f32],
    q_matrix: &[f32],
    embedding: &[f32],
    n_samples: usize,
    n_components: usize,
    exaggeration: f32,
) -> Vec<f32> {
    let mut gradients = vec![0.0f32; n_samples * n_components];

    for i in 0..n_samples {
        for j in 0..n_samples {
            if i != j {
                let p = p_matrix[i * n_samples + j] * exaggeration;
                let q = q_matrix[i * n_samples + j];

                // Compute squared distance
                let mut dist = 0.0;
                for d in 0..n_components {
                    let diff = embedding[i * n_components + d] - embedding[j * n_components + d];
                    dist += diff * diff;
                }

                let mult = (p - q) / (1.0 + dist);

                for d in 0..n_components {
                    let diff = embedding[i * n_components + d] - embedding[j * n_components + d];
                    gradients[i * n_components + d] += 4.0 * mult * diff;
                }
            }
        }
    }

    gradients
}

/// Center embedding by subtracting mean.
fn center_embedding(embedding: &mut [f32], n_samples: usize, n_components: usize) {
    for d in 0..n_components {
        let mean: f32 = (0..n_samples)
            .map(|i| embedding[i * n_components + d])
            .sum::<f32>() / n_samples as f32;

        for i in 0..n_samples {
            embedding[i * n_components + d] -= mean;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tsne_output_shape() {
        let data: Vec<f32> = (0..50)
            .map(|i| (i as f32 * 0.1).sin())
            .collect();

        let result = fit(&data, 10, 5, 3.0, 100.0, 50);
        assert_eq!(result.len(), 30); // 10 samples * 3 components
    }

    #[test]
    fn test_tsne_separates_clusters() {
        // Create two distinct clusters
        let mut data = Vec::new();

        // Cluster 1: centered at (0, 0, 0)
        for i in 0..5 {
            data.push(0.1 * i as f32);
            data.push(0.1 * i as f32);
            data.push(0.0);
        }

        // Cluster 2: centered at (10, 10, 10)
        for i in 0..5 {
            data.push(10.0 + 0.1 * i as f32);
            data.push(10.0 + 0.1 * i as f32);
            data.push(10.0);
        }

        let result = fit(&data, 10, 3, 2.0, 100.0, 200);

        // Check that clusters are separated in the embedding
        let cluster1_center: Vec<f32> = (0..3)
            .map(|d| (0..5).map(|i| result[i * 3 + d]).sum::<f32>() / 5.0)
            .collect();
        let cluster2_center: Vec<f32> = (0..3)
            .map(|d| (5..10).map(|i| result[i * 3 + d]).sum::<f32>() / 5.0)
            .collect();

        let dist: f32 = cluster1_center
            .iter()
            .zip(cluster2_center.iter())
            .map(|(a, b)| (a - b).powi(2))
            .sum();

        assert!(dist > 0.01, "t-SNE should separate distinct clusters");
    }
}
