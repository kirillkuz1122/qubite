//! ChatGPT по подписке (AI-005): вход через браузер (PKCE), токены
//! зашифрованы, обновление, Responses API, лимит подписки, только свои
//! запросы. OpenAI — подставные локальные серверы, в интернет не ходим.

use std::sync::{Arc, Mutex};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use qubite_ai::{
    AiConfig, AiError, AiRequest, Gateway, MICROS_PER_USD, Untrusted,
    admin::{self, LimitScope, Metric, Period},
    catalog::{self, Allowlist},
    chatgpt::{self, ChatGpt, ChatGptConfig},
    secret::SecretBox,
};
use qubite_db::Database;
use qubite_policy::{Flags, ModuleId, ModulePatch, OwnerConsole, Subject, UseAi};
use qubite_testkit::{
    TestDb,
    fake_http::{Action, FakeHttp, Received},
};
use uuid::Uuid;

const MODEL: &str = "chatgpt:gpt-6.1-sol";

/// Что «знает» подставной OpenAI.
#[derive(Default)]
struct OpenAi {
    /// nonce из адреса входа — его надо вернуть в ID-токене.
    nonce: String,
    issuer: String,
    /// Номер выдачи токенов: at-1/rt-1, at-2/rt-2…
    issued: u32,
    grant_scopes: String,
    /// Ответ на обновление: Some — ошибка.
    refresh_error: Option<String>,
}

fn id_token(issuer: &str, nonce: &str) -> String {
    let exp = time::OffsetDateTime::now_utc().unix_timestamp() + 3600;
    let claims = serde_json::json!({
        "iss": issuer, "aud": "oaiapp_test", "exp": exp, "nonce": nonce,
        "sub": "user-1", "email": "kirill@example.ru"
    });
    format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(claims.to_string()))
}

fn form(body: &str) -> Vec<(String, String)> {
    reqwest::Url::parse(&format!("http://x/?{body}"))
        .unwrap()
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect()
}

fn field(pairs: &[(String, String)], name: &str) -> Option<String> {
    pairs
        .iter()
        .find(|(k, _)| k == name)
        .map(|(_, v)| v.clone())
}

async fn auth_server(state: Arc<Mutex<OpenAi>>) -> FakeHttp {
    let responder = move |request: &Received| {
        let mut s = state.lock().unwrap();
        if request.line.starts_with("POST /api/accounts/oauth/token") {
            let params = form(&request.body);
            let grant = field(&params, "grant_type").unwrap_or_default();
            if grant == "refresh_token"
                && let Some(error) = &s.refresh_error
            {
                return (400, serde_json::json!({ "error": error }).to_string());
            }
            s.issued += 1;
            let n = s.issued;
            let mut body = serde_json::json!({
                "access_token": format!("at-{n}"),
                "refresh_token": format!("rt-{n}"),
                "token_type": "Bearer",
                "expires_in": 3600,
                "scope": s.grant_scopes,
            });
            if grant == "authorization_code" {
                body["id_token"] = id_token(&s.issuer, &s.nonce).into();
            }
            return (200, body.to_string());
        }
        if request
            .line
            .starts_with("GET /.well-known/openid-configuration")
        {
            let revoke = format!("{}/oauth/revoke", s.issuer);
            return (
                200,
                serde_json::json!({ "revocation_endpoint": revoke }).to_string(),
            );
        }
        if request.line.starts_with("POST /oauth/revoke") {
            return (200, String::new());
        }
        (404, "{}".into())
    };
    FakeHttp::start([], Action::With(Arc::new(responder))).await
}

fn sse(text: &str) -> String {
    [
        serde_json::json!({"type": "response.created"}),
        serde_json::json!({"type": "response.output_text.delta", "delta": text}),
        serde_json::json!({"type": "response.completed", "response": {"usage": {"input_tokens": 20, "output_tokens": 5}}}),
    ]
    .iter()
    .map(|e| format!("event: {}\ndata: {e}\n\n", e["type"].as_str().unwrap()))
    .collect()
}

