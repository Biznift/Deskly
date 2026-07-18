use enigo::{
    Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum RemoteInputEvent {
    #[serde(rename = "mousemove")]
    MouseMove { x: f64, y: f64 },
    #[serde(rename = "mousedown")]
    MouseDown { button: u8, x: f64, y: f64 },
    #[serde(rename = "mouseup")]
    MouseUp { button: u8, x: f64, y: f64 },
    #[serde(rename = "keydown")]
    KeyDown {
        key: String,
        #[serde(default)]
        code: String,
    },
    #[serde(rename = "keyup")]
    KeyUp {
        key: String,
        #[serde(default)]
        code: String,
    },
    #[serde(rename = "wheel")]
    Wheel {
        #[serde(default, rename = "deltaX")]
        delta_x: f64,
        #[serde(default, rename = "deltaY")]
        delta_y: f64,
        x: f64,
        y: f64,
    },
}

fn primary_screen_size() -> Result<(i32, i32), String> {
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        unsafe extern "system" {
            fn GetSystemMetrics(n_index: i32) -> i32;
        }
        const SM_CXSCREEN: i32 = 0;
        const SM_CYSCREEN: i32 = 1;
        unsafe {
            let w = GetSystemMetrics(SM_CXSCREEN);
            let h = GetSystemMetrics(SM_CYSCREEN);
            if w <= 0 || h <= 0 {
                return Err("GetSystemMetrics failed".into());
            }
            Ok((w, h))
        }
    }
    #[cfg(not(windows))]
    {
        Err("Screen size only implemented on Windows for MVP".into())
    }
}

fn norm_to_pixels(x: f64, y: f64) -> Result<(i32, i32), String> {
    let (sw, sh) = primary_screen_size()?;
    let px = (x.clamp(0.0, 1.0) * f64::from(sw - 1)).round() as i32;
    let py = (y.clamp(0.0, 1.0) * f64::from(sh - 1)).round() as i32;
    Ok((px, py))
}

fn map_button(button: u8) -> Button {
    match button {
        1 => Button::Middle,
        2 => Button::Right,
        _ => Button::Left,
    }
}

fn map_key(key: &str, code: &str) -> Option<Key> {
    let code = if code.is_empty() { key } else { code };
    Some(match code {
        "Enter" => Key::Return,
        "Escape" => Key::Escape,
        "Backspace" => Key::Backspace,
        "Tab" => Key::Tab,
        "Space" | " " => Key::Space,
        "Delete" => Key::Delete,
        "ArrowUp" => Key::UpArrow,
        "ArrowDown" => Key::DownArrow,
        "ArrowLeft" => Key::LeftArrow,
        "ArrowRight" => Key::RightArrow,
        "Home" => Key::Home,
        "End" => Key::End,
        "PageUp" => Key::PageUp,
        "PageDown" => Key::PageDown,
        "ControlLeft" | "ControlRight" => Key::Control,
        "ShiftLeft" | "ShiftRight" => Key::Shift,
        "AltLeft" | "AltRight" => Key::Alt,
        "MetaLeft" | "MetaRight" => Key::Meta,
        "CapsLock" => Key::CapsLock,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        other => {
            // KeyA → 'a', Digit1 → use key char, or single Unicode key
            if let Some(ch) = key.chars().next() {
                if key.chars().count() == 1 {
                    return Some(Key::Unicode(ch.to_ascii_lowercase()));
                }
            }
            if other.starts_with("Key") && other.len() == 4 {
                let c = other.chars().nth(3)?.to_ascii_lowercase();
                return Some(Key::Unicode(c));
            }
            if other.starts_with("Digit") && other.len() == 6 {
                let c = other.chars().nth(5)?;
                return Some(Key::Unicode(c));
            }
            return None;
        }
    })
}

fn with_enigo<F>(f: F) -> Result<(), String>
where
    F: FnOnce(&mut Enigo) -> Result<(), enigo::InputError>,
{
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    f(&mut enigo).map_err(|e| e.to_string())
}

pub fn get_screen_info() -> Result<(u32, u32), String> {
    let (w, h) = primary_screen_size()?;
    Ok((w as u32, h as u32))
}

pub fn inject_event(event: RemoteInputEvent) -> Result<(), String> {
    match event {
        RemoteInputEvent::MouseMove { x, y } => {
            let (px, py) = norm_to_pixels(x, y)?;
            with_enigo(|e| e.move_mouse(px, py, Coordinate::Abs))
        }
        RemoteInputEvent::MouseDown { button, x, y } => {
            let (px, py) = norm_to_pixels(x, y)?;
            with_enigo(|e| {
                e.move_mouse(px, py, Coordinate::Abs)?;
                e.button(map_button(button), Direction::Press)
            })
        }
        RemoteInputEvent::MouseUp { button, x, y } => {
            let (px, py) = norm_to_pixels(x, y)?;
            with_enigo(|e| {
                e.move_mouse(px, py, Coordinate::Abs)?;
                e.button(map_button(button), Direction::Release)
            })
        }
        RemoteInputEvent::KeyDown { key, code } => {
            let Some(k) = map_key(&key, &code) else {
                return Ok(());
            };
            with_enigo(|e| e.key(k, Direction::Press))
        }
        RemoteInputEvent::KeyUp { key, code } => {
            let Some(k) = map_key(&key, &code) else {
                return Ok(());
            };
            with_enigo(|e| e.key(k, Direction::Release))
        }
        RemoteInputEvent::Wheel {
            delta_x,
            delta_y,
            x,
            y,
        } => {
            let (px, py) = norm_to_pixels(x, y)?;
            with_enigo(|e| {
                e.move_mouse(px, py, Coordinate::Abs)?;
                // Browser: positive deltaY = scroll down. Enigo vertical: positive = up.
                let lines_y = (-delta_y / 100.0).round() as i32;
                let lines_x = (delta_x / 100.0).round() as i32;
                if lines_y != 0 {
                    e.scroll(lines_y, enigo::Axis::Vertical)?;
                }
                if lines_x != 0 {
                    e.scroll(lines_x, enigo::Axis::Horizontal)?;
                }
                Ok(())
            })
        }
    }
}
