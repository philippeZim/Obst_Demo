//! Recognition backend abstraction.
//!
//! The whole app talks to recognisers through the [`Detector`] trait. CNN and
//! KNN still return placeholder random rankings; VLM calls MiniMax M3 via the
//! OpenAI-compatible API for real inference. To ship a trained model you only
//! replace the body of a `detect` method (decode `frame.image_base64`, run
//! inference, return ranked [`Prediction`]s). Nothing else in the app changes.

use serde::Serialize;

use crate::classes::CATEGORIES;
use crate::rng::Rng;

/// One ranked class with its confidence in `[0, 1]`.
#[derive(Debug, Clone, Serialize)]
pub struct Prediction {
    pub class: String,
    pub confidence: f32,
}

/// The result of running one recogniser on one frame. `predictions` is sorted
/// by descending confidence and (across all predictions) sums to ~1.0.
#[derive(Debug, Clone, Serialize)]
pub struct DetectionResult {
    pub model: String,
    pub predictions: Vec<Prediction>,
    /// Human-readable error message (frontend displays it).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Raw model response for debugging.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

/// Static metadata shown on the model-selection screen.
#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub description: String,
}

/// A camera frame handed down from the webview.
///
/// `image_base64` is a base64-encoded JPEG already downscaled by the frontend
/// to roughly Fruit-360 resolution, so a real model can decode and run on it
/// directly. The placeholder implementations ignore the pixels.
#[allow(dead_code)] // fields are the interface real models will consume
pub struct Frame<'a> {
    pub image_base64: &'a str,
    pub width: u32,
    pub height: u32,
}

pub trait Detector: Send + Sync {
    fn info(&self) -> ModelInfo;
    fn detect(&self, frame: &Frame) -> DetectionResult;
}

/// Build a placeholder ranking of `top_k` distinct classes.
///
/// `temperature` shapes the softmax: small => one class dominates (confident),
/// large => the probability mass is spread out (uncertain). Replace callers of
/// this with real inference once the models are trained.
fn random_ranking(rng: &mut Rng, top_k: usize, temperature: f32) -> Vec<Prediction> {
    let n = CATEGORIES.len();
    let k = top_k.min(n);

    // Pick `k` distinct class indices.
    let mut idxs: Vec<usize> = Vec::with_capacity(k);
    while idxs.len() < k {
        let i = rng.below(n);
        if !idxs.contains(&i) {
            idxs.push(i);
        }
    }

    // Random logits, sorted descending so the winner is stable within a frame.
    let mut logits: Vec<f32> = (0..k).map(|_| rng.next_f32()).collect();
    logits.sort_by(|a, b| b.partial_cmp(a).unwrap());

    // Softmax with temperature -> confidences that sum to 1.
    let scaled: Vec<f32> = logits.iter().map(|l| (l / temperature).exp()).collect();
    let sum: f32 = scaled.iter().sum();

    idxs.iter()
        .zip(scaled)
        .map(|(&i, s)| Prediction {
            class: CATEGORIES[i].to_string(),
            confidence: s / sum,
        })
        .collect()
}

/// Convolutional neural network. Returns a fairly peaked top-8 distribution.
struct CnnDetector;
impl Detector for CnnDetector {
    fn info(&self) -> ModelInfo {
        ModelInfo {
            id: "cnn".into(),
            label: "CNN".into(),
            description: "Convolutional neural network trained end-to-end on \
                          the fruit images."
                .into(),
        }
    }
    fn detect(&self, _frame: &Frame) -> DetectionResult {
        let mut rng = Rng::from_time();
        DetectionResult {
            model: self.info().id,
            predictions: random_ranking(&mut rng, 8, 0.15),
            error: None,
            raw: None,
        }
    }
}

/// k-Nearest-Neighbour. Returns a flatter top-5, like neighbour vote shares.
struct KnnDetector;
impl Detector for KnnDetector {
    fn info(&self) -> ModelInfo {
        ModelInfo {
            id: "knn".into(),
            label: "K-Nearest Neighbour".into(),
            description: "Classifies a frame by the labels of its closest \
                          examples in feature space."
                .into(),
        }
    }
    fn detect(&self, _frame: &Frame) -> DetectionResult {
        let mut rng = Rng::from_time();
        DetectionResult {
            model: self.info().id,
            predictions: random_ranking(&mut rng, 5, 0.35),
            error: None,
            raw: None,
        }
    }
}