/// API: модели и ответы; `responses` — что ответить на очередной запрос.
async fn api_server(responses: Vec<Action>) -> FakeHttp {
    let script = Arc::new(Mutex::new(std::collections::VecDeque::from(responses)));
    let responder = move |request: &Received| {
        if request.line.starts_with("GET /v1/models") {
            let models = serde_json::json!({ "models": [
                { "slug": "gpt-6.1-sol", "display_name": "GPT-6.1 Sol", "visibility": "list" },
                { "slug": "internal-hidden", "visibility": "hide" }
            ]});
            return (200, models.to_string());
        }
        match script.lock().unwrap().pop_front() {
            Some(Action::Respond(status, body)) => (status, body),
            _ => (200, sse("Готово")),
        }
    };
    FakeHttp::start([], Action::With(Arc::new(responder))).await
}

struct Env {
    test_db: TestDb,
    db: Database,
    owner: OwnerConsole,
    docs: ModuleId,
    secret: Arc<SecretBox>,
    openai: Arc<Mutex<OpenAi>>,
    auth: FakeHttp,
}

impl Env {
    async fn new() -> Self {
        let (test_db, db) = TestDb::migrated().await;
        let owner = qubite_auth::owner::create(
            db.pool(),
            &qubite_auth::Passwords::default(),
            "owner@qubite.ru",
            "",
            "пароль владельца",
        )
        .await
        .unwrap();
        let owner = qubite_policy::decide_owner(db.pool(), &Subject::account(owner.id, None))
            .await
            .unwrap();
        let docs = ModuleId::new("docs").unwrap();
        qubite_policy::catalog::update(
            db.pool(),
            &owner,
            &docs,
            ModulePatch {
                installed: Some(true),
                readiness: Some("stable".into()),
                ..ModulePatch::default()
            },
        )
        .await
        .unwrap();
        let openai = Arc::new(Mutex::new(OpenAi {
            grant_scopes: chatgpt::SCOPES.into(),
            ..OpenAi::default()
        }));
        let auth = auth_server(openai.clone()).await;
        openai.lock().unwrap().issuer = auth.root_url();
        Self {
            test_db,
            db,
            owner,
            docs,
            secret: Arc::new(SecretBox::from_base64(&SecretBox::generate_key()).unwrap()),
            openai,
            auth,
        }
    }

    fn config(&self, api: &FakeHttp) -> ChatGptConfig {
        ChatGptConfig {
            auth_base: self.auth.root_url(),
            api_base: format!("{}/v1", api.root_url()),
            ..ChatGptConfig::default()
        }
    }

    /// Вход: «браузер» проверяет адрес входа и возвращается на callback.
    async fn login(
        &self,
        api: &FakeHttp,
        callback: impl Fn(&reqwest::Url) -> String + Send + 'static,
    ) -> Result<chatgpt::LoginResult, String> {
        let openai = self.openai.clone();
        chatgpt::login(
            self.db.pool(),
            &self.config(api),
            &self.secret,
            self.owner.account_id(),
            0,
            move |url| {
                let url = reqwest::Url::parse(url).unwrap();
                let nonce = url
                    .query_pairs()
                    .find(|(k, _)| k == "nonce")
                    .unwrap()
                    .1
                    .into_owned();
                openai.lock().unwrap().nonce = nonce;
                let target = callback(&url);
                tokio::spawn(async move {
                    let _ = qubite_testkit::http_client().get(target).send().await;
                });
            },
        )
        .await
    }

    async fn connect(&self, api: &FakeHttp) {
        self.login(api, |url| back(url, "code-1", Some("oaiapp_test")))
            .await
            .unwrap();
        catalog::ensure_provider(self.db.pool(), "chatgpt", "chatgpt", "", true)
            .await
            .unwrap();
    }

    async fn gateway(&self, api: &FakeHttp) -> (Gateway, Arc<ChatGpt>) {
        let provider = Arc::new(
            ChatGpt::new(
                self.db.pool().clone(),
                self.config(api),
                self.secret.clone(),
            )
            .unwrap(),
        );
        let entries = provider.models().await.unwrap();
        catalog::apply(self.db.pool(), "chatgpt", &entries, &Allowlist::Keep)
            .await
            .unwrap();
        admin::enable_from_catalog(self.db.pool(), &self.owner, "chatgpt", "gpt-6.1-sol")
            .await
            .unwrap();
        let config = AiConfig {
            retry_delays: vec![std::time::Duration::from_millis(5); 2],
            ..AiConfig::default()
        };
        let gateway =
            Gateway::new(self.db.pool().clone(), config).with_provider("chatgpt", provider.clone());
        (gateway, provider)
    }

