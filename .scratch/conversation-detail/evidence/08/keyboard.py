import subprocess, json, pathlib
root = pathlib.Path('/tmp/coko-conversation-detail/ticket-08/.scratch/conversation-detail/evidence/08')
def ab(*args):
    return subprocess.run(['rtk', 'proxy', 'agent-browser', '--session', 'coko-approval-08', *args], check=True, capture_output=True, text=True).stdout
ab('open', 'http://127.0.0.1:61571/?theme=dark&lang=en&state=completed')
ab('wait', '--fn', 'Boolean(document.querySelector("[contenteditable=true]"))')
ab('focus', '[contenteditable=true]')
ab('keyboard', 'inserttext', 'preserved keyboard draft')
ab('eval', "window.answers=[];window.fixture.api.answerApproval=async(...args)=>{window.answers.push(args)};window.fixture.sendServer({type:'progress',sessionId:'s-1',runId:'keyboard-run',event:{type:'run_start'}});for(const [seq,kind,payload] of [[50,'run_start',{trigger:'submit'}],[51,'message',{role:'assistant',content:[{type:'toolCall',id:'key-call',name:'custom',arguments:{path:'.git/config'}}],stopReason:'toolUse',timestamp:0}],[52,'approval_request',{requestId:'key-request',toolCallId:'key-call',toolName:'custom',kind:'tool',subject:'.git/config',suggestions:[]}]])window.fixture.sendServer({type:'entry',sessionId:'s-1',entry:{sessionId:'s-1',seq,kind,payloadVersion:1,payload,runId:'keyboard-run',createdAt:Date.now()}});true")
ab('wait', '--fn', 'document.activeElement?.dataset.slot === "approval-card"')
before = ab('eval', "JSON.stringify({focus:document.activeElement.dataset.slot,answers:window.answers,composerHidden:Boolean(document.querySelector('[contenteditable=true]').closest('[hidden]'))})")
ab('press', 'Enter')
ab('press', 'Enter')
ab('wait', '--fn', 'window.answers.length===1')
ab('eval', "window.fixture.sendServer({type:'entry',sessionId:'s-1',entry:{sessionId:'s-1',seq:53,kind:'approval_decision',payloadVersion:2,payload:{requestId:'key-request',outcome:'allowed',by:'user',scope:'once'},runId:'keyboard-run',createdAt:Date.now()}});true")
ab('wait', '--fn', 'document.activeElement?.getAttribute("contenteditable") === "true"')
after = ab('eval', "JSON.stringify({focus:document.activeElement.getAttribute('contenteditable'),draft:document.activeElement.textContent,answers:window.answers,cardPresent:Boolean(document.querySelector('[data-slot=approval-card]'))})")
(root / 'keyboard.json').write_text(json.dumps({'before':json.loads(json.loads(before)),'after':json.loads(json.loads(after))},ensure_ascii=False,indent=2))
print(before,after)