/// Vision-language model. Calls MiniMax M3 via the OpenAI-compatible API.
struct VlmDetector;
impl VlmDetector {
    fn call_minimax(&self, frame: &Frame) -> DetectionResult {
        let api_key = "sk-cp-xJaa_361u0JaJArynD9MN3AFarT7YdAUVwZxjWqMKHsf1aYoRJ7PX9isgrsuPcVjsz04wusccUwR0RLRuRb3sK0DxjCMzssR4b8Hqv7D8tuvg3sQ1n1SsJ4".to_string();
        let base_url = "https://api.minimax.io/v1".to_string();

        let client = reqwest::blocking::Client::new();

        let categories_str = CATEGORIES
            .iter()
            .map(|c| format!("  \"{}\"", c))
            .collect::<Vec<_>>()
            .join(",\n");

        let body = serde_json::json!({
            "model": "MiniMax-M3",
            "messages": [
                {
                    "role": "system",
                    "content": format!(
                        "You are a produce recognition system. Given an image of a fruit or vegetable, \
                         analyze it and return a JSON array of exactly 10 objects representing the most \
                         likely categories from the provided list. Each object has 'class' (string, exact \
                         match from the list) and 'confidence' (float between 0 and 1). Sort by confidence \
                         descending. Only use categories from this list:\n[\n{}\n]",
                        categories_str
                    )
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "Identify the fruit or vegetable in this image. Return your top 10 guesses from the categories list as a JSON array."
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": format!("data:image/jpeg;base64,{}", frame.image_base64),
                                "detail": "low"
                            }
                        }
                    ]
                }
            ],
            "max_tokens": 1024,
            "temperature": 0.3,
            "thinking": { "type": "disabled" }
        });

        let resp = match client
            .post(format!("{}/chat/completions", base_url))
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&body)
            .send()
        {
            Ok(r) => r,
            Err(e) => {
                return DetectionResult {
                    model: "vlm".into(),
                    predictions: vec![],
                    error: Some(format!("HTTP request failed: {e}")),
                    raw: None,
                }
            }
        };

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().unwrap_or_default();
            return DetectionResult {
                model: "vlm".into(),
                predictions: vec![],
                error: Some(format!("API returned {status}")),
                raw: Some(text),
            };
        }

        let value: serde_json::Value = match resp.json() {
            Ok(v) => v,
            Err(e) => {
                return DetectionResult {
                    model: "vlm".into(),
                    predictions: vec![],
                    error: Some(format!("Failed to parse API response: {e}")),
                    raw: None,
                }
            }
        };

        let content = value["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("");

        let reasoning = value["choices"][0]["message"]["reasoning_content"]
            .as_str()
            .or_else(|| {
                value["choices"][0]["message"]["reasoning_details"]
                    .as_array()
                    .and_then(|arr| arr.first())
                    .and_then(|d| d["text"].as_str())
            });

        let raw_text = match reasoning {
            Some(r) => format!("[reasoning]\n{r}\n[/reasoning]\n{content}"),
            None => content.to_string(),
        };

        match Self::parse_json_list(content) {
            Ok(predictions) => DetectionResult {
                model: "vlm".into(),
                predictions,
                error: None,
                raw: Some(raw_text),
            },
            Err(e) => DetectionResult {
                model: "vlm".into(),
                predictions: vec![],
                error: Some(format!(
                    "{e}\n\nRaw response:\n{}",
                    &raw_text[..raw_text.len().min(2000)]
                )),
                raw: Some(raw_text),
            },
        }
    }

    fn parse_json_list(text: &str) -> Result<Vec<Prediction>, String> {
        let try_parse = |s: &str| -> Option<Vec<Prediction>> {
            let list: Vec<serde_json::Value> = serde_json::from_str(s).ok()?;
            if list.is_empty() {
                return None;
            }
            Some(
                list.into_iter()
                    .take(10)
                    .map(|v| Prediction {
                        class: v["class"].as_str().unwrap_or("Unknown").to_string(),
                        confidence: v["confidence"].as_f64().unwrap_or(0.0) as f32,
                    })
                    .collect(),
            )
        };

        // 1. Direct parse.
        if let Some(p) = try_parse(text.trim()) {
            return Ok(p);
        }

        // 2. Strip <think>…</think> tags (thinking was disabled but be safe).
        let cleaned = text
            .split("<think>")
            .last()
            .unwrap_or(text)
            .rsplit("</think>")
            .next()
            .unwrap_or(text)
            .trim();
        if cleaned != text.trim() {
            if let Some(p) = try_parse(cleaned) {
                return Ok(p);
            }
        }

        // 3. Extract from markdown code block.
        if let Some(start) = text.find("```") {
            let after = &text[start + 3..];
            let inner = after
                .strip_prefix("json")
                .or_else(|| after.strip_prefix("JSON"))
                .unwrap_or(after)
                .trim();
            if let Some(end) = inner.find("```") {
                if let Some(p) = try_parse(inner[..end].trim()) {
                    return Ok(p);
                }
            }
        }

        // 4. Find first '[' and last ']' and try that substring.
        if let Some(open) = text.find('[') {
            if let Some(close) = text.rfind(']') {
                if close > open {
                    let candidate = &text[open..=close];
                    if let Some(p) = try_parse(candidate) {
                        return Ok(p);
                    }
                }
            }
        }

        Err("could not parse model output as JSON array".to_string())
    }
}

impl Detector for VlmDetector {
    fn info(&self) -> ModelInfo {
        ModelInfo {
            id: "vlm".into(),
            label: "VLM".into(),
            description: "Vision-language model (MiniMax M3) prompted to name \
                          the fruit in the frame."
                .into(),
        }
    }
    fn detect(&self, frame: &Frame) -> DetectionResult {
        let mut result = self.call_minimax(frame);
        result.model = self.info().id;
        if result.error.is_some() {
            eprintln!("[VLM] {:?}", result.error);
        }
        result
    }
}

/// All recognisers known to the app, in display order.
pub fn all() -> Vec<Box<dyn Detector>> {
    vec![
        Box::new(CnnDetector),
        Box::new(KnnDetector),
        Box::new(VlmDetector),
    ]
}

/// Look up a recogniser by its `id`.
pub fn get(id: &str) -> Option<Box<dyn Detector>> {
    all().into_iter().find(|d| d.info().id == id)
}
