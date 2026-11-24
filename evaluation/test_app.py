import os
import sqlite3
import sys
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app as rag


class AppTests(unittest.TestCase):
    password = 'test-password-123'

    def setUp(self):
        (rag.BASE / 'work').mkdir(exist_ok=True)
        folder = Path(self.enterContext(tempfile.TemporaryDirectory(dir=rag.BASE / 'work')))
        self.enterContext(patch.multiple(rag, DATA=folder, DB_PATH=folder/'test.db', UPLOADS=folder/'uploads'))
        self.enterContext(patch.dict(os.environ, {'ADMIN_EMAIL':'admin@example.com','DEEPSEEK_API_KEY':'','EMBEDDING_MODEL':'','RERANKER_MODEL':''}))

    def mutate(self, client, method, url, **kw):
        token = client.get('/api/auth/csrf').json['csrfToken']
        return client.open(url, method=method, headers={'X-CSRF-Token':token}, **kw)

    def register(self, email, admin=False):
        client = rag.app.test_client()
        with patch.object(rag, 'send_email_code') as mail:
            self.assertEqual(self.mutate(client,'POST','/api/auth/code',json={'email':email}).status_code,200)
            code = mail.call_args.args[1]
        result = self.mutate(client,'POST','/api/auth/register',json={'email':email,'username':email.split('@')[0],'code':code,'password':self.password})
        self.assertEqual(result.status_code,201,result.json)
        self.assertEqual(result.json['user']['isAdmin'],admin)
        return client

    def create_base(self, client, name):
        response=self.mutate(client,'POST','/api/knowledge-bases',json={'name':name})
        self.assertEqual(response.status_code,201,response.json)
        return response.json['id']

    def base_id(self, client, name):
        return next(base['id'] for base in client.get('/api/knowledge-bases').json if base['name']==name)

    def upload(self, client, collection):
        return self.mutate(client,'POST','/api/upload',data={'collection':collection,'file':(BytesIO(b'Leave requests go to the people manager.'),'handbook.md')})

    def test_registration_login_and_csrf(self):
        client=self.register('member@example.com')
        self.assertEqual(client.post('/api/auth/logout').status_code,400)
        self.assertEqual(self.mutate(client,'POST','/api/auth/logout').status_code,200)
        self.assertEqual(client.get('/api/documents').status_code,401)
        self.assertEqual(self.mutate(client,'POST','/api/auth/login',json={'email':'member@example.com','password':'wrong'}).status_code,401)
        self.assertEqual(self.mutate(client,'POST','/api/auth/login',json={'email':'member@example.com','password':self.password}).status_code,200)
        self.assertEqual(self.mutate(client,'POST','/api/auth/logout').status_code,200)
        result = self.mutate(client,'POST','/api/auth/login',json={'identifier':'MEMBER','password':self.password})
        self.assertEqual(result.status_code,200)
        self.assertEqual(result.json['user']['username'],'member')
        self.assertEqual(self.mutate(client,'POST','/api/knowledge-bases',json={'name':'HR'}).status_code,403)

    def test_username_uniqueness_and_shared_login_limit(self):
        client=self.register('reader@example.com')
        candidate=rag.app.test_client()
        with patch.object(rag,'send_email_code') as mail:
            self.assertEqual(self.mutate(candidate,'POST','/api/auth/code',json={'email':'other@example.com'}).status_code,200)
            code=mail.call_args.args[1]
        payload={'email':'other@example.com','password':self.password,'code':code}
        self.assertEqual(self.mutate(candidate,'POST','/api/auth/register',json=dict(payload,username='READER')).status_code,409)
        self.assertEqual(self.mutate(candidate,'POST','/api/auth/register',json=dict(payload,username='知识用户')).status_code,201)
        for count in range(10):
            identifier=('reader','reader@example.com')[count % 2]
            self.assertEqual(self.mutate(client,'POST','/api/auth/login',json={'identifier':identifier,'password':'wrong'}).status_code,401)
        self.assertEqual(self.mutate(client,'POST','/api/auth/login',json={'identifier':'reader@example.com','password':self.password}).status_code,429)

    def test_registered_users_and_task_review_workflow(self):
        recipient=self.register('recipient@example.com')
        outsider=self.register('outsider@example.com')
        admin=self.register('admin@example.com',True)
        listed=self.mutate(admin,'GET','/api/users')
        self.assertEqual(listed.status_code,200)
        self.assertIn({'id':recipient.get('/api/profile').json['user']['id'],'email':'recipient@example.com','username':'recipient','isAdmin':False},listed.json)
        self.assertEqual(self.mutate(recipient,'GET','/api/users').status_code,403)
        self.create_base(admin,'Operations')
        uploaded=self.upload(admin,'Operations')
        self.assertEqual(uploaded.status_code,200)
        self.assertEqual([row['name'] for row in recipient.get('/api/documents').json],['handbook.md'])
        base_id=self.base_id(admin,'Operations')
        self.assertEqual(self.mutate(admin,'PUT',f'/api/knowledge-bases/{base_id}/members',json={'members':[{'email':'recipient@example.com','canView':False,'canWrite':False},{'email':'outsider@example.com','canView':True,'canWrite':False}]}).status_code,200)
        payload={'title':'Review handbook','description':'Read the attached policy and summarize it.','assigneeId':recipient.get('/api/profile').json['user']['id'],'documentIds':[uploaded.json['id']]}
        created=self.mutate(admin,'POST','/api/tasks',json=payload)
        self.assertEqual(created.status_code,201,created.json)
        task_id=created.json['task']['id']
        self.assertEqual(recipient.get('/api/tasks').json[0]['id'],task_id)
        self.assertEqual(outsider.get(f'/api/tasks/{task_id}').status_code,404)
        self.assertEqual(recipient.get('/api/documents').json,[])
        detail=recipient.get(f'/api/tasks/{task_id}')
        self.assertEqual(detail.status_code,200)
        self.assertEqual(detail.json['documents'][0]['name'],'handbook.md')
        self.assertTrue(detail.json['passages'])
        self.assertEqual(self.mutate(recipient,'POST',f'/api/tasks/{task_id}/review',json={'decision':'complete'}).status_code,409)
        self.assertEqual(self.mutate(recipient,'POST',f'/api/tasks/{task_id}/submit',json={'submission':'Reviewed the leave policy.'}).status_code,200)
        self.assertEqual(self.mutate(admin,'POST',f'/api/tasks/{task_id}/review',json={'decision':'return','note':''}).status_code,400)
        returned=self.mutate(admin,'POST',f'/api/tasks/{task_id}/review',json={'decision':'return','note':'Please cite the manager approval section.'})
        self.assertEqual(returned.status_code,200)
        self.assertEqual(returned.json['task']['status'],'changes_requested')
        self.assertEqual(recipient.get(f'/api/tasks/{task_id}').json['reviewNote'],'Please cite the manager approval section.')
        self.assertEqual(self.mutate(recipient,'POST',f'/api/tasks/{task_id}/submit',json={'submission':'Updated summary with the approval section.'}).status_code,200)
        completed=self.mutate(admin,'POST',f'/api/tasks/{task_id}/review',json={'decision':'complete','note':''})
        self.assertEqual(completed.status_code,200)
        self.assertEqual(completed.json['task']['status'],'completed')
        self.assertEqual(self.mutate(admin,'POST',f'/api/tasks/{task_id}/review',json={'decision':'return','note':'again'}).status_code,409)

    def test_legacy_import_respects_owner_and_is_idempotent(self):
        admin = self.register('admin@example.com', True)
        self.create_base(admin, 'HR')
        with rag.closing(sqlite3.connect(rag.DATA / 'knowledge.db')) as legacy, legacy:
            legacy.executescript('''
                CREATE TABLE documents(id,owner,name,collection,chunks,created);
                CREATE TABLE chunks(document_id,owner,collection,page,content,vector,fingerprint);
                INSERT INTO documents VALUES ('a','owner-a','selected.md','Old',1,'2026');
                INSERT INTO documents VALUES ('b','owner-b','private.md','Old',1,'2026');
            ''')
            legacy.execute('INSERT INTO chunks VALUES (?,?,?,?,?,?,?)', ('a','owner-a','Old',1,'Selected passage',rag.pack(rag.embed('Selected passage')),'hash'))
        args = ['import-legacy','--owner','owner-a','--collection','Old','--target','HR']
        runner = rag.app.test_cli_runner()
        first = runner.invoke(args=args)
        self.assertEqual(first.exit_code, 0, repr(first.exception))
        self.assertIn('Imported 1 documents', first.output)
        self.assertIn('Imported 0 documents', runner.invoke(args=args).output)
        self.assertEqual([doc['name'] for doc in admin.get('/api/documents').json], ['selected.md'])

    def test_code_limits_and_single_use(self):
        client=rag.app.test_client(); email='code@example.com'
        with patch.object(rag,'send_email_code') as mail:
            self.assertEqual(self.mutate(client,'POST','/api/auth/code',json={'email':email}).status_code,200)
            code=mail.call_args.args[1]
            self.assertEqual(self.mutate(client,'POST','/api/auth/code',json={'email':email}).status_code,429)
        payload={'email':email,'username':'code-user','password':self.password,'code':code}
        self.assertEqual(self.mutate(client,'POST','/api/auth/register',json=payload).status_code,201)
        self.assertEqual(self.mutate(client,'POST','/api/auth/register',json=dict(payload,username='another-user')).status_code,400)

    def test_document_preview_enforces_collection_access(self):
        reader = self.register('reader@example.com')
        admin = self.register('admin@example.com', True)
        base_id = self.create_base(admin, 'HR')
        uploaded = self.upload(admin, 'HR')
        self.assertEqual(uploaded.status_code, 200)
        url = f"/api/documents/{uploaded.json['id']}/passages"
        self.assertEqual(rag.app.test_client().get(url).status_code, 401)
        response = reader.get(url)
        self.assertEqual(response.status_code, 200)
        self.assertIn('people manager', response.json['passages'][0]['content'])
        self.assertIsNone(response.json['nextOffset'])
        self.assertEqual(reader.get(f'{url}?offset=20').json['passages'], [])

        reader_id = reader.get('/api/profile').json['user']['id']
        updated = self.mutate(admin, 'PUT', f'/api/knowledge-bases/{base_id}/members/{reader_id}', json={'level':'none'})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(reader.get(url).status_code, 404)
        self.assertEqual(admin.get(url).status_code, 200)

    def test_retrieval_feedback_and_history_respect_access(self):
        member = self.register('reader@example.com')
        admin = self.register('admin@example.com',True)
        hr = self.create_base(admin,'HR')
        finance = self.create_base(admin,'Finance')
        document = self.upload(admin,'HR').json['id']
        self.assertEqual(self.upload(admin,'Finance').status_code,200)
        reader_id = member.get('/api/profile').json['user']['id']
        self.assertEqual(self.mutate(admin,'PUT',f'/api/knowledge-bases/{finance}/members/{reader_id}',json={'level':'none'}).status_code,200)
        retrieval_url = '/api/retrieval/test'
        query = {'question':'Leave requests','limit':1}
        self.assertEqual(self.mutate(member,'POST',retrieval_url,json=dict(query,limit=True)).status_code,400)
        self.assertEqual(self.mutate(member,'POST',retrieval_url,json=dict(query,collection='Finance')).status_code,403)
        hits = self.mutate(member,'POST',retrieval_url,json=query).json['sources']
        self.assertEqual([hit['collection'] for hit in hits],['HR'])
        self.assertEqual(member.get('/api/conversations').json,[])

        answer = self.mutate(member,'POST','/api/ask',json=dict(query,collection='HR')).json
        message_id = answer['messageId']
        history_url = '/api/conversations/'+answer['conversation']
        feedback_url = f'/api/answers/{message_id}/feedback'
        self.assertEqual(member.get(history_url).json[-1]['sources'],answer['sources'])
        self.assertEqual(self.mutate(admin,'PUT',feedback_url,json={'rating':'helpful'}).status_code,404)
        self.assertEqual(self.mutate(member,'PUT',feedback_url,json={'rating':'needs_work','note':'Add more details'}).status_code,200)
        self.assertEqual(self.mutate(member,'PUT',feedback_url,json={'rating':'helpful'}).json['note'],'Add more details')
        self.assertEqual(admin.get('/api/answer-feedback').json,[])
        self.assertEqual(member.get('/api/answer-feedback').json[0]['id'],message_id)
        self.assertEqual(self.mutate(member,'PUT',feedback_url,json={'rating':None}).status_code,200)
        self.assertEqual(member.get('/api/answer-feedback').json,[])
        self.assertEqual(self.mutate(member,'PUT',feedback_url,json={'rating':'helpful'}).status_code,200)
        self.assertEqual(self.mutate(admin,'DELETE','/api/documents/'+document).status_code,200)
        self.assertEqual(member.get(history_url).json[-1]['sources'],[])
        self.assertEqual(self.mutate(admin,'PUT',f'/api/knowledge-bases/{hr}/members/{reader_id}',json={'level':'none'}).status_code,200)
        self.assertEqual(member.get('/api/answer-feedback').json,[])
        self.assertEqual(member.get(history_url).status_code,404)
        self.assertEqual(self.mutate(member,'PUT',feedback_url,json={'rating':None}).status_code,404)

    def test_knowledge_acl_and_revocation(self):
        member=self.register('reader@example.com')
        admin=self.register('admin@example.com',True)
        hr=self.create_base(admin,'HR'); self.create_base(admin,'Finance')
        doc=self.upload(admin,'HR'); self.assertEqual(doc.status_code,200,doc.json)
        self.assertEqual(self.upload(admin,'Finance').status_code,200)
        self.assertEqual({row['collection'] for row in member.get('/api/documents').json},{'HR','Finance'})
        url=f'/api/knowledge-bases/{hr}/members'
        self.assertEqual(self.mutate(member,'PUT',url,json={'members':[]}).status_code,403)
        self.assertEqual(self.mutate(admin,'PUT',url,json={'members':[{'email':'reader@example.com','canWrite':False}]}).status_code,200)
        hr_member=next(row for row in next(base for base in admin.get('/api/knowledge-bases').json if base['id']==hr)['members'] if row['email']=='reader@example.com')
        self.assertEqual((hr_member['can_view'],hr_member['can_write']),(1,0))
        self.assertEqual({row['collection'] for row in member.get('/api/documents').json},{'Finance','HR'})
        self.assertEqual(self.upload(member,'HR').status_code,403)
        self.assertEqual(self.mutate(member,'DELETE','/api/documents/'+doc.json['id']).status_code,403)
        finance=self.base_id(admin,'Finance')
        self.assertEqual(self.mutate(admin,'PUT',f'/api/knowledge-bases/{finance}/members',json={'members':[{'email':'reader@example.com','canView':False,'canWrite':False}]}).status_code,200)
        finance_member=next(row for row in next(base for base in admin.get('/api/knowledge-bases').json if base['id']==finance)['members'] if row['email']=='reader@example.com')
        self.assertEqual((finance_member['can_view'],finance_member['can_write']),(0,0))
        self.assertEqual(self.mutate(member,'POST','/api/ask',json={'question':'Leave requests','collection':'Finance'}).status_code,403)
        member_id=member.get('/api/profile').json['user']['id']
        member_url=f'/api/knowledge-bases/{finance}/members/{member_id}'
        self.assertEqual(self.mutate(admin,'PUT',member_url,json={'level':'read'}).json,{'ok':True,'level':'read'})
        finance_member=next(row for row in next(base for base in admin.get('/api/knowledge-bases').json if base['id']==finance)['members'] if row['email']=='reader@example.com')
        self.assertEqual((finance_member['can_view'],finance_member['can_write']),(1,0))
        self.assertEqual(self.mutate(member,'POST','/api/ask',json={'question':'Leave requests','collection':'Finance'}).status_code,200)
        self.assertEqual(self.mutate(admin,'PUT',member_url,json={'level':'none'}).json,{'ok':True,'level':'none'})
        self.assertEqual(self.mutate(member,'POST','/api/ask',json={'question':'Leave requests','collection':'Finance'}).status_code,403)
        answer=self.mutate(member,'POST','/api/ask',json={'question':'Leave requests','collection':'all'})
        self.assertEqual(answer.status_code,200,answer.json)
        self.assertEqual({source['collection'] for source in answer.json['sources']},{'HR'})
        result=self.mutate(member,'POST','/api/evaluate',json={'cases':[{'question':'leave','collection':'Finance','expected':'manager'}]})
        self.assertEqual(result.status_code,403)
        self.assertEqual(self.mutate(admin,'PUT',url,json={'members':[{'email':'reader@example.com','canWrite':True}]}).status_code,200)
        hr_member=next(row for row in next(base for base in admin.get('/api/knowledge-bases').json if base['id']==hr)['members'] if row['email']=='reader@example.com')
        self.assertEqual((hr_member['can_view'],hr_member['can_write']),(1,1))
        self.assertEqual(self.upload(member,'HR').status_code,200)
        self.assertEqual(self.mutate(admin,'PUT',url,json={'members':[{'email':'reader@example.com','canView':False,'canWrite':False}]}).status_code,200)
        self.assertEqual(member.get('/api/conversations/'+answer.json['conversation']).status_code,404)
        self.assertEqual(member.get('/api/conversations').json,[])

    def test_evaluation_sets_are_private_and_enforce_knowledge_access(self):
        member = self.register('reader@example.com')
        admin = self.register('admin@example.com',True)
        self.create_base(admin,'HR')
        finance = self.create_base(admin,'Finance')
        member_id = member.get('/api/profile').json['user']['id']
        self.assertEqual(self.mutate(admin,'PUT',f'/api/knowledge-bases/{finance}/members/{member_id}',json={'level':'none'}).status_code,200)

        reader_default = member.get('/api/evaluation-cases')
        self.assertEqual(reader_default.status_code,200)
        self.assertTrue(reader_default.json)
        custom = [{'question':'Where to send leave requests?','expected':'people manager','collection':'HR'}]
        saved = self.mutate(member,'PUT','/api/evaluation-cases',json={'cases':custom})
        self.assertEqual(saved.status_code,200,saved.json)
        self.assertEqual(saved.json[0]['question'],custom[0]['question'])
        self.assertEqual(admin.get('/api/evaluation-cases').json[0]['question'],'员工病假应该联系谁？')
        self.assertEqual(self.mutate(member,'PUT','/api/evaluation-cases',json={'cases':[dict(custom[0],collection='Finance')]}).status_code,403)
        self.assertEqual(self.mutate(member,'PUT','/api/evaluation-cases',json={'cases':[]}).status_code,400)
        self.assertEqual(self.mutate(member,'POST','/api/evaluate',json={'cases':[dict(custom[0],collection='Finance')]}).status_code,403)
        self.assertEqual(self.mutate(member,'POST','/api/evaluate',json=[]).status_code,200)
        run = self.mutate(member,'POST','/api/evaluate',json={'cases':custom})
        self.assertEqual(run.status_code,200,run.json)
        self.assertEqual(run.json['total'],1)


if __name__=='__main__': unittest.main()
