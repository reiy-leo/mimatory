//! Biometric unlock, per platform. macOS keeps Touch ID through LocalAuthentication directly (objc2); iOS
//! and Android go through `tauri-plugin-biometric` (Face ID / Touch ID / fingerprint). Windows and Linux
//! have none: Windows Hello would need a WinRT binding of its own and Linux has no standard, so both answer
//! `Unavailable` and the lock screen offers the master password only.

#[cfg(target_os = "macos")]
mod platform {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::sync::mpsc;
    use tauri::{AppHandle, Runtime};
    use thiserror::Error;

    #[derive(Debug, Error)]
    pub enum BiometricError {
        #[error("biometric authentication is unavailable")]
        Unavailable,
        #[error("biometric authentication failed or was cancelled")]
        Failed,
        #[error("biometric authentication timed out")]
        Timeout,
    }

    pub fn can_authenticate<R: Runtime>(_app: &AppHandle<R>) -> Result<(), BiometricError> {
        let context = unsafe { LAContext::new() };
        unsafe {
            context
                .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
                .map_err(|_| BiometricError::Unavailable)
        }
    }

    pub fn authenticate<R: Runtime>(app: &AppHandle<R>, reason: &str) -> Result<(), BiometricError> {
        can_authenticate(app)?;
        let context = unsafe { LAContext::new() };
        let reason = NSString::from_str(reason);
        let (tx, rx) = mpsc::channel();
        let block = RcBlock::<dyn Fn(Bool, *mut NSError)>::new(
            move |success: Bool, _error: *mut NSError| {
                let _ = tx.send(success.as_bool());
            },
        );

        unsafe {
            context.evaluatePolicy_localizedReason_reply(
                LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
                &reason,
                &block,
            );
        }

        match rx.recv_timeout(std::time::Duration::from_secs(60)) {
            Ok(true) => Ok(()),
            Ok(false) => Err(BiometricError::Failed),
            Err(_) => Err(BiometricError::Timeout),
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
mod platform {
    use tauri::{AppHandle, Runtime};
    use tauri_plugin_biometric::{AuthOptions, BiometricExt};
    use thiserror::Error;

    #[derive(Debug, Error)]
    pub enum BiometricError {
        #[error("biometric authentication is unavailable")]
        Unavailable,
        #[error("biometric authentication failed or was cancelled: {0}")]
        Failed(String),
    }

    pub fn can_authenticate<R: Runtime>(app: &AppHandle<R>) -> Result<(), BiometricError> {
        match app.biometric().status() {
            Ok(status) if status.is_available => Ok(()),
            _ => Err(BiometricError::Unavailable),
        }
    }

    /// Biometrics only, like Touch ID on the Mac: the device passcode is not accepted in place of the
    /// master password, because a passcode is easier to shoulder-surf than the vault's own secret.
    pub fn authenticate<R: Runtime>(app: &AppHandle<R>, reason: &str) -> Result<(), BiometricError> {
        can_authenticate(app)?;
        let options = AuthOptions {
            allow_device_credential: false,
            title: Some("Passless".to_string()),
            ..AuthOptions::default()
        };
        app.biometric()
            .authenticate(reason.to_string(), options)
            .map_err(|error| BiometricError::Failed(error.to_string()))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "android", target_os = "ios")))]
mod platform {
    use tauri::{AppHandle, Runtime};
    use thiserror::Error;

    #[derive(Debug, Error)]
    pub enum BiometricError {
        #[error("biometric unlock is not available on this platform")]
        Unavailable,
    }

    pub fn can_authenticate<R: Runtime>(_app: &AppHandle<R>) -> Result<(), BiometricError> {
        Err(BiometricError::Unavailable)
    }

    pub fn authenticate<R: Runtime>(_app: &AppHandle<R>, _reason: &str) -> Result<(), BiometricError> {
        Err(BiometricError::Unavailable)
    }
}

pub use platform::*;
