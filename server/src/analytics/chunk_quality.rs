//! Chunk quality analysis for RAG pipeline health.

use super::types::*;
use crate::db::DatabaseBackend;
use rayon::prelude::*;

/// Analyze chunk quality in a collection.
pub async fn analyze_chunk_quality(
    backend: &dyn DatabaseBackend,
    collection: &str,
    query: &ChunkQualityQuery,
) -> Result<ChunkQualityResult, String> {
    let response = backend.get_vectors(collection, query.scan_limit, 0).await?;

    // Auto-detect content field if not specified
    let content_field = query
        .content_field
        .clone()
        .or_else(|| detect_content_field(&response.vectors))
        .ok_or_else(|| "No text content field found. Specify content_field parameter.".to_string())?;

    // Extract text content from vectors
    let texts: Vec<(String, String)> = response
        .vectors
        .iter()
        .filter_map(|v| {
            v.metadata
                .get(&content_field)
                .and_then(|val| val.as_str())
                .map(|s| (v.id.clone(), s.to_string()))
        })
        .collect();

    if texts.is_empty() {
        return Ok(ChunkQualityResult {
            collection: collection.to_string(),
            total_scanned: response.vectors.len() as u64,
            quality_score: 100.0,
            grade: "excellent".to_string(),
            content_field,
            length_stats: LengthStats {
                mean: 0.0,
                median: 0.0,
                min: 0,
                max: 0,
                std: 0.0,
            },
            issues: Vec::new(),
            issue_breakdown: ChunkIssueBreakdown::default(),
            length_histogram: Vec::new(),
        });
    }

    let mut issues: Vec<ChunkIssue> = Vec::new();
    let mut breakdown = ChunkIssueBreakdown::default();

    // Compute length statistics
    let lengths: Vec<usize> = texts.iter().map(|(_, t)| t.len()).collect();
    let n = lengths.len();
    let mean_len = lengths.iter().sum::<usize>() as f32 / n as f32;
    let mut sorted_lengths = lengths.clone();
    sorted_lengths.sort();
    let median_len = sorted_lengths[n / 2] as f32;
    let min_len = sorted_lengths[0];
    let max_len = sorted_lengths[n - 1];
    let variance = lengths.iter().map(|&l| (l as f32 - mean_len).powi(2)).sum::<f32>() / n as f32;
    let std_len = variance.sqrt();

    // 1. Length analysis
    for (id, text) in &texts {
        let len = text.len();
        if len < query.min_length {
            breakdown.too_short += 1;
            issues.push(ChunkIssue {
                vector_id: id.clone(),
                issue_type: ChunkIssueType::TooShort,
                detail: format!("{} chars (min: {})", len, query.min_length),
                text_preview: truncate_text(text, 100),
            });
        } else if len > query.max_length {
            breakdown.too_long += 1;
            issues.push(ChunkIssue {
                vector_id: id.clone(),
                issue_type: ChunkIssueType::TooLong,
                detail: format!("{} chars (max: {})", len, query.max_length),
                text_preview: truncate_text(text, 100),
            });
        }
    }

    // 2. Sentence boundary analysis
    for (id, text) in &texts {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        let first_char = trimmed.chars().next().unwrap_or(' ');
        let last_char = trimmed.chars().last().unwrap_or(' ');

        let starts_lowercase = first_char.is_lowercase();
        let ends_without_punct = !matches!(last_char, '.' | '!' | '?' | '"' | '\'' | ')' | ']');

        if starts_lowercase && ends_without_punct {
            breakdown.broken_boundary += 1;
            issues.push(ChunkIssue {
                vector_id: id.clone(),
                issue_type: ChunkIssueType::BrokenBoundary,
                detail: "Starts lowercase and ends without punctuation".to_string(),
                text_preview: truncate_text(text, 100),
            });
        }
    }

    // 3. Orphan detection (chunks with very low similarity to all others)
    // Only run if we have vectors and the set is small enough
    let eligible_for_orphan: Vec<_> = response
        .vectors
        .iter()
        .filter(|v| v.vector.is_some())
        .collect();

    if eligible_for_orphan.len() >= 2 && eligible_for_orphan.len() <= 2000 {
        let vec_data: Vec<(&str, &[f32])> = eligible_for_orphan
            .iter()
            .map(|v| (v.id.as_str(), v.vector.as_ref().unwrap().as_slice()))
            .collect();

        let orphan_threshold = 0.5;
        let orphan_ids: Vec<String> = (0..vec_data.len())
            .into_par_iter()
            .filter_map(|i| {
                let max_sim = (0..vec_data.len())
                    .filter(|&j| j != i)
                    .map(|j| cosine_similarity(vec_data[i].1, vec_data[j].1))
                    .max_by(|a, b| a.partial_cmp(b).unwrap())
                    .unwrap_or(0.0);

                if max_sim < orphan_threshold {
                    Some(vec_data[i].0.to_string())
                } else {
                    None
                }
            })
            .collect();

        for id in orphan_ids {
            breakdown.orphan += 1;
            let text_preview = texts
                .iter()
                .find(|(tid, _)| tid == &id)
                .map(|(_, t)| truncate_text(t, 100))
                .unwrap_or_default();

            issues.push(ChunkIssue {
                vector_id: id,
                issue_type: ChunkIssueType::Orphan,
                detail: "Max similarity to other chunks < 0.5".to_string(),
                text_preview,
            });
        }
    }

    // 4. Overlap detection for sequential chunks
    for window in texts.windows(2) {
        let overlap = compute_char_overlap(&window[0].1, &window[1].1);
        if overlap > 0.8 {
            breakdown.high_overlap += 1;
            issues.push(ChunkIssue {
                vector_id: window[1].0.clone(),
                issue_type: ChunkIssueType::HighOverlap,
                detail: format!("{:.0}% overlap with previous chunk", overlap * 100.0),
                text_preview: truncate_text(&window[1].1, 100),
            });
        }
    }

    // Quality score
    let total_issues = issues.len();
    let quality_score = if n > 0 {
        (100.0 - (total_issues as f32 / n as f32 * 100.0)).clamp(0.0, 100.0)
    } else {
        100.0
    };
    let grade = score_to_grade(quality_score as u8);

    // Length histogram
    let length_histogram = build_length_histogram(&sorted_lengths, 20);

    Ok(ChunkQualityResult {
        collection: collection.to_string(),
        total_scanned: response.vectors.len() as u64,
        quality_score,
        grade,
        content_field,
        length_stats: LengthStats {
            mean: mean_len,
            median: median_len,
            min: min_len,
            max: max_len,
            std: std_len,
        },
        issues,
        issue_breakdown: breakdown,
        length_histogram,
    })
}

