import subprocess, json, pathlib
root=pathlib.Path('/tmp/coko-conversation-detail/ticket-12-visual')
session='coko-reading-12'
def ab(*args):
 result=subprocess.run(['rtk','proxy','agent-browser','--session',session,*args],check=True,capture_output=True,text=True)
 return result.stdout.strip()
def evaluate(code):
 raw=ab('eval','JSON.stringify('+code+')')
 value=json.loads(raw)
 return json.loads(value) if isinstance(value,str) else value
def wait(code): return ab('wait','--fn',code)
metrics=[]
for theme in ['light','dark']:
 for width in [1000,390]:
  locale='en' if width==1000 else 'zh'
  ab('set','viewport',str(width),'800')
  ab('set','media',theme)
  ab('open',f'http://127.0.0.1:52059/?theme={theme}&lang={locale}&state=running')
  wait("Boolean(document.querySelector('[data-slot=process-group-body][data-running]'))")
  wait("(()=>{const e=document.querySelector('.conversation-message-scroll');return e.scrollHeight-e.clientHeight-e.scrollTop<1})()")
  before=evaluate("({top:document.querySelector('.conversation-message-scroll').scrollTop})")
  ab('click','[data-slot=tool-card]:last-child button')
  wait("(()=>{const e=document.querySelector('.conversation-message-scroll');return document.querySelector('[data-slot=tool-card-body]')&&e.scrollTop>"+str(before['top']+100)+"&&e.scrollHeight-e.clientHeight-e.scrollTop<1})()")
  ab('screenshot',str(root/f'{theme}-{width}-tail.png'))
  ab('scroll','up','1400','--selector','.conversation-message-scroll')
  ab('focus','[role=textbox]')
  ab('eval',"window.anchor=[...document.querySelectorAll('.conversation-assistant-message')].find(e=>e.getBoundingClientRect().bottom>document.querySelector('.conversation-message-scroll').getBoundingClientRect().top);window.anchorTop=anchor.getBoundingClientRect().top; window.finish();true")
  wait("document.querySelector('[data-slot=process-seat]').hidden")
  held=evaluate("({delta:anchor.getBoundingClientRect().top-anchorTop,remaining:(()=>{const e=document.querySelector('.conversation-message-scroll');return e.scrollHeight-e.clientHeight-e.scrollTop})()})")
  assert abs(held['delta'])<=1, held
  assert held['remaining']>100, held
  ab('screenshot',str(root/f'{theme}-{width}-held.png'))
  ab('find','role','button','click','--name','Return to bottom' if locale=='en' else '返回底部')
  ab('eval','window.append();true')
  wait("(()=>{const e=document.querySelector('.conversation-message-scroll');return e.textContent.includes('Appended original answer.')&&e.scrollHeight-e.clientHeight-e.scrollTop<1})()")
  resumed=evaluate("({remaining:(()=>{const e=document.querySelector('.conversation-message-scroll');return e.scrollHeight-e.clientHeight-e.scrollTop})(),main:document.querySelector('main').clientWidth,column:document.querySelector('[data-slot=conversation-messages]').clientWidth,overflow:document.documentElement.scrollWidth>innerWidth,dpr:devicePixelRatio,font:getComputedStyle(document.querySelector('.conversation-assistant-message')).font})")
  ab('screenshot',str(root/f'{theme}-{width}-resumed.png'))
  ab('open',f'http://127.0.0.1:52059/?theme={theme}&lang={locale}&state=completed')
  wait("Boolean(document.querySelector('[data-slot=run-process-control][aria-expanded=false]'))")
  ab('click','[data-slot=run-process-control]')
  ab('click','[data-slot=process-group-header]')
  wait("(()=>{const e=document.querySelector('[data-slot=process-group-body]');return e.clientHeight===400&&getComputedStyle(e).overflowY==='auto'})()")
  initial=evaluate("document.querySelector('[data-slot=process-group-body]').scrollTop")
  assert initial==0, initial
  ab('scroll','down','1000','--selector','[data-slot=process-group-body]')
  groupBefore=evaluate("document.querySelector('[data-slot=process-group-body]').scrollTop")
  ab('click','[data-slot=tool-card]:last-child button')
  wait("(()=>{const e=document.querySelector('[data-slot=process-group-body]');return e.scrollTop>"+str(groupBefore+100)+"&&e.scrollHeight-e.clientHeight-e.scrollTop<1})()")
  ab('scroll','up','150','--selector','.conversation-message-scroll')
  outerBefore=evaluate("document.querySelector('.conversation-message-scroll').scrollTop")
  ab('scroll','up','10000','--selector','[data-slot=process-group-body]')
  edge=evaluate("({outer:document.querySelector('.conversation-message-scroll').scrollTop,inner:document.querySelector('[data-slot=process-group-body]').scrollTop,cap:getComputedStyle(document.querySelector('[data-slot=process-group-body]')).maxHeight,overscroll:getComputedStyle(document.querySelector('[data-slot=process-group-body]')).overscrollBehaviorY,overflow:document.documentElement.scrollWidth>innerWidth})")
  assert edge['inner']==0, edge
  ab('screenshot',str(root/f'{theme}-{width}-nested-reading.png'))
  metrics.append(dict(theme=theme,width=width,height=800,locale=locale,held=held,resumed=resumed,initialGroupTop=initial,groupBefore=groupBefore,outerBefore=outerBefore,edge=edge))
(root/'metrics.json').write_text(json.dumps(metrics,ensure_ascii=False,indent=2))
print(json.dumps(metrics,ensure_ascii=False))
