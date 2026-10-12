# Фактические маршруты legacy

ПРОВЕРЕНО КОДОМ: статическое извлечение строковых регистраций; наличие маршрута не доказывает успешное выполнение или защиту. Middleware до регистрации тоже имеет значение. Dynamic/loop-generated paths не полностью раскрыты. Вложенные Python router prefixes надо учитывать отдельно (ShadeAI — отдельный отчёт).

| Метод | Путь | Источник:строка | Локальные аргументы guard (подсказка) |
|---|---|---|---|
| GET | `/api/status` | `back/server.js:4357` | `(req, res)` |
| GET | `/api/public/config` | `back/server.js:4364` | `async (req, res, next)` |
| GET | `/api/auth/me` | `back/server.js:4376` | `(req, res)` |
| GET | `/api/auth/oauth/providers` | `back/server.js:4388` | `(req, res)` |
| GET | `/api/workspace/bootstrap` | `back/server.js:4394` | `requireAuth, async (req, res, next)` |
| GET | `/api/auth/oauth/:provider/start` | `back/server.js:4413` | `publicExpensiveRateLimiter, async (req, res, next)` |
| GET | `/api/auth/oauth/:provider/callback` | `back/server.js:4472` | `async (req, res, next)` |
| POST | `/api/auth/register` | `back/server.js:4741` | `publicExpensiveRateLimiter, authRateLimiter, requireTurnstile, async (req, res, next)` |
| POST | `/api/auth/login` | `back/server.js:4860` | `publicExpensiveRateLimiter, authRateLimiter, requireTurnstile, async (req, res, next)` |
| POST | `/api/auth/code-entry/inspect` | `back/server.js:4947` | `publicExpensiveRateLimiter, authRateLimiter, async (req, res, next)` |
| POST | `/api/auth/code-entry` | `back/server.js:5061` | `publicExpensiveRateLimiter, authRateLimiter, async (req, res, next)` |
| POST | `/api/auth/2fa/login/verify` | `back/server.js:5329` | `challengeVerifyRateLimiter, async (req, res, next)` |
| POST | `/api/auth/challenges/resend` | `back/server.js:5372` | `challengeResendRateLimiter, async (req, res, next)` |
| POST | `/api/auth/password/forgot` | `back/server.js:5396` | `publicExpensiveRateLimiter, passwordResetRateLimiter, requireTurnstile, async (req, res, next)` |
| POST | `/api/auth/password/forgot/verify` | `back/server.js:5428` | `challengeVerifyRateLimiter,     async (req, res, next)` |
| POST | `/api/auth/password/reset` | `back/server.js:5469` | `authRateLimiter, async (req, res, next)` |
| POST | `/api/auth/email/verification/send` | `back/server.js:5510` | `requireAuth,     challengeResendRateLimiter,     async (req, res, next)` |
| POST | `/api/auth/email/verification/verify` | `back/server.js:5547` | `requireAuth,     challengeVerifyRateLimiter,     async (req, res, next)` |
| GET | `/api/public/landing` | `back/server.js:5589` | `publicExpensiveRateLimiter, async (req, res, next)` |
| GET | `/api/rating` | `back/server.js:5614` | `publicExpensiveRateLimiter, async (req, res, next)` |
| GET | `/api/rating/me/history` | `back/server.js:5632` | `requireAuth, async (req, res, next)` |
| GET | `/api/rating/me/explain` | `back/server.js:5651` | `requireAuth, async (req, res, next)` |
| GET | `/api/rating/history/:userId` | `back/server.js:5684` | `requireAdmin, async (req, res, next)` |
| POST | `/api/auth/2fa/email/send` | `back/server.js:5708` | `requireAuth, challengeResendRateLimiter, async (req, res, next)` |
| POST | `/api/auth/2fa/email/verify` | `back/server.js:5741` | `requireAuth, challengeVerifyRateLimiter, async (req, res, next)` |
| DELETE | `/api/auth/2fa/email` | `back/server.js:5777` | `requireAuth, async (req, res, next)` |
| POST | `/api/auth/app/register` | `back/server.js:5834` | `requireAppToken, appAuthRateLimiter, async (req, res, next)` |
| POST | `/api/auth/app/login` | `back/server.js:5939` | `requireAppToken, appAuthRateLimiter, async (req, res, next)` |
| POST | `/api/auth/logout` | `back/server.js:6017` | `requireAuth, profileWriteRateLimiter, async (req, res, next)` |
| POST | `/api/auth/logout-all` | `back/server.js:6031` | `requireAuth, profileWriteRateLimiter, async (req, res, next)` |
| DELETE | `/api/auth/sessions/:sessionId` | `back/server.js:6040` | `requireAuth, profileWriteRateLimiter, async (req, res, next)` |
| GET | `/api/dashboard` | `back/server.js:6066` | `requireAuth, async (req, res, next)` |
| GET | `/api/profile` | `back/server.js:6141` | `requireAuth, async (req, res, next)` |
| PUT | `/api/profile` | `back/server.js:6162` | `requireAuth, profileWriteRateLimiter, async (req, res, next)` |
| PUT | `/api/profile/password` | `back/server.js:6252` | `requireAuth, profileWriteRateLimiter, async (req, res, next)` |
| GET | `/api/organizer-applications/mine` | `back/server.js:6299` | `requireAuth, async (req, res, next)` |
| POST | `/api/organizer-applications` | `back/server.js:6312` | `requireParticipant, requireVerifiedEmail, async (req, res, next)` |
| GET | `/api/team` | `back/server.js:6375` | `requireParticipant, async (req, res, next)` |
| POST | `/api/team` | `back/server.js:6391` | `requireParticipant, requireVerifiedEmail, async (req, res, next)` |
| POST | `/api/team/join` | `back/server.js:6429` | `requireParticipant, requireVerifiedEmail, teamJoinRateLimiter, async (req, res, next)` |
| PUT | `/api/team` | `back/server.js:6467` | `requireParticipant, async (req, res, next)` |
| POST | `/api/team/leave` | `back/server.js:6503` | `requireParticipant, async (req, res, next)` |
| POST | `/api/team/transfer` | `back/server.js:6520` | `requireParticipant, async (req, res, next)` |
| DELETE | `/api/team/members/:userId` | `back/server.js:6565` | `requireParticipant, async (req, res, next)` |
| GET | `/api/task-bank` | `back/server.js:6605` | `requireAuth, async (req, res, next)` |
| POST | `/api/task-bank` | `back/server.js:6619` | `requireAdmin, async (req, res, next)` |
| GET | `/api/organizer/overview` | `back/server.js:6644` | `requireOrganizer, async (req, res, next)` |
| GET | `/api/organizer/tasks` | `back/server.js:6656` | `requireOrganizer, async (req, res, next)` |
| POST | `/api/organizer/tasks` | `back/server.js:6669` | `requireOrganizer, async (req, res, next)` |
| PATCH | `/api/organizer/tasks/:id` | `back/server.js:6701` | `requireOrganizer, async (req, res, next)` |
| POST | `/api/organizer/tasks/:id/submit-review` | `back/server.js:6759` | `requireOrganizer,     async (req, res, next)` |
| GET | `/api/organizer/tasks/template` | `back/server.js:6795` | `requireOrganizer,     async (req, res, next)` |
| POST | `/api/organizer/tasks/import/preview` | `back/server.js:6816` | `requireOrganizer,     async (req, res, next)` |
| POST | `/api/organizer/tasks/import/confirm` | `back/server.js:6835` | `requireOrganizer,     async (req, res, next)` |
| GET | `/api/organizer/tournaments` | `back/server.js:6883` | `requireOrganizer, async (req, res, next)` |
| POST | `/api/organizer/tournaments` | `back/server.js:6897` | `requireOrganizer, async (req, res, next)` |
| PATCH | `/api/organizer/tournaments/:id` | `back/server.js:7014` | `requireOrganizer,     async (req, res, next)` |
| POST | `/api/organizer/tournaments/:id/actions` | `back/server.js:7214` | `requireOrganizer,     async (req, res, next)` |
| DELETE | `/api/organizer/tournaments/:id` | `back/server.js:7407` | `requireOrganizer,     async (req, res, next)` |
| GET | `/api/organizer/tournaments/:id/results` | `back/server.js:7445` | `requireOrganizer,     async (req, res, next)` |
| GET | `/api/organizer/tournaments/:id/results/export.csv` | `back/server.js:7484` | `requireOrganizer,     async (req, res, next)` |
| GET | `/api/organizer/tournaments/:id/roster` | `back/server.js:7509` | `requireOrganizer,     async (req, res, next)` |
| GET | `/api/organizer/tournaments/:id/roster/template` | `back/server.js:7531` | `requireOrganizer,     async (req, res, next)` |
| POST | `/api/organizer/tournaments/:id/roster/preview` | `back/server.js:7559` | `requireOrganizer,     async (req, res, next)` |
| POST | `/api/organizer/tournaments/:id/roster/confirm` | `back/server.js:7582` | `requireOrganizer,     async (req, res, next)` |
| POST | `/api/organizer/tournaments/:id/roster/manual` | `back/server.js:7636` | `requireOrganizer,     async (req, res, next)` |
| DELETE | `/api/organizer/tournaments/:id/roster/:rosterEntryId` | `back/server.js:7708` | `requireOrganizer,     async (req, res, next)` |
| GET | `/api/organizer/tournaments/:id/access-codes` | `back/server.js:7750` | `requireOrganizer,     async (req, res, next)` |
| POST | `/api/organizer/tournaments/:id/access-codes/generate` | `back/server.js:7780` | `requireOrganizer,     async (req, res, next)` |
| GET | `/api/organizer/tournaments/:id/access-codes/export.csv` | `back/server.js:7865` | `requireOrganizer,     async (req, res, next)` |
| GET | `/api/organizer/tournaments/:id/helper-codes` | `back/server.js:7904` | `requireOrganizer,     async (req, res, next)` |
| POST | `/api/organizer/tournaments/:id/helper-codes/generate` | `back/server.js:7929` | `requireOrganizer,     async (req, res, next)` |
| GET | `/api/organizer/tournaments/:id/helper-codes/export.csv` | `back/server.js:7990` | `requireOrganizer,     async (req, res, next)` |
| GET | `/api/tournaments` | `back/server.js:8015` | `requireAuth, async (req, res, next)` |
| POST | `/api/tournaments` | `back/server.js:8033` | `requireAdmin, async (req, res, next)` |
| POST | `/api/tournaments/:id/join` | `back/server.js:8121` | `requireParticipant, requireVerifiedEmail, tournamentJoinRateLimiter, async (req, res, next)` |
| GET | `/api/tournaments/:id/runtime` | `back/server.js:8327` | `requireParticipant, async (req, res, next)` |
| POST | `/api/tournaments/:id/tasks/:taskId/draft` | `back/server.js:8379` | `requireParticipant,     tournamentDraftRateLimiter,     async (req, res, next)` |
| POST | `/api/tournaments/:id/tasks/:taskId/submit` | `back/server.js:8466` | `requireParticipant,     tournamentSubmitRateLimiter,     tournamentSubmitDuplicateGuard,     async (req, res, next)` |
| GET | `/api/tournaments/:id/leaderboard` | `back/server.js:8625` | `requireParticipant, async (req, res, next)` |
| GET | `/api/analytics/profile` | `back/server.js:8669` | `requireParticipant, async (req, res, next)` |
| GET | `/api/analytics/team` | `back/server.js:8682` | `requireParticipant, async (req, res, next)` |
| GET | `/api/moderation/overview` | `back/server.js:8706` | `requireModerator, async (req, res, next)` |
| GET | `/api/moderation/tasks` | `back/server.js:8720` | `requireModerator, async (req, res, next)` |
| POST | `/api/moderation/tasks/:id/review` | `back/server.js:8731` | `requireModerator,     adminSensitiveRateLimiter,     async (req, res, next)` |
| GET | `/api/moderation/applications` | `back/server.js:8785` | `requireModerator,     async (req, res, next)` |
| POST | `/api/moderation/applications/:id/review` | `back/server.js:8800` | `requireModerator,     adminSensitiveRateLimiter,     async (req, res, next)` |
| GET | `/api/moderation/users` | `back/server.js:8857` | `requireModerator, async (req, res, next)` |
| PATCH | `/api/moderation/users/:id/status` | `back/server.js:8868` | `requireModerator,     adminSensitiveRateLimiter,     async (req, res, next)` |
| POST | `/api/support/chats` | `back/server.js:9007` | `defaultJsonParser, async (req, res, next)` |
| POST | `/api/support/chats/:id/messages` | `back/server.js:9029` | `defaultJsonParser, async (req, res, next)` |
| GET | `/api/support/chats/:id/messages` | `back/server.js:9061` | `async (req, res, next)` |
| GET | `/api/support/chats/:id/live` | `back/server.js:9081` | `(req, res)` |
| GET | `/api/support/chats` | `back/server.js:9101` | `requireModerator, async (req, res, next)` |
| POST | `/api/support/staff/chats/:id/messages` | `back/server.js:9112` | `requireModerator, defaultJsonParser, async (req, res, next)` |
| PATCH | `/api/support/chats/:id` | `back/server.js:9143` | `requireModerator, defaultJsonParser, async (req, res, next)` |
| GET | `/api/support/staff/live` | `back/server.js:9162` | `requireModerator, (req, res)` |
| GET | `/api/admin/system-stats` | `back/server.js:9183` | `requireAdmin, async (req, res, next)` |
| GET | `/api/admin/system-stats/history` | `back/server.js:9239` | `requireAdmin, async (req, res, next)` |
| GET | `/api/admin/audit/live` | `back/server.js:9249` | `requireAdmin, (req, res)` |
| GET | `/api/admin/stats/detailed` | `back/server.js:9266` | `requireAdmin, async (req, res, next)` |
| GET | `/api/admin/system-settings` | `back/server.js:9276` | `requireAdmin, async (req, res, next)` |
| PATCH | `/api/admin/system-settings/:key` | `back/server.js:9285` | `requireAdmin, adminSensitiveRateLimiter, async (req, res, next)` |
| GET | `/api/admin/overview` | `back/server.js:9319` | `requireAdmin, async (req, res, next)` |
| GET | `/api/admin/users` | `back/server.js:9335` | `requireAdmin, async (req, res, next)` |
| GET | `/api/admin/applications` | `back/server.js:9346` | `requireAdmin, async (req, res, next)` |
| GET | `/api/admin/audit` | `back/server.js:9357` | `requireAdmin, async (req, res, next)` |
| DELETE | `/api/profile` | `back/server.js:9368` | `requireAuth, async (req, res, next)` |
| POST | `/api/admin/users/generate` | `back/server.js:9397` | `requireAdmin, adminSensitiveRateLimiter, async (req, res, next)` |
| DELETE | `/api/admin/users/:id` | `back/server.js:9435` | `requireAdmin, adminSensitiveRateLimiter, async (req, res, next)` |
| DELETE | `/api/admin/users/:id/hard` | `back/server.js:9467` | `requireAdmin, adminSensitiveRateLimiter, async (req, res, next)` |
| POST | `/api/admin/users/:id/restore` | `back/server.js:9498` | `requireAdmin, adminSensitiveRateLimiter, async (req, res, next)` |
| PATCH | `/api/admin/users/:id/role` | `back/server.js:9524` | `requireAdmin, adminSensitiveRateLimiter, async (req, res, next)` |
| GET | `/api/admin/teams` | `back/server.js:9590` | `requireAdmin, async (req, res, next)` |
| DELETE | `/api/admin/teams/:id` | `back/server.js:9601` | `requireAdmin, adminSensitiveRateLimiter, async (req, res, next)` |
| GET | `/api/admin/tasks` | `back/server.js:9623` | `requireAdmin, async (req, res, next)` |
| DELETE | `/api/admin/tasks/:id` | `back/server.js:9634` | `requireAdmin, adminSensitiveRateLimiter, async (req, res, next)` |
| GET | `/api/admin/tournaments` | `back/server.js:9656` | `requireAdmin, async (req, res, next)` |
| PATCH | `/api/admin/tournaments/:id` | `back/server.js:9667` | `requireAdmin, adminSensitiveRateLimiter, async (req, res, next)` |
| POST | `/api/admin/tournaments/:id/actions` | `back/server.js:9701` | `requireAdmin,     adminSensitiveRateLimiter,     async (req, res, next)` |
| DELETE | `/api/admin/tournaments/:id` | `back/server.js:9755` | `requireAdmin,     adminSensitiveRateLimiter,     async (req, res, next)` |
| GET | `/` | `back/server.js:9819` | `(req, res)` |
| GET | `/index.html` | `back/server.js:9823` | `(req, res)` |
| GET | `/404.html` | `back/server.js:9827` | `(req, res)` |
| GET | `/4041.html` | `back/server.js:9831` | `(req, res)` |
| GET | `/${pageName}` | `back/server.js:9843` | `(req, res)` |
| GET | `/api/auth/destination` | `back/src/auth-surface.js:14` | `deps.requireAuth,async(q,s,n)` |
| GET | `/auth` | `back/src/auth-surface.js:21` | `(q,s)` |
| GET | `/internal/services/browser-access` | `back/src/auth-surface.js:33` | `deps.internalKey,async(q,s,n)` |
| GET | `/internal/services/knowledge-api` | `back/src/knowledge-api.js:25` | `d.internalKey,valid,async(q,s)` |
| POST | `/internal/services/knowledge-login` | `back/src/knowledge-api.js:35` | `d.internalKey,d.authRateLimiter,valid,async(q,s)` |
| POST | `/internal/services/knowledge-refresh` | `back/src/knowledge-api.js:48` | `d.internalKey,valid,async(q,s)` |
| POST | `/internal/services/knowledge-oauth-token` | `back/src/knowledge-api.js:58` | `d.internalKey,d.authRateLimiter,valid,async(q,s)` |
| GET | `/service-enroll` | `back/src/knowledge-enrollment.js:18` | `(q,s)` |
| GET | `/knowledge-enroll.js` | `back/src/knowledge-enrollment.js:23` | `(q,s)` |
| GET | `/api/services/knowledge/:name/enroll` | `back/src/knowledge-enrollment.js:24` | `d.requireAuth,async(q,s,n)` |
| POST | `/api/services/knowledge/:name/enroll` | `back/src/knowledge-enrollment.js:25` | `d.requireAuth,d.authRateLimiter,async(q,s,n)` |
| PUT | `/api/owner/services/users/:id/knowledge/:name` | `back/src/knowledge-services.js:16` | `d.requireAuth,d.requireOwner,async(q,s,n)` |
| GET | `/api/proxy/personal` | `back/src/proxy/personal.js:24` | `requireAuth,route(async(req,res)` |
| POST | `/api/proxy/personal/rotate` | `back/src/proxy/personal.js:35` | `requireAuth,enabled,write(async(req,res)` |
| POST | `/api/owner/services/users/:id/vpn` | `back/src/proxy/personal.js:49` | `requireOwner,enabled,write(async(req,res)` |
| GET | `/api/proxy/servers` | `back/src/proxy/routes.js:772` | `requireAuth, async (req, res, next)` |
| GET | `/api/proxy/catalog` | `back/src/proxy/routes.js:786` | `requireAuth, async (req, res, next)` |
| GET | `/api/proxy/routing-profile` | `back/src/proxy/routes.js:813` | `requireAuth, async (req, res)` |
| GET | `/api/proxy/subscription/me` | `back/src/proxy/routes.js:818` | `requireAuth, async (req, res, next)` |
| GET | `/api/proxy/subscription/:token` | `back/src/proxy/routes.js:842` | `async (req, res, next)` |
| GET | `/api/proxy/devices` | `back/src/proxy/routes.js:867` | `requireAuth, async (req, res, next)` |
| POST | `/api/proxy/devices/register` | `back/src/proxy/routes.js:877` | `requireAuth, async (req, res, next)` |
| POST | `/api/proxy/session/start` | `back/src/proxy/routes.js:916` | `requireAuth, async (req, res, next)` |
| POST | `/api/proxy/session/refresh` | `back/src/proxy/routes.js:973` | `requireAuth, async (req, res, next)` |
| POST | `/api/proxy/session/stop` | `back/src/proxy/routes.js:1011` | `requireAuth, async (req, res, next)` |
| POST | `/api/proxy/devices/:deviceId/revoke` | `back/src/proxy/routes.js:1036` | `requireAuth, async (req, res, next)` |
| POST | `/api/proxy/events/heartbeat` | `back/src/proxy/routes.js:1058` | `requireAuth, async (req, res, next)` |
| POST | `/api/proxy/events/traffic` | `back/src/proxy/routes.js:1082` | `requireAuth, async (req, res, next)` |
| GET | `/api/admin/proxy-servers` | `back/src/proxy/routes.js:1135` | `requireOwner, async (req, res, next)` |
| POST | `/api/admin/proxy-servers` | `back/src/proxy/routes.js:1144` | `requireOwner, async (req, res, next)` |
| PATCH | `/api/admin/proxy-servers/:serverUid` | `back/src/proxy/routes.js:1187` | `requireOwner, async (req, res, next)` |
| POST | `/api/admin/proxy-servers/:serverUid/rotate-token` | `back/src/proxy/routes.js:1246` | `requireOwner, async (req, res, next)` |
| DELETE | `/api/admin/proxy-servers/:serverUid` | `back/src/proxy/routes.js:1267` | `requireOwner, async (req, res, next)` |
| GET | `/api/admin/proxy-servers/:serverUid/stats` | `back/src/proxy/routes.js:1287` | `requireOwner, async (req, res, next)` |
| GET | `/api/admin/proxy-sni-routes` | `back/src/proxy/routes.js:1322` | `requireOwner, async (req, res, next)` |
| GET | `/api/admin/proxy-subscriptions` | `back/src/proxy/routes.js:1331` | `requireOwner, async (req, res, next)` |
| POST | `/api/admin/proxy-subscriptions` | `back/src/proxy/routes.js:1340` | `requireOwner, async (req, res, next)` |
| POST | `/api/admin/proxy-subscription-links` | `back/src/proxy/routes.js:1374` | `requireOwner, async (req, res, next)` |
| PATCH | `/api/admin/proxy-subscriptions/:subscriptionUid` | `back/src/proxy/routes.js:1417` | `requireOwner, async (req, res, next)` |
| POST | `/api/admin/proxy-subscriptions/:subscriptionUid/renew` | `back/src/proxy/routes.js:1456` | `requireOwner, async (req, res, next)` |
| DELETE | `/api/admin/proxy-subscriptions/:subscriptionUid` | `back/src/proxy/routes.js:1504` | `requireOwner, async (req, res, next)` |
| POST | `/api/admin/proxy-sni-routes` | `back/src/proxy/routes.js:1524` | `requireOwner, async (req, res, next)` |
| PATCH | `/api/admin/proxy-sni-routes/:routeUid` | `back/src/proxy/routes.js:1583` | `requireOwner, async (req, res, next)` |
| DELETE | `/api/admin/proxy-sni-routes/:routeUid` | `back/src/proxy/routes.js:1655` | `requireOwner, async (req, res, next)` |
| GET | `/api/admin/proxy-logs` | `back/src/proxy/routes.js:1675` | `requireOwner, async (req, res, next)` |
| PATCH | `/api/admin/proxy-users/:userId/privacy` | `back/src/proxy/routes.js:1689` | `requireOwner, async (req, res, next)` |
| POST | `/api/proxy/node/heartbeat` | `back/src/proxy/routes.js:1711` | `async (req, res, next)` |
| GET | `/api/proxy/sync/credentials` | `back/src/proxy/routes.js:1740` | `async (req, res, next)` |
| POST | `/api/proxy/node/traffic` | `back/src/proxy/routes.js:1803` | `async (req, res, next)` |
| GET | `trust proxy` | `back/src/request-guard.js:247` | `))` |
| GET | `/api/services/search-keys` | `back/src/service-api.js:55` | `requireAuth,handle(async q` |
| POST | `/api/services/search-keys` | `back/src/service-api.js:56` | `requireAuth,handle(async q` |
| DELETE | `/api/services/search-keys/:id` | `back/src/service-api.js:57` | `requireAuth,handle(async q` |
| POST | `/internal/services/api-key` | `back/src/service-api.js:58` | `internalKey,handle(async q` |
| GET | `/design-system` | `back/src/services.js:106` | `(req,res)` |
| GET | `/services/return` | `back/src/services.js:107` | `requireAuth,(req,res)` |
| POST | `/internal/services/event` | `back/src/services.js:110` | `internalKey,async(req,res,next)` |
| GET | `/internal/services/session` | `back/src/services.js:119` | `internalKey,requireAuth,async(req,res,next)` |
| GET | `/api/services/me` | `back/src/services.js:120` | `requireAuth,async(req,res,next)` |
| GET | `/api/owner/services/search-analytics` | `back/src/services.js:121` | `requireAuth,requireOwner,async(req,res,next)` |
| GET | `/api/owner/services/users` | `back/src/services.js:127` | `requireAuth,requireOwner,async(req,res,next)` |
| GET | `/api/owner/services/search-logs` | `back/src/services.js:132` | `requireAuth,requireOwner,async(req,res,next)` |
| PUT | `/api/owner/services/users/:id/search-log-protection` | `back/src/services.js:137` | `requireAuth,requireOwner,async(req,res,next)` |
| PUT | `/api/owner/services/users/:id/:service` | `back/src/services.js:143` | `requireAuth,requireOwner,async(req,res,next)` |
| POST | `/api/owner/services/users` | `back/src/services.js:150` | `requireAuth,requireOwner,async(req,res,next)` |
| POST | `/api/owner/services/users/:id/invite` | `back/src/services.js:153` | `requireAuth,requireOwner,async(req,res,next)` |
| POST | `/api/services/activate` | `back/src/services.js:157` | `authRateLimiter,async(req,res,next)` |
| GET | `/service-invite` | `back/src/services.js:169` | `(req,res)` |
| PUT | `/api/owner/services/search-budget` | `back/src/services.js:170` | `requireAuth,requireOwner,async(req,res,next)` |
| GET | `/internal/services/siyuan-access` | `back/src/siyuan.js:18` | `d.internalKey,(q,s)` |
| GET | `/internal/services/siyuan-session` | `back/src/siyuan.js:31` | `d.internalKey,async(q,s)` |
| GET | `/api/services/vault/enroll` | `back/src/vault-integration.js:22` | `d.requireAuth,async(req,res,next)` |
| POST | `/internal/services/vault/:action` | `back/src/vault-integration.js:26` | `d.internalKey,d.requireAuth,async(req,res,next)` |
| DELETE | `/api/owner/services/users/:id/vault` | `back/src/vault-integration.js:36` | `d.requireAuth,d.requireOwner,async(req,res,next)` |
| GET | `/writing` | `back/src/writing.js:130` | `(q,s)` |
| GET | `/writing-assets/` | `back/src/writing.js:131` | `+file,(q,s)` |
| GET | `/writing-assets/highlights.js` | `back/src/writing.js:132` | `(q,s)` |
| GET | `/writing-assets/firefox.xpi` | `back/src/writing.js:133` | `(q,s)` |
| GET | `/writing-assets/guide` | `back/src/writing.js:134` | `(q,s)` |
| GET | `/writing-assets/linux.py` | `back/src/writing.js:135` | `(q,s)` |
| GET | `/api/writing/me` | `back/src/writing.js:136` | `requireAuth,handle(q` |
| POST | `/api/writing/check` | `back/src/writing.js:137` | `requireAuth,handle(q` |
| POST | `/api/writing/rewrite` | `back/src/writing.js:138` | `requireAuth,handle(q` |
| PUT | `/api/owner/services/users/:id/grammar` | `back/src/writing.js:139` | `requireAuth,own,handle(async q` |
| PUT | `/api/owner/services/writing-budget` | `back/src/writing.js:144` | `requireAuth,own,handle(async q` |
| GET | `/api/writing/keys` | `back/src/writing.js:148` | `requireAuth,handle(async q` |
| POST | `/api/writing/keys` | `back/src/writing.js:149` | `requireAuth,handle(async q` |
| DELETE | `/api/writing/keys/:id` | `back/src/writing.js:156` | `requireAuth,handle(async q` |
| GET | `/api/writing/v1/me` | `back/src/writing.js:170` | `cors,bearer,handle(q` |
| POST | `/api/writing/v1/check` | `back/src/writing.js:171` | `cors,bearer,handle(q` |
| POST | `/api/writing/v1/rewrite` | `back/src/writing.js:172` | `cors,bearer,handle(q` |
| GET | `/api/auth/session` | `back/tests/auth-http.test.js:10` | `(q,s)` |
| GET | `/api/tournaments` | `back/tests/auth-http.test.js:10` | `(q,s)` |
| POST | `/api/v1/search` | `services/search/agent_api.py:76` | `)     async def api_search(request:Request,body:AgentSearch):         user=request.state.user;a['cleanup']();a['rate'](user,'agent-search',2` |
| GET | `/api/v1/jobs/{jid}` | `services/search/agent_api.py:89` | `)     def api_job(request:Request,jid:str):         job=a['jobs'].get(jid)         if not job or job['user']!=request.state.user or job.get(` |
| POST | `/api/v1/verify/{jid}` | `services/search/agent_api.py:94` | `)     async def api_verify(request:Request,jid:str):         return await a['run_verification'](jid,request.state.user,request.state.api_key` |
| POST | `/api/v1/fetch/verify/{jid}` | `services/search/agent_api.py:97` | `)     async def api_verify_fetch(request:Request,jid:str):         return await a['run_verification'](jid,request.state.user,request.state.a` |
| POST | `/api/v1/fetch` | `services/search/agent_api.py:100` | `)     async def api_fetch(request:Request,body:AgentFetch):         user=request.state.user;a['rate'](user,'agent-fetch',15,300)         def` |
| GET | `/api/v1/history` | `services/search/agent_api.py:129` | `)     async def api_history(request:Request,limit:int=30):         user=request.state.user         if not saved_enabled(user):raise HTTPExce` |
| GET | `/api/v1/history/{cid}` | `services/search/agent_api.py:136` | `)     async def api_history_item(request:Request,cid:str):         user=request.state.user         if not saved_enabled(user):raise HTTPExce` |
| GET | `/login` | `services/search/app.py:167` | `) def login_page(request:Request):     if QUBITE_URL:return RedirectResponse(os.environ.get('QUBITE_PUBLIC_URL','https://qubiteapp.online')+` |
| POST | `/auth/login` | `services/search/app.py:172` | `) async def login(request:Request,body:LoginBody):     if QUBITE_URL:raise HTTPException(403,'Войди через Qubite.')     rate(body.username.l` |
| POST | `/auth/logout` | `services/search/app.py:192` | `) def logout(request:Request):     store.revoke_browser_session(request.cookies.get(SESSION_COOKIE,''))     response=JSONResponse(` |
| GET | `/search` | `services/search/app.py:199` | `) def browser_search():return FileResponse(ROOT/'static/index.html')  @app.get('/opensearch.xml') def opensearch():     return Response('''<` |
| GET | `/opensearch.xml` | `services/search/app.py:202` | `) def opensearch():     return Response('''<?xml version="1.0" encoding="UTF-8"?> <OpenSearchDescription xmlns="http://a9.com/-/spec/opensea` |
| GET | `/api/me` | `services/search/app.py:224` | `) def me(request: Request):     user = request.state.user     p=profiles.get(user` |
| GET | `/api/search/config` | `services/search/app.py:249` | `) async def search_config():     return` |
| POST | `/api/search` | `services/search/app.py:329` | `) async def search(request: Request, body: SearchBody):     cleanup()     rate(request.state.user,'search',30,300)     result=await perform_` |
| POST | `/api/answer` | `services/search/app.py:670` | `) async def answer(request: Request,body: AnswerBody):     cleanup()     user=request.state.user     if not can_paid(user) and body.model no` |
| POST | `/api/history/select` | `services/search/app.py:713` | `) async def select_history(request: Request,body: HistorySelectBody):     user=request.state.user;job=jobs.get(body.job_id)     if not job o` |
| PUT | `/api/settings/verification` | `services/search/app.py:738` | `) def verification_settings(request:Request,body:VerificationSettings):     store.set_verification_enabled(request.state.user,body.enabled) ` |
| POST | `/api/verify` | `services/search/app.py:765` | `) async def check_answer(request:Request,body:CheckAnswer):     return await run_verification(body.job_id,request.state.user)  @app.get('/ap` |
| GET | `/api/jobs/{jid}` | `services/search/app.py:769` | `) def job(request: Request,jid: str):     j=jobs.get(jid)     if not j or j['user']!=request.state.user:         raise HTTPException(404,'От` |
| GET | `/api/history` | `services/search/app.py:779` | `) def history(request:Request):     history_permission(request);user=request.state.user     return` |
| PUT | `/api/history/settings` | `services/search/app.py:787` | `) def history_settings(request:Request,body:HistorySettings):     if body.enabled:history_permission(request)     store.set_history_enabled(` |
| GET | `/api/history/encrypted-legacy` | `services/search/app.py:794` | `) def encrypted_legacy(request:Request):     history_permission(request)     return` |
| DELETE | `/api/history/encrypted-legacy` | `services/search/app.py:799` | `) def delete_encrypted_legacy(request:Request):     store.encrypted_delete(request.state.user)     return` |
| GET | `/api/history/context/{cid}` | `services/search/app.py:840` | `) def history_context(request:Request,cid:str):     history_permission(request);user=request.state.user     if not store.history_enabled(use` |
| DELETE | `/api/history/encrypted-legacy/{cid}` | `services/search/app.py:847` | `) def delete_old_encrypted(request:Request,cid:str):     store.encrypted_delete(request.state.user,cid);return` |
| GET | `/api/history/{cid}` | `services/search/app.py:851` | `) def get_history(request:Request,cid:str):     history_permission(request)     try:         turns=safe_chat_turns(store.conversation(cid,re` |
| PUT | `/api/history/{cid}` | `services/search/app.py:860` | `) def put_history(request:Request,cid:str,body:ChatBody):     history_permission(request);user=request.state.user     if not store.history_e` |
| DELETE | `/api/history/{cid}` | `services/search/app.py:872` | `) def delete_record(request:Request,cid:str):     store.delete_chat(request.state.user,cid)     store.encrypted_delete(request.state.user,ci` |
| DELETE | `/api/history` | `services/search/app.py:878` | `) def delete_history(request:Request):     store.encrypted_delete(request.state.user);store.delete_history(request.state.user);store.clear_s` |
| GET | `/api/image` | `services/search/app.py:883` | `) async def image(request: Request,url: str):     rate(request.state.user,'images',50,300)     try:         body,ct,_=await fetch_public(url` |
| GET | `/` | `services/search/app.py:892` | `) def index():     return FileResponse(ROOT/'static/index.html')  app.mount('/static',StaticFiles(directory=ROOT/'static'),name='static')  d` |
| GET | `/api/visual/{vid}` | `services/search/app.py:904` | `) def visual(request: Request,vid: str):     v=frames.get(vid)     if not v or v['user']!=request.state.user:         raise HTTPException(40` |