fn detect_content_field(vectors: &[crate::db::VectorRecord]) -> Option<String> {
    let sample = &vectors[..vectors.len().min(5)];
    let candidates = ["text", "content", "body", "chunk", "passage", "document"];

    for candidate in &candidates {
        let found = sample.iter().any(|v| {
            v.metadata
                .as_object()
                .and_then(|obj| obj.get(*candidate))
                .and_then(|val| val.as_str())
                .map(|s| !s.is_empty())
                .unwrap_or(false)
        });
        if found {
            return Some(candidate.to_string());
        }
    }

    // Try case-insensitive match
    if let Some(first) = sample.first() {
        if let Some(obj) = first.metadata.as_object() {
            for key in obj.keys() {
                let lower = key.to_lowercase();
                if lower.contains("text") || lower.contains("content") || lower.contains("body") {
                    return Some(key.clone());
                }
            }
        }
    }

    None
}

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
    if denom > 0.0 { dot / denom } else { 0.0 }
}

fn compute_char_overlap(a: &str, b: &str) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    // Simple character-level overlap ratio
    let shorter = a.len().min(b.len());
    let longer = a.len().max(b.len());

    // Compare the end of `a` with the beginning of `b`
    let max_overlap = shorter;
    let mut best_overlap = 0;

    for overlap_len in (1..=max_overlap).rev() {
        let a_suffix = &a[a.len().saturating_sub(overlap_len)..];
        let b_prefix = &b[..overlap_len.min(b.len())];
        if a_suffix == b_prefix {
            best_overlap = overlap_len;
            break;
        }
    }

    best_overlap as f32 / longer as f32
}

fn truncate_text(text: &str, max_len: usize) -> String {
    if text.len() <= max_len {
        text.to_string()
    } else {
        format!("{}...", &text[..max_len])
    }
}

fn score_to_grade(score: u8) -> String {
    match score {
        90..=100 => "excellent".to_string(),
        70..=89 => "good".to_string(),
        50..=69 => "fair".to_string(),
        _ => "poor".to_string(),
    }
}

fn build_length_histogram(sorted_lengths: &[usize], bins: usize) -> Vec<HistogramBin> {
    if sorted_lengths.is_empty() || bins == 0 {
        return Vec::new();
    }
    let min = sorted_lengths[0] as f32;
    let max = sorted_lengths[sorted_lengths.len() - 1] as f32;
    let range = max - min;
    if range == 0.0 {
        return vec![HistogramBin {
            min,
            max,
            count: sorted_lengths.len(),
        }];
    }
    let bin_width = range / bins as f32;
    let mut histogram: Vec<HistogramBin> = (0..bins)
        .map(|i| HistogramBin {
            min: min + i as f32 * bin_width,
            max: min + (i + 1) as f32 * bin_width,
            count: 0,
        })
        .collect();

    for &v in sorted_lengths {
        let bin_idx = ((v as f32 - min) / bin_width) as usize;
        let bin_idx = bin_idx.min(bins - 1);
        histogram[bin_idx].count += 1;
    }

    histogram
}
