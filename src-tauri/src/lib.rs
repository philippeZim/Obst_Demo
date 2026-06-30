mod classes;
mod detector;
mod rng;

use detector::{DetectionResult, Frame, ModelInfo};

/// List the recognisers the user can choose from.
#[tauri::command]
fn list_models() -> Vec<ModelInfo> {
    detector::all().into_iter().map(|d| d.info()).collect()
}

/// Run the selected recogniser on one camera frame.
///
/// `image_base64` is a downscaled JPEG (no data-URL prefix). The placeholder
/// recognisers ignore the pixels and return a random ranking; real models will
/// decode and run on it here.
#[tauri::command]
fn detect(
    model: String,
    image_base64: String,
    width: u32,
    height: u32,
) -> Result<DetectionResult, String> {
    let recogniser = detector::get(&model).ok_or_else(|| format!("Unknown model: {model}"))?;
    let frame = Frame {
        image_base64: &image_base64,
        width,
        height,
    };
    Ok(recogniser.detect(&frame))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![list_models, detect])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
