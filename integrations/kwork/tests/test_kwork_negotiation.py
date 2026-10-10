import json
from pathlib import Path
import kwork_bot
import kwork_negotiation as nego
from install_brief_hooks import patch_bot
from install_negotiation_hooks import patch


def test_targeted_hooks_keep_live_features_and_are_idempotent():
    sources=[Path(kwork_bot.__file__).read_text()]
    live=Path('/tmp/qubite-kwork-bot-live.py')
    if live.exists():sources.append(patch_bot(live.read_text()))
    for source in sources:
        output=patch(source)
        assert patch(output)==output
        assert output.count('negotiation_integration.callback(')==1
        assert output.count('negotiation_integration.tick(')==1
        assert output.count('negotiation_integration.message(')==1
        assert 'brief_integration' in output
        for feature in ('prompt_versions','transcribe',"job['kind']=='learn'"):
            if feature in source:assert feature in output


def test_control_checks_owner_and_force_reply_matches_prompt(tmp_path,monkeypatch):
    state=kwork_bot.State(tmp_path)
    monkeypatch.setattr(nego,'cfg',lambda *args:{'enabled':True})
    calls=[];sent=[]
    def helper(state,request,*args):
        calls.append(request)
        return {'edit':'a'*12,'version':1,'kind':'offer'}
    monkeypatch.setattr(nego,'helper',helper)
    def api(method,payload,*args):sent.append(payload);return {'message_id':123}
    cb={'data':'nego:edit:'+'a'*12+':1','from':{'id':1},'message':{'message_id':42,'chat':{'id':1}}}
    wrong={**cb,'from':{'id':2}}
    assert 'владельцу' in nego.callback(state,wrong,1,api) and not calls
    assert nego.callback(state,cb,1,api)=='Жду правку'
    assert sent[-1]['reply_markup']['force_reply']
    msg={'from':{'id':1},'chat':{'id':1},'text':'20000; 10; Каталог'}
    assert not nego.message(state,msg,1,api)
    assert not nego.message(state,{**msg,'reply_to_message':{'message_id':999}},1,api)
    assert nego.message(state,{**msg,'reply_to_message':{'message_id':123}},1,api)
    assert calls[-1]['action']=='edit' and calls[-1]['text']==msg['text']
