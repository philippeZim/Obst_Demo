//! Recognition backend abstraction.
//!
//! The whole app talks to recognisers through the [`Detector`] trait. Today
//! every implementation returns a *random* ranking over [`FRUIT_CLASSES`], but
//! the boundary is the real one: to ship a trained model you only replace the
//! body of a `detect` method (decode `frame.image_base64`, run inference,
//! return ranked [`Prediction`]s). Nothing else in the app has to change.

use serde::Serialize;

use crate::classes::FRUIT_CLASSES;
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
    let n = FRUIT_CLASSES.len();
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
            class: FRUIT_CLASSES[i].to_string(),
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
        }
    }
}

/// Vision-language model. Returns a confident top-3.
struct VlmDetector;
impl Detector for VlmDetector {
    fn info(&self) -> ModelInfo {
        ModelInfo {
            id: "vlm".into(),
            label: "VLM".into(),
            description: "Vision-language model prompted to name the fruit in \
                          the frame."
                .into(),
        }
    }
    fn detect(&self, _frame: &Frame) -> DetectionResult {
        let mut rng = Rng::from_time();
        DetectionResult {
            model: self.info().id,
            predictions: random_ranking(&mut rng, 3, 0.10),
        }
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
