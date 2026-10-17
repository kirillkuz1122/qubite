"""Atomic owner configuration. Lock order: migration, policy, auth, budget, registration."""
from contextlib import contextmanager
from datetime import timedelta
from uuid import UUID

from psycopg.types.json import Jsonb

from ..ai.budgets import BudgetStore, fingerprint
from ..ai.models import BudgetLimit, Timezone, DispatchSettings
from ..identity.auth.store import AuthError, REAUTH, database
from ..identity.registration.store import RegistrationStore
from .models import Batch


class OwnerStore(BudgetStore):
    @contextmanager
    def _view(self, raw, csrf=None, *, mutation=False):
        with database(self.settings) as db:
            policy = self._lock(db, write=mutation)
            actor, session = self._web(db, raw, csrf)
            self._owner(actor, session if mutation else None, self._now())
            budget, zone = self._budget_lock(db, write=mutation)
            registration = RegistrationStore._state(db, lock=mutation)
            revision = f'owner-{policy}-{budget}-{registration["revision"]}'
            yield db, actor, session, revision, zone, registration

    def state(self, raw):
        with self._view(raw) as (db, actor, session, revision, zone, registration):
            rows = db.execute('''SELECT c.module,c.name,c.visibility,m.installed,m.enabled,c.released
                FROM qubite_core.module_catalog c JOIN qubite_core.policy_modules m ON m.id=c.module
                ORDER BY c.position''').fetchall()
            timeout = db.execute('SELECT timeout_seconds FROM qubite_core.ai_budget_state WHERE singleton').fetchone()[0]
            return dict(revision=revision, timezone=zone, timeout_seconds=timeout,
                        registration=registration, now=self._now(),
                        reauth_until=session[5]+REAUTH if session[9] else None,
                        modules=[dict(zip(('id','name','visibility','installed','enabled','released'), r)) for r in rows])

    def users(self, raw, csrf, query):
        with self._view(raw, csrf) as (db, _, _, revision, _, _):
            # Escaped literal search, stable UUID keyset, no query-string PII.
            needle = '%' + query.search.replace('\\','\\\\').replace('%','\\%').replace('_','\\_') + '%'
            rows = db.execute('''SELECT s.id,s.email_original,s.display_name,s.status,
                s.email_verified_at,s.auth_version,s.created_at,(o.subject_id IS NOT NULL)
                FROM qubite_core.subjects s LEFT JOIN qubite_core.platform_owner o ON o.subject_id=s.id
                WHERE (%s::uuid IS NULL OR s.id>%s) AND
                (s.email_original ILIKE %s OR COALESCE(s.display_name,'') ILIKE %s)
                ORDER BY s.id LIMIT 31''', (query.after,query.after,needle,needle)).fetchall()
            return dict(revision=revision, items=[dict(zip(('id','email','display_name','status','verified_at',
                        'auth_version','created_at','platform_owner'), r)) for r in rows[:30]],
                        next=str(rows[29][0]) if len(rows)>30 else None)

    def user(self, raw, subject_id):
        with self._view(raw) as (db, _, _, revision, _, _):
            if not db.execute('SELECT 1 FROM qubite_core.subjects WHERE id=%s',(subject_id,)).fetchone():
                raise AuthError(404,'not_found')
            grants = db.execute('''SELECT e.module,e.action,e.effect,e.expires_at FROM qubite_core.policy_entitlements e
                JOIN qubite_core.module_catalog c ON c.module=e.module WHERE e.subject_id=%s
                ORDER BY e.module,e.action''',(subject_id,)).fetchall()
            models = db.execute('''SELECT g.module,g.provider,g.model,g.effect,g.expires_at FROM qubite_core.policy_ai_grants g
                JOIN qubite_core.module_catalog c ON c.module=g.module WHERE g.subject_id=%s
                ORDER BY g.module,g.provider,g.model LIMIT 129''',(subject_id,)).fetchall()
            return dict(revision=revision, subject_id=subject_id,
                        grants=[dict(zip(('module','action','effect','expires_at'), r)) for r in grants],
                        models=[dict(zip(('module','provider','model','effect','expires_at'), r)) for r in models[:128]],
                        more_models=len(models)>128)

    def budget(self, raw, csrf, query):
        # Validate keys exactly as the existing cap contract, without mutating accounts/buckets.
        try: BudgetLimit(scope=query.scope,key=query.key,period='all',usd_micro=0)
        except ValueError: raise AuthError(400,'invalid_budget_request') from None
        with self._view(raw, csrf) as (db, _, _, revision, zone, _):
            account = db.execute('SELECT id FROM qubite_core.ai_budget_accounts WHERE scope=%s AND key=%s',
                                 (query.scope,query.key)).fetchone()
            result = []
            for period in ('day','month','all'):
                limit = db.execute('''SELECT usd_micro,requests,tokens FROM qubite_core.ai_budget_limits
                    WHERE account_id=%s AND period=%s''',(account[0],period)).fetchone() if account else None
                rows = db.execute('''SELECT spent_usd,spent_requests,spent_tokens,reserved_usd,reserved_requests,
                    reserved_tokens,starts_at,ends_at,timezone FROM qubite_core.ai_budget_buckets
                    WHERE account_id=%s AND period=%s ORDER BY starts_at DESC''',
                    (account[0],period)).fetchall() if account else []
                current = rows[0] if rows and (rows[0][7] is None or self._now()<rows[0][7]) else None
                spent = list(current[:3]) if current else [0,0,0]
                held = [sum(r[i] for r in rows) for i in (3,4,5)]
                caps = list(limit) if limit else [None,None,None]
                result.append(dict(period=period,usd_micro=caps[0],requests=caps[1],tokens=caps[2],
                    spent_usd=spent[0],spent_requests=spent[1],spent_tokens=spent[2],
                    reserved_usd=held[0],reserved_requests=held[1],reserved_tokens=held[2],
                    remaining_usd=None if caps[0] is None else max(0,caps[0]-spent[0]-held[0]),
                    ends_at=current[7] if current else None,timezone=current[8] if current else zone))
            freezes = db.execute('SELECT provider,model FROM qubite_core.ai_budget_freezes ORDER BY provider,model LIMIT 100').fetchall()
            return dict(revision=revision,scope=query.scope,key=query.key,items=result,
                        freezes=[dict(provider=r[0],model=r[1]) for r in freezes])

    def receipt(self, raw, identifier):
        with self._view(raw) as (db, actor, _, _, _, _):
            row = db.execute('SELECT receipt FROM qubite_core.owner_console_commands WHERE id=%s AND actor_id=%s',
                             (identifier,actor['id'])).fetchone()
            if not row: raise AuthError(404,'not_found')
            return row[0]

    def review(self, raw, csrf, batch):
        with self._view(raw,csrf) as (db,_,_,revision,_,registration):
            items=[]
            for c in batch.changes:
                if c.kind=='entitlement':
                    row=db.execute('SELECT effect,expires_at FROM qubite_core.policy_entitlements WHERE subject_id=%s AND module=%s AND action=%s',
                                   (c.subject_id,c.module,c.action)).fetchone()
                elif c.kind=='ai_grant':
                    row=db.execute('SELECT effect,expires_at FROM qubite_core.policy_ai_grants WHERE subject_id=%s AND module=%s AND provider=%s AND model=%s',
                                   (c.subject_id,c.module,c.provider,c.model)).fetchone()
                elif c.kind=='limit':
                    row=db.execute('''SELECT l.usd_micro,l.requests,l.tokens FROM qubite_core.ai_budget_limits l
                        JOIN qubite_core.ai_budget_accounts a ON a.id=l.account_id WHERE a.scope=%s AND a.key=%s AND l.period=%s''',
                                   (c.scope,c.key,c.period)).fetchone()
                elif c.kind=='catalog_visibility':
                    row=db.execute('SELECT visibility FROM qubite_core.module_catalog WHERE module=%s',(c.module,)).fetchone()
                elif c.kind=='module':
                    row=db.execute('SELECT installed,enabled FROM qubite_core.policy_modules WHERE id=%s',(c.module,)).fetchone()
                elif c.kind=='account' or c.kind=='revoke_sessions':
                    row=db.execute('SELECT status,auth_version FROM qubite_core.subjects WHERE id=%s',(c.subject_id,)).fetchone()
                elif c.kind=='timezone':row=db.execute('SELECT timezone FROM qubite_core.ai_budget_state WHERE singleton').fetchone()
                elif c.kind=='dispatcher':row=db.execute('SELECT timeout_seconds FROM qubite_core.ai_budget_state WHERE singleton').fetchone()
                else:row=(registration['mode'],)
                items.append(dict(change=c.model_dump(mode='json'),current=list(row) if row else None))
            return dict(revision=revision,items=items)

    def apply(self, raw, csrf, batch, expected, identifier):
        # Revalidate trusted callers too; no model_construct privilege shortcut.
        batch = Batch.model_validate(batch.model_dump())
        data = batch.model_dump(mode='json'); hashed = fingerprint(data)
        with self._view(raw, csrf, mutation=True) as (db, actor, _, revision, _, registration):
            replay = db.execute('SELECT actor_id,request_hash,expected,receipt FROM qubite_core.owner_console_commands WHERE id=%s',
                                (identifier,)).fetchone()
            if replay:
                if replay[0]!=actor['id'] or bytes(replay[1])!=hashed or replay[2]!=expected:
                    raise AuthError(409,'owner_conflict')
                return replay[3]
            if revision!=expected: raise AuthError(409,'owner_conflict')
            changes=[]; budget_changed=False; registration_changed=False
            for c in batch.changes:
                after=c.model_dump(mode='json')
                if c.kind in {'entitlement','ai_grant','catalog_visibility','module'}:
                    if not db.execute('SELECT 1 FROM qubite_core.module_catalog WHERE module=%s',(c.module,)).fetchone():
                        raise AuthError(400,'invalid_owner_change')
                    if c.kind=='ai_grant' and c.provider!='mock':
                        raise AuthError(400,'provider_not_available')
                    if c.kind=='module' and c.enabled and not db.execute('''SELECT 1 FROM qubite_core.policy_modules
                        WHERE id=%s AND installed''',(c.module,)).fetchone():
                        raise AuthError(400,'module_not_installed')
                    changes.append(self._apply_command(db,c))
                elif isinstance(c,(BudgetLimit,Timezone,DispatchSettings)):
                    changes.append(self._apply_configuration(db,c)); budget_changed=True
                elif c.kind=='registration':
                    db.execute('UPDATE qubite_core.registration_state SET mode=%s,revision=revision+1 WHERE singleton=1',(c.mode,))
                    changes.append(dict(before=registration['mode'],after=after)); registration_changed=True
                else:
                    self._exists(db,'subjects','id',c.subject_id)
                    if db.execute('SELECT 1 FROM qubite_core.platform_owner WHERE subject_id=%s',(c.subject_id,)).fetchone():
                        raise AuthError(403,'owner_protected')
                    old=db.execute('SELECT status,auth_version,email_verified_at FROM qubite_core.subjects WHERE id=%s FOR UPDATE',
                                   (c.subject_id,)).fetchone()
                    if c.kind=='account':
                        status='blocked' if c.blocked else ('active' if old[2] is not None else 'pending')
                        db.execute('UPDATE qubite_core.subjects SET status=%s,auth_version=auth_version+1,updated_at=%s WHERE id=%s',
                                   (status,self._now(),c.subject_id))
                    else:
                        db.execute('UPDATE qubite_core.subjects SET auth_version=auth_version+1,updated_at=%s WHERE id=%s',
                                   (self._now(),c.subject_id))
                    db.execute('UPDATE qubite_core.sessions SET revoked_at=COALESCE(revoked_at,%s) WHERE subject_id=%s',
                               (self._now(),c.subject_id))
                    changes.append(dict(before=dict(status=old[0],auth_version=old[1]),after=after))
            db.execute('UPDATE qubite_core.policy_state SET revision=revision+1 WHERE singleton')
            if budget_changed: db.execute('UPDATE qubite_core.ai_budget_state SET revision=revision+1 WHERE singleton')
            p,b,r=(int(v) for v in revision.split('-')[1:])
            receipt=dict(id=str(identifier),revision=f'owner-{p+1}-{b+int(budget_changed)}-{r+int(registration_changed)}',count=len(changes))
            db.execute('INSERT INTO qubite_core.owner_console_commands VALUES(%s,%s,%s,%s,%s,%s,%s)',
                       (identifier,actor['id'],hashed,expected,Jsonb(receipt),Jsonb(changes),self._now()))
            return receipt

    def audit(self, raw, csrf, page):
        with self._view(raw, csrf) as (db, _, _, _, _, _):
            rows=db.execute('''WITH events AS (
                SELECT id,actor_id,'console' AS source,changes,created_at FROM qubite_core.owner_console_commands
                UNION ALL SELECT command_id,actor_id,'policy',jsonb_build_array(change),created_at FROM qubite_core.policy_audit
                UNION ALL SELECT command_id,actor_id,'budget',jsonb_build_array(change),created_at FROM qubite_core.ai_budget_audit
                UNION ALL SELECT id,actor_id,'registration',jsonb_build_array(jsonb_build_object('action',action,'target_id',target_id,'mode',mode)),created_at
                    FROM qubite_core.registration_audit)
                SELECT e.* FROM events e WHERE (%s::uuid IS NULL OR (e.created_at,e.id)<
                    (SELECT created_at,id FROM events WHERE id=%s)) ORDER BY e.created_at DESC,e.id DESC LIMIT 21''',
                            (page.before,page.before)).fetchall()
            return dict(items=[dict(zip(('id','actor_id','source','changes','created_at'),r)) for r in rows[:20]],
                        next=str(rows[19][0]) if len(rows)>20 else None)