    /// Owner в режиме «без личного лимита» + дневной потолок платформы.
    async fn owner_ai(&self) -> qubite_policy::Authorized<UseAi> {
        admin::set_owner_unlimited(self.db.pool(), &self.owner, true)
            .await
            .unwrap();
        admin::set_limit(
            self.db.pool(),
            &self.owner,
            &LimitScope::Platform,
            Period::Day,
            Metric::Usd,
            MICROS_PER_USD,
        )
        .await
        .unwrap();
        self.auth_for(self.owner.account_id()).await
    }

    async fn auth_for(&self, account: Uuid) -> qubite_policy::Authorized<UseAi> {
        qubite_policy::decide::<UseAi>(self.db.pool(), &Subject::account(account, None), &self.docs)
            .await
            .unwrap()
    }

    async fn sealed(&self, column: &str) -> Option<String> {
        sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
            "SELECT {column} FROM ai_chatgpt_session WHERE singleton"
        )))
        .fetch_one(self.db.pool())
        .await
        .unwrap()
    }

    async fn finish(self) {
        self.db.close().await;
        self.test_db.drop_db().await;
    }
}

/// Адрес возврата из «браузера».
fn back(url: &reqwest::Url, code: &str, client_id: Option<&str>) -> String {
    let get = |name: &str| {
        url.query_pairs()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.into_owned())
            .unwrap()
    };
    let mut target = reqwest::Url::parse(&get("redirect_uri")).unwrap();
    target
        .query_pairs_mut()
        .append_pair("code", code)
        .append_pair("state", &get("state"))
        .append_pair("scope", chatgpt::SCOPES);
    if let Some(client_id) = client_id {
        target.query_pairs_mut().append_pair("client_id", client_id);
    }
    target.into()
}

fn request(id: &str) -> AiRequest {
    AiRequest {
        request_id: id.into(),
        model: MODEL.into(),
        prompt: "Разбери мысль".into(),
        untrusted: vec![Untrusted::new("inbox", format!("купить молоко ({id})"))],
        input_tokens: 0,
        max_output_tokens: 200,
        job_id: None,
    }
}

// ---------------------------------------------------------------- вход

