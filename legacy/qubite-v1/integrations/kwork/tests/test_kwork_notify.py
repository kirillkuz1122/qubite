"""Delivery failures and duplicate cards must not lose orders or send twice."""
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import kwork_notify as notify
from kwork_bot import State

class DeliveryTests(unittest.TestCase):
    def run_notify(self,failed=False,already_sent=False):
        with tempfile.TemporaryDirectory() as folder:
            state=State(Path(folder));state.save({'id':'1','title':'Заказ'})
            if already_sent:state.sent('1',123,False)
            with patch.object(notify.kwork_parser,'DATA',Path(folder)), \
                 patch.object(notify.kwork_parser,'acknowledge') as ack, \
                 patch.object(notify,'State',return_value=state), \
                 patch.object(notify,'config',return_value={'owner_chat_id':5}), \
                 patch.object(notify,'api',side_effect=RuntimeError('unavailable') if failed else None,return_value={'message_id':123}) as send, \
                 patch('sys.argv',['kwork_notify','--order-id','1']), \
                 patch('sys.stdin',io.StringIO(json.dumps({'text':'Карточка','parse_mode':'HTML'}))), \
                 patch('sys.stdout',io.StringIO()) as output:
                code=notify.main()
                return code,json.loads(output.getvalue()),ack.call_args,send.call_args_list,state.get('1')

    def test_success_acknowledges_only_after_saved_delivery(self):
        code,result,ack,calls,row=self.run_notify()
        self.assertEqual(code,0);self.assertEqual(ack.args[0],['1']);self.assertEqual(row['message_id'],123)
        payload=calls[0].args[1];self.assertEqual(payload['chat_id'],5)
        self.assertEqual(payload['reply_markup']['inline_keyboard'][-1][0]['callback_data'],'del:1')

    def test_failure_does_not_acknowledge_or_mark_sent(self):
        code,result,ack,_,row=self.run_notify(failed=True)
        self.assertEqual(code,1);self.assertIsNone(ack);self.assertFalse(result['ok']);self.assertFalse(row['message_id'])

    def test_already_delivered_card_is_not_sent_twice(self):
        code,result,ack,calls,row=self.run_notify(already_sent=True)
        self.assertEqual(code,0);self.assertEqual(calls,[]);self.assertEqual(ack.args[0],['1'])

if __name__=='__main__':unittest.main()
