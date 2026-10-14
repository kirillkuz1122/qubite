"""One PostgreSQL gate for REST, internal jobs/tools and WS. No positive cache."""
from datetime import datetime, timedelta
import json
import hashlib
import hmac
import re
from uuid import UUID

from psycopg.types.json import Jsonb

from ..identity.auth.store import AuthError, AuthStore, database, REAUTH
from ..identity.auth.tokens import digest, issue, valid_token
from .models import Target

POLICY_LOCK = 0x515542504F4C
CHANNELS = {'job', 'tool', 'ws'}
ROLES = {'viewer': {'read'}, 'editor': {'read', 'write', 'ai'},
         'manager': {'read', 'write', 'manage', 'ai'}, 'organizer': {'read', 'write'},
         'moderator': {'read', 'write', 'manage'}, 'admin': {'read', 'write', 'manage'}}


class PolicyStore(AuthStore):
    @staticmethod
    def _lock(db, *, write=False):
        # Before any subject/session row: consistent order, shared readers/exclusive writes.
        function = 'pg_advisory_xact_lock' if write else 'pg_advisory_xact_lock_shared'
        db.execute('SELECT '+function+'(%s)', (POLICY_LOCK,))
        row = db.execute('SELECT revision FROM qubite_core.policy_state WHERE singleton').fetchone()
        if not row: raise AuthError(503, 'policy_unavailable')
        return row[0]

    @staticmethod
    def _csrf(row, csrf):
        if not valid_token(csrf, 'qbt_c_') or not hmac.compare_digest(bytes(row[8]), digest(csrf)):
            raise AuthError(403, 'csrf_failed')

    def _web(self, db, raw, csrf=None):
        if not valid_token(raw, 'qbt_s_'):
            raise AuthError(401, 'unauthenticated')
        subject, row = self._session(db, raw)
        if csrf is not None:
            self._csrf(row, csrf)
        return subject, row

    @staticmethod
    def _owner(subject, row=None, now=None):
        if not subject['platform_owner']:
            raise AuthError(403, 'forbidden')
        if row is not None and (not row[9] or now-row[5] > REAUTH):
            raise AuthError(403, 'reauth_required')

    @staticmethod
    def _allowed(db, table, where, params, now):
        # Table/where are fixed internal literals, never API strings.
        row = db.execute('SELECT effect,expires_at FROM qubite_core.'+table+' WHERE '+where, params).fetchone()
        return bool(row and row[0] == 'allow' and (row[1] is None or row[1] > now))

    def _authorize(self, db, subject, target):
        if not isinstance(target, Target):
            raise AuthError(403, 'forbidden')
        now = self.clock()
        module = db.execute('SELECT installed,enabled FROM qubite_core.policy_modules WHERE id=%s', (target.module,)).fetchone()
        if not module or not all(module):
            raise AuthError(403, 'forbidden')
        if not self._allowed(db, 'policy_entitlements', 'subject_id=%s AND module=%s AND action=%s',
                             (subject['id'], target.module, target.action), now):
            raise AuthError(403, 'forbidden')
        member = db.execute('SELECT role,enabled,expires_at FROM qubite_core.policy_memberships WHERE workspace_id=%s AND subject_id=%s',
                            (target.workspace_id, subject['id'])).fetchone()
        if (not member or not member[1] or (member[2] is not None and member[2] <= now)
                or target.action not in ROLES[member[0]]
                or (member[0] in {'organizer', 'moderator', 'admin'} and target.module != 'tournaments')):
            raise AuthError(403, 'forbidden')
        resource = db.execute('SELECT 1 FROM qubite_core.policy_resources WHERE id=%s AND workspace_id=%s AND module=%s',
                              (target.resource_id, target.workspace_id, target.module)).fetchone()
        if not resource or not self._allowed(db, 'policy_acl', 'resource_id=%s AND subject_id=%s AND action=%s',
                                            (target.resource_id, subject['id'], target.action), now):
            raise AuthError(403, 'forbidden')
        if target.action == 'ai':
            if not self._allowed(db, 'policy_ai_grants', 'subject_id=%s AND module=%s AND provider=%s AND model=%s',
                                 (subject['id'], target.module, target.provider, target.model), now):
                raise AuthError(403, 'forbidden')
            # No boolean/caller-supplied budget approval can enable a provider.
            # AI-001/002 must add a transactional reserve/dispatcher before paid effects.
            raise AuthError(403, 'budget_gate_unavailable')

    def execute_session(self, raw, target, effect, *, csrf=None):
        """Trusted adapter hook; effect(db, receipt) executes inside the guarded TX.

        No private payload may be prepared/returned before the gate. Receipt alone is
        not a reusable capability. No irreversible/external work in this callback.
        """
        with database(self.settings) as db:
            revision = self._lock(db)
            subject, _ = self._web(db, raw, csrf)
            self._authorize(db, subject, target)
            return effect(db, {'allowed': True, 'revision': revision})

    def check_session(self, raw, target, *, csrf=None):
        return self.execute_session(raw, target, lambda db, receipt: receipt, csrf=csrf)

    def catalog(self, raw):
        with database(self.settings) as db:
            revision = self._lock(db)
            subject, _ = self._web(db, raw)
            self._owner(subject)
            rows = db.execute('SELECT id,installed,enabled FROM qubite_core.policy_modules ORDER BY id').fetchall()
            return {'revision': revision, 'items': [dict(module=r[0], installed=r[1], enabled=r[2]) for r in rows]}

    def own_access(self, raw):
        with database(self.settings) as db:
            revision = self._lock(db)
            subject, _ = self._web(db, raw)
            rows = db.execute('''SELECT e.module,e.action,e.expires_at FROM qubite_core.policy_entitlements e
                JOIN qubite_core.policy_modules m ON m.id=e.module WHERE e.subject_id=%s AND e.effect='allow'
                AND (e.expires_at IS NULL OR e.expires_at>%s) AND m.installed AND m.enabled ORDER BY e.module,e.action''',
                              (subject['id'], self.clock())).fetchall()
            return {'revision': revision, 'items': [dict(module=r[0], action=r[1], expires_at=r[2]) for r in rows]}

    def module_cards(self, raw, *, owner=False, module=None):
        # Read entitlement directly: installation does not erase an explicit grant.
        # This discloses presentation only, never object permissions or data.
        with database(self.settings) as db:
            revision = self._lock(db)
            subject, _ = self._web(db, raw)
            if owner:
                self._owner(subject)
            if module is not None and not re.fullmatch(r'[a-z][a-z0-9_]{0,31}', module):
                raise AuthError(404, 'not_found')
            rows = db.execute('''SELECT c.module,c.name,c.summary,c.label,c.tone,c.icon,c.visibility,
                c.released,m.installed,m.enabled,e.effect,e.expires_at FROM qubite_core.module_catalog c
                JOIN qubite_core.policy_modules m ON m.id=c.module
                LEFT JOIN qubite_core.policy_entitlements e ON e.module=c.module AND e.subject_id=%s AND e.action='read'
                WHERE (%s::text IS NULL OR c.module=%s) ORDER BY c.position''',
                (subject['id'], module, module)).fetchall()
            items = []
            for r in rows:
                read = r[10] == 'allow' and (r[11] is None or r[11] > self.clock())
                if not owner and not read and r[6] == 'hidden':
                    continue
                status = ('unavailable' if r[8] and not r[9] else
                          'preparing' if not r[7] or not r[8] else 'ready')
                card = dict(module=r[0],name=r[1],summary=r[2],label=r[3],tone=r[4],icon=r[5],
                            visibility=r[6],status=status if owner or read else 'locked',
                            access_expires_at=r[11] if read else None)
                if owner:
                    card.update(released=r[7],installed=r[8],enabled=r[9])
                items.append(card)
            if module is not None and not items:
                raise AuthError(404, 'not_found')
            return {'revision': revision, 'items': items}

    @staticmethod
    def _exists(db, table, column, value):
        if not db.execute('SELECT 1 FROM qubite_core.'+table+' WHERE '+column+'=%s', (value,)).fetchone():
            raise AuthError(400, 'invalid_policy_command')

    def command(self, raw, csrf, command, expected, command_id):
        data = command.model_dump(mode='json')
        hashed = hashlib.sha256(json.dumps(data, sort_keys=True, separators=(',', ':')).encode()).digest()
        with database(self.settings) as db:
            revision = self._lock(db, write=True)
            subject, row = self._web(db, raw)
            self._csrf(row, csrf)
            self._owner(subject, row, self.clock())
            replay = db.execute('SELECT actor_id,request_hash,expected_revision,revision FROM qubite_core.policy_audit WHERE command_id=%s', (command_id,)).fetchone()
            if replay:
                if replay[0] != subject['id'] or bytes(replay[1]) != hashed or replay[2] != expected:
                    raise AuthError(409, 'policy_conflict')
                return {'revision': replay[3]}
            if revision != expected:
                raise AuthError(409, 'policy_conflict')
            expiry = getattr(command, 'expires_at', None)
            if expiry is not None and not self.clock() < expiry <= self.clock()+timedelta(days=365):
                raise AuthError(400, 'invalid_policy_command')
            if hasattr(command, 'module'):
                self._exists(db, 'policy_modules', 'id', command.module)
            if hasattr(command, 'subject_id'):
                self._exists(db, 'subjects', 'id', command.subject_id)
            if command.kind == 'catalog_visibility':
                old = db.execute('SELECT visibility FROM qubite_core.module_catalog WHERE module=%s', (command.module,)).fetchone()
                if not old:
                    raise AuthError(400, 'invalid_policy_command')
                db.execute('UPDATE qubite_core.module_catalog SET visibility=%s WHERE module=%s', (command.visibility, command.module))
            elif command.kind == 'module':
                old = db.execute('SELECT enabled FROM qubite_core.policy_modules WHERE id=%s', (command.module,)).fetchone()
                db.execute('UPDATE qubite_core.policy_modules SET enabled=%s WHERE id=%s', (command.enabled, command.module))
            elif command.kind == 'entitlement':
                key = (command.subject_id, command.module, command.action)
                old = db.execute('SELECT effect,expires_at FROM qubite_core.policy_entitlements WHERE subject_id=%s AND module=%s AND action=%s', key).fetchone()
                db.execute('''INSERT INTO qubite_core.policy_entitlements VALUES (%s,%s,%s,%s,%s)
                    ON CONFLICT(subject_id,module,action) DO UPDATE SET effect=EXCLUDED.effect,expires_at=EXCLUDED.expires_at''', (*key, command.effect, expiry))
            elif command.kind == 'workspace':
                self._exists(db, 'subjects', 'id', command.owner_id)
                old = db.execute('SELECT owner_id FROM qubite_core.policy_workspaces WHERE id=%s', (command.workspace_id,)).fetchone()
                if old: raise AuthError(409, 'policy_conflict')
                db.execute('INSERT INTO qubite_core.policy_workspaces VALUES (%s,%s)', (command.workspace_id, command.owner_id))
            elif command.kind == 'resource':
                self._exists(db, 'policy_workspaces', 'id', command.workspace_id)
                old = db.execute('SELECT workspace_id,module FROM qubite_core.policy_resources WHERE id=%s', (command.resource_id,)).fetchone()
                if old: raise AuthError(409, 'policy_conflict')
                db.execute('INSERT INTO qubite_core.policy_resources VALUES (%s,%s,%s)', (command.resource_id, command.workspace_id, command.module))
            elif command.kind == 'membership':
                self._exists(db, 'policy_workspaces', 'id', command.workspace_id)
                key = (command.workspace_id, command.subject_id)
                old = db.execute('SELECT role,enabled,expires_at FROM qubite_core.policy_memberships WHERE workspace_id=%s AND subject_id=%s', key).fetchone()
                db.execute('''INSERT INTO qubite_core.policy_memberships VALUES (%s,%s,%s,%s,%s)
                    ON CONFLICT(workspace_id,subject_id) DO UPDATE SET role=EXCLUDED.role,enabled=EXCLUDED.enabled,expires_at=EXCLUDED.expires_at''', (*key, command.role, command.enabled, expiry))
            elif command.kind == 'acl':
                self._exists(db, 'policy_resources', 'id', command.resource_id)
                key = (command.resource_id, command.subject_id, command.action)
                old = db.execute('SELECT effect,expires_at FROM qubite_core.policy_acl WHERE resource_id=%s AND subject_id=%s AND action=%s', key).fetchone()
                db.execute('''INSERT INTO qubite_core.policy_acl VALUES (%s,%s,%s,%s,%s)
                    ON CONFLICT(resource_id,subject_id,action) DO UPDATE SET effect=EXCLUDED.effect,expires_at=EXCLUDED.expires_at''', (*key, command.effect, expiry))
            elif command.kind == 'ai_grant':
                key = (command.subject_id, command.module, command.provider, command.model)
                old = db.execute('SELECT effect,expires_at FROM qubite_core.policy_ai_grants WHERE subject_id=%s AND module=%s AND provider=%s AND model=%s', key).fetchone()
                db.execute('''INSERT INTO qubite_core.policy_ai_grants VALUES (%s,%s,%s,%s,%s,%s)
                    ON CONFLICT(subject_id,module,provider,model) DO UPDATE SET effect=EXCLUDED.effect,expires_at=EXCLUDED.expires_at''', (*key, command.effect, expiry))
            else:
                raise AuthError(400, 'invalid_policy_command')
            # Audit is structured metadata only. Old tuples have UUID/datetime converted.
            previous = [str(v) if isinstance(v, (UUID, datetime)) else v for v in old] if old else None
            change = {'before': previous, 'after': data}
            db.execute('UPDATE qubite_core.policy_state SET revision=revision+1 WHERE singleton')
            db.execute('INSERT INTO qubite_core.policy_audit VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                       (command_id, subject['id'], hashed, expected, revision+1, command.kind, command.reason, Jsonb(change), self.clock()))
            return {'revision': revision+1}

    def issue_delegation(self, raw, target, channel, *, csrf, ttl=300):
        """Internal adapter only; exact single target, originating web session, <=5min.

        Not an API key/native token, not serialized into browser/job logs or URLs.
        Durable detached authority is a later keys/jobs task.
        """
        if channel not in CHANNELS or type(ttl) is not int or not 1 <= ttl <= 300:
            raise AuthError(400, 'invalid_request')
        with database(self.settings) as db:
            revision = self._lock(db)
            subject, row = self._web(db, raw)
            self._csrf(row, csrf)
            self._authorize(db, subject, target)
            now = self.clock()
            db.execute('''DELETE FROM qubite_core.policy_delegations WHERE token_hash IN
                (SELECT token_hash FROM qubite_core.policy_delegations WHERE expires_at<=%s ORDER BY expires_at LIMIT 100)''', (now,))
            count = db.execute('SELECT count(*) FROM qubite_core.policy_delegations WHERE session_id=%s AND expires_at>%s', (row[0], now)).fetchone()[0]
            if count >= 32: raise AuthError(429, 'rate_limited')
            raw_delegate = issue('qbt_d_')
            db.execute('INSERT INTO qubite_core.policy_delegations VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                       (digest(raw_delegate), subject['id'], row[0], subject['auth_version'], revision, channel,
                        Jsonb(target.model_dump(mode='json')), now, min(now+timedelta(seconds=ttl), row[3], row[4])))
            return raw_delegate

    def execute_delegated(self, raw, channel, target, effect):
        if not valid_token(raw, 'qbt_d_') or channel not in CHANNELS or not isinstance(target, Target):
            raise AuthError(403, 'forbidden')
        with database(self.settings) as db:
            revision = self._lock(db)
            delegation = db.execute('SELECT subject_id,session_id,auth_version,policy_revision,channel,target,expires_at FROM qubite_core.policy_delegations WHERE token_hash=%s', (digest(raw),)).fetchone()
            if (not delegation or delegation[3] != revision or delegation[4] != channel
                    or delegation[5] != target.model_dump(mode='json') or self.clock() >= delegation[6]):
                raise AuthError(403, 'forbidden')
            subject = self._subject(db, delegation[0])
            session = db.execute('SELECT subject_id,auth_version,revoked_at,expires_at,absolute_expires_at FROM qubite_core.sessions WHERE id=%s FOR UPDATE', (delegation[1],)).fetchone()
            if (not session or session[0] != subject['id'] or session[1] != subject['auth_version']
                    or delegation[2] != subject['auth_version'] or session[2] is not None
                    or self.clock() >= min(session[3], session[4])):
                raise AuthError(401, 'unauthenticated')
            self._authorize(db, subject, target)
            return effect(db, {'allowed': True, 'revision': revision})

    def run_job(self, token, target, effect):
        return self.execute_delegated(token, 'job', target, effect)

    def run_tool(self, token, target, effect):
        return self.execute_delegated(token, 'tool', target, effect)