#[tokio::test]
async fn login_registers_client_with_pkce_and_stores_tokens_encrypted() {
    let env = Env::new().await;
    let api = api_server(vec![]).await;
    let seen = Arc::new(Mutex::new(None::<reqwest::Url>));
    let seen_in = seen.clone();
    let result = env
        .login(&api, move |url| {
            *seen_in.lock().unwrap() = Some(url.clone());
            back(url, "code-1", Some("oaiapp_test"))
        })
        .await
        .unwrap();
    assert_eq!(result.client_id, "oaiapp_test");
    assert_eq!(result.email.as_deref(), Some("kirill@example.ru"));

    let url = seen.lock().unwrap().clone().unwrap();
    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    assert_eq!(url.path(), "/api/accounts/authorize");
    assert_eq!(
        field(&pairs, "client_id").as_deref(),
        Some("dynamic_agent_client")
    );
    assert_eq!(field(&pairs, "agent_name_hint").as_deref(), Some("Qubite"));
    assert_eq!(field(&pairs, "response_type").as_deref(), Some("code"));
    assert_eq!(
        field(&pairs, "code_challenge_method").as_deref(),
        Some("S256")
    );
    assert_eq!(
        field(&pairs, "resource").as_deref(),
        Some(chatgpt::RESOURCE)
    );
    assert!(
        field(&pairs, "scope")
            .unwrap()
            .contains("chatgpt.tokens.use.direct")
    );
    assert!(
        field(&pairs, "redirect_uri")
            .unwrap()
            .starts_with("http://127.0.0.1:")
    );
    assert!(
        field(&pairs, "redirect_uri")
            .unwrap()
            .ends_with("/auth/callback")
    );
    let host = field(&pairs, "ext_agent_host_id").unwrap();

    // Обмен кода: PKCE-verifier подходит к challenge, секрета клиента нет.
    let exchange = env
        .auth
        .received()
        .into_iter()
        .find(|r| r.line.starts_with("POST /api/accounts/oauth/token"))
        .unwrap();
    let params = form(&exchange.body);
    assert_eq!(
        field(&params, "grant_type").as_deref(),
        Some("authorization_code")
    );
    assert_eq!(field(&params, "client_id").as_deref(), Some("oaiapp_test"));
    assert_eq!(field(&params, "code").as_deref(), Some("code-1"));
    assert_eq!(
        chatgpt::pkce_challenge(&field(&params, "code_verifier").unwrap()),
        field(&pairs, "code_challenge").unwrap()
    );
    assert!(field(&params, "client_secret").is_none());

    // Токены — только зашифрованными.
    let access = env.sealed("access_token_enc").await.unwrap();
    assert!(!access.contains("at-1"));
    assert_eq!(env.secret.open("chatgpt.access", &access).unwrap(), "at-1");
    let refresh = env.sealed("refresh_token_enc").await.unwrap();
    assert_eq!(
        env.secret.open("chatgpt.refresh", &refresh).unwrap(),
        "rt-1"
    );

    // Повторный вход: выданный client_id и тот же host_id, без agent_name_hint;
    // поддельный возврат (чужой state) игнорируется.
    let seen_in = seen.clone();
    env.login(&api, move |url| {
        *seen_in.lock().unwrap() = Some(url.clone());
        let mut forged = reqwest::Url::parse(&back(url, "evil", None)).unwrap();
        let pairs: Vec<(String, String)> = forged
            .query_pairs()
            .map(|(k, v)| {
                let value = if k == "state" {
                    "forged".to_owned()
                } else {
                    v.into_owned()
                };
                (k.into_owned(), value)
            })
            .collect();
        forged.query_pairs_mut().clear().extend_pairs(pairs);
        let good = back(url, "code-2", None);
        tokio::spawn(async move {
            let _ = qubite_testkit::http_client().get(forged).send().await;
        });
        good
    })
    .await
    .unwrap();
    let url = seen.lock().unwrap().clone().unwrap();
    let again: Vec<(String, String)> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    assert_eq!(field(&again, "client_id").as_deref(), Some("oaiapp_test"));
    assert!(field(&again, "agent_name_hint").is_none());
    assert_eq!(field(&again, "ext_agent_host_id"), Some(host));
    assert_eq!(
        field(&again, "login_hint").as_deref(),
        Some("kirill@example.ru")
    );
    let codes: Vec<String> = env
        .auth
        .received()
        .iter()
        .filter(|r| r.line.starts_with("POST /api/accounts/oauth/token"))
        .filter_map(|r| field(&form(&r.body), "code"))
        .collect();
    assert_eq!(
        codes,
        ["code-1", "code-2"],
        "код из поддельного возврата не обменивался"
    );
    env.finish().await;
}

#[tokio::test]
async fn login_without_plan_scope_or_with_refusal_stores_nothing() {
    let env = Env::new().await;
    let api = api_server(vec![]).await;
    env.openai.lock().unwrap().grant_scopes = "openid profile email offline_access".into();
    let error = env
        .login(&api, |url| back(url, "code-1", Some("oaiapp_test")))
        .await
        .unwrap_err();
    assert!(error.contains("chatgpt.tokens.use.direct"), "{error}");
    assert_eq!(env.sealed("access_token_enc").await, None);

    let error = env
        .login(&api, |url| {
            let mut target = reqwest::Url::parse(&back(url, "x", None)).unwrap();
            let state = target
                .query_pairs()
                .find(|(k, _)| k == "state")
                .unwrap()
                .1
                .into_owned();
            target
                .query_pairs_mut()
                .clear()
                .append_pair("error", "access_denied")
                .append_pair("state", &state);
            target.into()
        })
        .await
        .unwrap_err();
    assert!(error.contains("отказались"), "{error}");
    assert!(!chatgpt::status(env.db.pool()).await.unwrap().connected);
    env.finish().await;
}

// ---------------------------------------------------------------- запросы

