//! Native cancellation shared by OCR, LLM and typesetting requests. Registration precedes
//! work so an early cancellation cannot be lost between IPC commands.
use futures_util::future::{AbortHandle, AbortRegistration, Abortable};
use std::{collections::HashMap, future::Future, sync::Mutex};
use tauri::State;

#[derive(Default)]
pub struct AiRequests(Mutex<HashMap<String, (AbortHandle, Option<AbortRegistration>)>>);
impl AiRequests {
    fn register(&self, id: String) -> Result<(), String> {
        uuid::Uuid::parse_str(&id).map_err(|_| "Invalid request ID")?;
        let mut requests = self.0.lock().map_err(|e| e.to_string())?;
        if requests.contains_key(&id) {
            return Err("Duplicate request ID".into());
        }
        let (handle, registration) = AbortHandle::new_pair();
        requests.insert(id, (handle, Some(registration)));
        Ok(())
    }
    fn claim(&self, id: &str) -> Result<AbortRegistration, String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .get_mut(id)
            .and_then(|(_, registration)| registration.take())
            .ok_or_else(|| "Request cancelled or already claimed".into())
    }
    fn cancel(&self, id: &str) -> Result<(), String> {
        if let Some((handle, _)) = self.0.lock().map_err(|e| e.to_string())?.remove(id) {
            handle.abort();
        }
        Ok(())
    }
}
#[tauri::command]
pub fn register_ai_request(
    requests: State<'_, AiRequests>,
    request_id: String,
) -> Result<(), String> {
    requests.register(request_id)
}
#[tauri::command]
pub fn cancel_ai_request(
    requests: State<'_, AiRequests>,
    request_id: String,
) -> Result<(), String> {
    requests.cancel(&request_id)
}

pub async fn run<T>(
    requests: &AiRequests,
    id: Option<String>,
    work: impl Future<Output = Result<T, String>>,
) -> Result<T, String> {
    let Some(id) = id else {
        return work.await;
    };
    let registration = requests.claim(&id)?;
    let result = Abortable::new(work, registration)
        .await
        .map_err(|_| "Request cancelled".to_string());
    requests.cancel(&id)?;
    result?
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::task::{Context, Poll};
    #[test]
    fn cancellation_drops_pending_work_and_cannot_be_reclaimed() {
        let requests = AiRequests::default();
        let id = uuid::Uuid::new_v4().to_string();
        requests.register(id.clone()).unwrap();
        assert!(requests.register(id.clone()).is_err());
        let registration = requests.claim(&id).unwrap();
        assert!(requests.claim(&id).is_err());
        let mut work = Box::pin(Abortable::new(std::future::pending::<()>(), registration));
        let waker = futures_util::task::noop_waker();
        let mut context = Context::from_waker(&waker);
        assert!(matches!(work.as_mut().poll(&mut context), Poll::Pending));
        requests.cancel(&id).unwrap();
        assert!(matches!(
            work.as_mut().poll(&mut context),
            Poll::Ready(Err(_))
        ));
        assert!(requests.claim(&id).is_err());
        assert!(requests.0.lock().unwrap().is_empty());
    }
    #[test]
    fn cancellation_before_work_is_not_lost() {
        let requests = AiRequests::default();
        let id = uuid::Uuid::new_v4().to_string();
        requests.register(id.clone()).unwrap();
        requests.cancel(&id).unwrap();
        assert!(requests.claim(&id).is_err());
    }
}
