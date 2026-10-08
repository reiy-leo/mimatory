#[cfg(target_os = "macos")]
mod platform {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSError, NSString};
    use objc2_local_authentication::{LAContext, LAPolicy};
    use std::sync::mpsc;
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

    pub fn can_authenticate() -> Result<(), BiometricError> {
        let context = unsafe { LAContext::new() };
        unsafe {
            context
                .canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics)
                .map_err(|_| BiometricError::Unavailable)
        }
    }

    pub fn authenticate(reason: &str) -> Result<(), BiometricError> {
        can_authenticate()?;
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

#[cfg(not(target_os = "macos"))]
mod platform {
    use thiserror::Error;

    #[derive(Debug, Error)]
    pub enum BiometricError {
        #[error("biometric authentication is only implemented on macOS")]
        Unavailable,
    }

    pub fn can_authenticate() -> Result<(), BiometricError> {
        Err(BiometricError::Unavailable)
    }

    pub fn authenticate(_reason: &str) -> Result<(), BiometricError> {
        Err(BiometricError::Unavailable)
    }
}

pub use platform::*;