#[tokio::test]
async fn owner_request_goes_through_responses_api_and_request_limits() {
    let env = Env::new().await;
    let api = api_server(vec![]).await;
    env.connect(&api).await;
    let (gateway, _) = env.gateway(&api).await;
    let auth = env.owner_ai().await;
    // Платит подписка — учёт по запросам: не больше 2 в день на модель.
    admin::set_limit(
        env.db.pool(),
        &env.owner,
        &LimitScope::Model(MODEL.into()),
        Period::Day,
        Metric::Requests,
        2,
    )
    .await
    .unwrap();

    let reply = gateway.complete(&auth, request("r1")).await.unwrap();
    assert_eq!(reply.text, "Готово");
    assert_eq!(
        (reply.tokens_in, reply.tokens_out, reply.cost_usd),
        (20, 5, 0)
    );
    gateway.complete(&auth, request("r2")).await.unwrap();
    assert!(matches!(
        gateway.complete(&auth, request("r3")).await,
        Err(AiError::BudgetExhausted { metric, .. }) if metric == "requests"
    ));

    let sent: Vec<Received> = api
        .received()
        .into_iter()
        .filter(|r| r.line.starts_with("POST /v1/responses"))
        .collect();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0].header("authorization"), Some("Bearer at-1"));
    let body: serde_json::Value = serde_json::from_str(&sent[0].body).unwrap();
    assert_eq!(body["model"], "gpt-6.1-sol");
    assert_eq!(body["stream"], true);
    assert_eq!(body["store"], false);
    assert!(
        body["instructions"]
            .as_str()
            .unwrap()
            .contains("Разбери мысль")
    );
    assert_eq!(body["input"].as_array().unwrap().len(), 1);
    assert_eq!(body["input"][0]["role"], "user", "системных сообщений нет");
    assert!(
        body.get("max_output_tokens").is_none(),
        "маршрут его не принимает"
    );
    env.finish().await;
}

#[tokio::test]
async fn subscription_is_only_for_the_one_who_connected_it() {
    let env = Env::new().await;
    let api = api_server(vec![]).await;
    env.connect(&api).await;
    let (gateway, _) = env.gateway(&api).await;
    let user = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO accounts (id, email, email_verified_at, status) VALUES ($1, 'u@qubite.ru', now(), 'active')",
    )
    .bind(user)
    .execute(env.db.pool())
    .await
    .unwrap();
    let flags = Flags {
        read: true,
        ai: true,
        ..Flags::NONE
    };
    qubite_policy::grants::set(env.db.pool(), &env.owner, user, &env.docs, flags, None)
        .await
        .unwrap();
    admin::set_limit(
        env.db.pool(),
        &env.owner,
        &LimitScope::User(user),
        Period::Day,
        Metric::Usd,
        MICROS_PER_USD,
    )
    .await
    .unwrap();
    let error = gateway
        .complete(&env.auth_for(user).await, request("other"))
        .await
        .unwrap_err();
    assert!(
        matches!(&error, AiError::ProviderRefused { reason, .. } if reason.contains("только для запросов того")),
        "{error:?}"
    );
    assert!(
        !api.received()
            .iter()
            .any(|r| r.line.starts_with("POST /v1/responses")),
        "к OpenAI ничего не ушло"
    );
    env.finish().await;
}

#[tokio::test]
async fn subscription_limit_is_clear_and_pauses_new_requests() {
    let env = Env::new().await;
    let limit = serde_json::json!({ "error": {
        "code": "subscription_sharing_usage_limit_exceeded", "message": "limit" } });
    let api = api_server(vec![Action::Respond(429, limit.to_string())]).await;
    env.connect(&api).await;
    let (gateway, _) = env.gateway(&api).await;
    let auth = env.owner_ai().await;

    let error = gateway.complete(&auth, request("l1")).await.unwrap_err();
    assert_eq!(error.code(), "subscription_limit");
    assert!(
        error
            .to_string()
            .contains("лимит подписки ChatGPT исчерпан"),
        "{error}"
    );
    // Пауза: следующий запрос даже не уходит.
    let error = gateway.complete(&auth, request("l2")).await.unwrap_err();
    assert_eq!(error.code(), "subscription_limit");
    let sent = api
        .received()
        .iter()
        .filter(|r| r.line.starts_with("POST /v1/responses"))
        .count();
    assert_eq!(sent, 1, "повтора нет, во время паузы — ни одного запроса");
    let status: String = sqlx::query_scalar("SELECT status FROM ai_calls WHERE request_id = 'l1'")
        .fetch_one(env.db.pool())
        .await
        .unwrap();
    assert_eq!(status, "failed_not_sent");
    env.finish().await;
}

