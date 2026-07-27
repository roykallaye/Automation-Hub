use serde::Serialize;
use std::ffi::OsStr;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
};
use tauri_plugin_autostart::ManagerExt;

pub(crate) const BACKGROUND_ARG: &str = "--background";

const OPEN_MENU_ID: &str = "open";
const QUIT_MENU_ID: &str = "quit";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DesktopServiceStatus {
    launch_at_sign_in: bool,
    keeps_running_when_closed: bool,
    changes_available: bool,
}

pub(crate) fn setup(app: &mut App) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, OPEN_MENU_ID, "Apri InnPilot", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, QUIT_MENU_ID, "Esci da InnPilot", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    let mut tray = TrayIconBuilder::new()
        .tooltip("InnPilot · automazioni hotel")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN_MENU_ID => show_main_window(app),
            QUIT_MENU_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(event, TrayIconEvent::DoubleClick { .. }) {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;

    if arguments_request_background(std::env::args_os()) {
        if let Some(window) = app.get_webview_window("main") {
            window.hide()?;
        }
    }
    Ok(())
}

pub(crate) fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub(crate) fn status(app: &AppHandle) -> Result<DesktopServiceStatus, String> {
    let launch_at_sign_in = app
        .autolaunch()
        .is_enabled()
        .map_err(|_| "Windows could not read the InnPilot startup preference.".to_string())?;
    Ok(DesktopServiceStatus {
        launch_at_sign_in,
        keeps_running_when_closed: true,
        changes_available: !cfg!(debug_assertions),
    })
}

pub(crate) fn set_enabled(
    app: &AppHandle,
    enabled: bool,
    confirmed: bool,
) -> Result<DesktopServiceStatus, String> {
    require_safe_change(confirmed, !cfg!(debug_assertions))?;
    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
    result.map_err(|_| "Windows could not save the InnPilot startup preference.".to_string())?;
    status(app)
}

fn require_safe_change(confirmed: bool, release_build: bool) -> Result<(), String> {
    if !confirmed {
        return Err("Changing Windows startup requires an explicit confirmation.".to_string());
    }
    if !release_build {
        return Err(
            "Windows startup can only be changed from an installed InnPilot build.".to_string(),
        );
    }
    Ok(())
}

fn arguments_request_background<I, S>(arguments: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    arguments
        .into_iter()
        .any(|argument| argument.as_ref() == OsStr::new(BACKGROUND_ARG))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_exact_background_argument_hides_the_window() {
        assert!(arguments_request_background([
            "innpilot.exe",
            "--background"
        ]));
        assert!(!arguments_request_background([
            "innpilot.exe",
            "--background=false"
        ]));
        assert!(!arguments_request_background([
            "innpilot.exe",
            "background"
        ]));
    }

    #[test]
    fn startup_changes_require_confirmation_and_an_installed_build() {
        assert!(require_safe_change(false, true).is_err());
        assert!(require_safe_change(true, false).is_err());
        assert!(require_safe_change(true, true).is_ok());
    }
}