#[tokio::test]
async fn expired_token_is_refreshed_and_rotated_terminal_error_needs_new_login() {
    let env = Env::new().await;
    let api = api_server(vec![]).await;
    env.connect(&api).await;
    let (gateway, _) = env.gateway(&api).await;
    let auth = env.owner_ai().await;
    let expire = || async {
        sqlx::query("UPDATE ai_chatgpt_session SET expires_at = now() WHERE singleton")
            .execute(env.db.pool())
            .await
            .unwrap();
    };

    expire().await;
    gateway.complete(&auth, request("e1")).await.unwrap();
    let refresh = env
        .auth
        .received()
        .into_iter()
        .filter(|r| r.line.starts_with("POST /api/accounts/oauth/token"))
        .map(|r| form(&r.body))
        .find(|p| field(p, "grant_type").as_deref() == Some("refresh_token"))
        .unwrap();
    assert_eq!(field(&refresh, "refresh_token").as_deref(), Some("rt-1"));
    assert_eq!(field(&refresh, "client_id").as_deref(), Some("oaiapp_test"));
    assert_eq!(
        field(&refresh, "resource").as_deref(),
        Some(chatgpt::RESOURCE)
    );
    assert!(
        field(&refresh, "scope").is_none(),
        "scope не меняем — сохраняется прежний"
    );
    let last = api.received().last().unwrap().clone();
    assert_eq!(last.header("authorization"), Some("Bearer at-2"));
    let rotated = env.sealed("refresh_token_enc").await.unwrap();
    assert_eq!(
        env.secret.open("chatgpt.refresh", &rotated).unwrap(),
        "rt-2"
    );

    // Refresh больше не годится — токены стираются, нужен новый вход.
    env.openai.lock().unwrap().refresh_error = Some("invalid_grant".into());
    expire().await;
    let error = gateway.complete(&auth, request("e2")).await.unwrap_err();
    assert!(
        matches!(&error, AiError::ProviderRefused { reason, .. } if reason.contains("войдите снова")),
        "{error:?}"
    );
    assert!(!chatgpt::status(env.db.pool()).await.unwrap().connected);
    // client_id и host_id остаются для следующего входа.
    assert_eq!(
        env.sealed("client_id").await.as_deref(),
        Some("oaiapp_test")
    );
    env.finish().await;
}

#[tokio::test]
async fn rejected_token_is_refreshed_once_and_logout_revokes() {
    let env = Env::new().await;
    let api = api_server(vec![Action::Respond(401, r#"{"detail":"expired"}"#.into())]).await;
    env.connect(&api).await;
    let (gateway, _) = env.gateway(&api).await;
    let auth = env.owner_ai().await;

    gateway.complete(&auth, request("401")).await.unwrap();
    let auths: Vec<String> = api
        .received()
        .iter()
        .filter(|r| r.line.starts_with("POST /v1/responses"))
        .filter_map(|r| r.header("authorization").map(Into::into))
        .collect();
    assert_eq!(auths, ["Bearer at-1", "Bearer at-2"]);

    let revoked = chatgpt::logout(env.db.pool(), &env.config(&api), &env.secret)
        .await
        .unwrap();
    assert!(revoked);
    let revoke = env
        .auth
        .received()
        .into_iter()
        .find(|r| r.line.starts_with("POST /oauth/revoke"))
        .unwrap();
    let params = form(&revoke.body);
    assert_eq!(field(&params, "token").as_deref(), Some("rt-2"));
    assert_eq!(
        field(&params, "token_type_hint").as_deref(),
        Some("refresh_token")
    );
    assert!(!chatgpt::status(env.db.pool()).await.unwrap().connected);
    assert!(matches!(
        gateway.complete(&auth, request("after")).await,
        Err(AiError::ProviderRefused { .. })
    ));
    env.finish().await;
}
